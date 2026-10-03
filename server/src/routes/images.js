// Image library for email content: upload, list, delete (logged in) and public serving.
const express = require('express');
const multer = require('multer');
const { Image } = require('../models');
const { wrap, oid, HttpError } = require('../utils');

// Vercel forwards request bodies up to ~4.5 MB, so keep uploads under that.
const MAX_BYTES = 4 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });

/** Identify the real file type from its first bytes (never trust the browser's mimetype). SVG is refused: it can carry scripts. */
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.subarray(0, 4).toString('ascii') === 'GIF8') return { mime: 'image/gif', ext: 'gif' };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

const toJson = (img) => ({
  _id: img._id, name: img.name, mime: img.mime, size: img.size, width: img.width, height: img.height, createdAt: img.createdAt,
  url: `/i/${img._id}.${img.ext}`,
});

// ---------- logged-in API ----------
const api = express.Router();

api.get('/businesses/:bid/images', wrap(async (req, res) => {
  const rows = await Image.find({ business: oid(req.params.bid) }).sort({ createdAt: -1 }).lean();
  res.json(rows.map(toJson));
}));

api.post('/businesses/:bid/images', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new HttpError(400, 'Image is larger than 4 MB. Compress it (e.g. tinypng.com) and try again.'));
    next(err);
  });
}, wrap(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose an image file');
  const type = sniff(req.file.buffer);
  if (!type) throw new HttpError(400, 'Only JPG, PNG, GIF or WebP images are supported');
  const img = await Image.create({
    business: oid(req.params.bid),
    name: String(req.file.originalname || 'image').slice(0, 200),
    mime: type.mime, ext: type.ext, size: req.file.size,
    width: Number(req.body.width) || undefined, height: Number(req.body.height) || undefined,
    data: req.file.buffer,
  });
  res.json(toJson(img));
}));

api.delete('/images/:id', wrap(async (req, res) => {
  await Image.deleteOne({ _id: oid(req.params.id) });
  res.json({ ok: true });
}));

// ---------- public: loaded by recipients' email apps ----------
const pub = express.Router();

pub.get('/i/:file', wrap(async (req, res) => {
  const id = req.params.file.split('.')[0];
  if (!/^[a-f0-9]{24}$/.test(id)) return res.status(404).end();
  const img = await Image.findById(id).select('+data mime').lean();
  if (!img) return res.status(404).end();
  res.set({
    'Content-Type': img.mime,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  // .lean() returns a BSON Binary; convert its bytes (a Node Buffer's .buffer would be the whole memory pool).
  res.end(Buffer.isBuffer(img.data) ? img.data : Buffer.from(img.data.buffer));
}));

module.exports = { api, pub };
