// Image library for email content: upload, list, delete (logged in) and public serving.
const express = require('express');
const multer = require('multer');
const { Image } = require('../models');
const { wrap, oid, HttpError } = require('../utils');
const { uniqueTag, tagSlug, invalidateImages } = require('../services/imageTags');

// Vercel forwards request bodies up to ~4.5 MB, so keep uploads under that.
const MAX_BYTES = 4 * 1024 * 1024;
// defParamCharset: read file names as UTF-8 ("côte.png" would otherwise arrive as "cÃ´te.png").
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES }, defParamCharset: 'utf8' });

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
  _id: img._id, name: img.name, tag: img.tag, mime: img.mime, size: img.size, width: img.width, height: img.height, createdAt: img.createdAt,
  url: `/i/${img._id}.${img.ext}`,
});

// ---------- logged-in API ----------
const api = express.Router();

api.get('/businesses/:bid/images', wrap(async (req, res) => {
  const business = oid(req.params.bid);
  const rows = await Image.find({ business }).sort({ createdAt: -1 }).lean();
  // Images uploaded before tags existed get one now (oldest first, so names stay stable).
  const untagged = rows.filter((r) => !r.tag).reverse();
  for (const r of untagged) {
    r.tag = await uniqueTag(business, (r.name || 'image').replace(/\.[^.]+$/, ''));
    await Image.updateOne({ _id: r._id }, { tag: r.tag });
  }
  if (untagged.length) invalidateImages(business);
  res.json(rows.map(toJson));
}));

// Rename an image's tag. Emails already sent keep working (they use the image address, not the tag).
api.put('/images/:id', wrap(async (req, res) => {
  const img = await Image.findById(oid(req.params.id)).lean();
  if (!img) throw new HttpError(404, 'Image not found');
  const wanted = tagSlug(req.body.tag);
  if (!wanted) throw new HttpError(400, 'Use letters, numbers and underscores, e.g. logo or banner_norway');
  const clash = await Image.exists({ business: img.business, tag: wanted, _id: { $ne: img._id } });
  if (clash) throw new HttpError(400, `Another image is already called "${wanted}"`);
  await Image.updateOne({ _id: img._id }, { tag: wanted });
  invalidateImages(img.business);
  res.json({ ...toJson({ ...img, tag: wanted }) });
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
  const business = oid(req.params.bid);
  const name = String(req.file.originalname || 'image').slice(0, 200);
  const img = await Image.create({
    business, name,
    tag: await uniqueTag(business, name.replace(/\.[^.]+$/, '')),
    mime: type.mime, ext: type.ext, size: req.file.size,
    width: Number(req.body.width) || undefined, height: Number(req.body.height) || undefined,
    data: req.file.buffer,
  });
  invalidateImages(business);
  res.json(toJson(img));
}));

api.delete('/images/:id', wrap(async (req, res) => {
  const img = await Image.findByIdAndDelete(oid(req.params.id)).select('business').lean();
  if (img) invalidateImages(img.business);
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
