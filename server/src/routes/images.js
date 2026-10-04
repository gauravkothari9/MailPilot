// Image library and downloadable files for email content: upload, import from a link, list, delete
// (logged in) and public serving.
const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const { Image, UploadPart } = require('../models');
const { wrap, oid, HttpError } = require('../utils');
const { uniqueTag, tagSlug, invalidateImages } = require('../services/imageTags');
const { sniffImage, imageSize, sniffFile } = require('../services/fileTypes');
const { fetchRemote } = require('../services/fetchRemote');

// Vercel forwards request bodies up to ~4.5 MB, so keep uploads under that.
const MAX_BYTES = 4 * 1024 * 1024;
// Links are downloaded by this server directly, so they aren't bound by the upload limit.
const MAX_LINK_BYTES = 10 * 1024 * 1024;
// Files for buttons can be big; they upload in parts of PART_BYTES (see /files/uploads).
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const PART_BYTES = 3 * 1024 * 1024;
const filesBucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'files' });
// defParamCharset: read file names as UTF-8 ("côte.png" would otherwise arrive as "cÃ´te.png").
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES }, defParamCharset: 'utf8' });
const single = (req, res, next) => upload.single('file')(req, res, (err) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return next(new HttpError(400, 'File is larger than 4 MB. Compress it (e.g. tinypng.com for images) and try again.'));
  next(err);
});

const toJson = (img) => ({
  _id: img._id, kind: img.kind || 'image', name: img.name, tag: img.tag, mime: img.mime, size: img.size, width: img.width, height: img.height, createdAt: img.createdAt,
  url: `/i/${img._id}.${img.ext}`,
});

const nameFromUrl = (url) => {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop()) || 'image'; } catch { return 'image'; }
};

async function saveImage(business, name, buffer, type, dims) {
  const size = dims?.width ? dims : imageSize(buffer, type.ext);
  const img = await Image.create({
    business, kind: 'image', name,
    tag: await uniqueTag(business, name.replace(/\.[^.]+$/, '')),
    mime: type.mime, ext: type.ext, size: buffer.length,
    width: size.width || undefined, height: size.height || undefined,
    data: buffer,
  });
  invalidateImages(business);
  return img;
}

// ---------- logged-in API ----------
const api = express.Router();

api.get('/businesses/:bid/images', wrap(async (req, res) => {
  const business = oid(req.params.bid);
  const rows = await Image.find({ business, kind: { $ne: 'file' } }).sort({ createdAt: -1 }).lean();
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
  const clash = await Image.exists({ business: img.business, kind: { $ne: 'file' }, tag: wanted, _id: { $ne: img._id } });
  if (clash) throw new HttpError(400, `Another image is already called "${wanted}"`);
  await Image.updateOne({ _id: img._id }, { tag: wanted });
  invalidateImages(img.business);
  res.json({ ...toJson({ ...img, tag: wanted }) });
}));

api.post('/businesses/:bid/images', single, wrap(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose an image file');
  const type = sniffImage(req.file.buffer);
  if (!type) throw new HttpError(400, 'Only JPG, PNG, GIF or WebP images are supported');
  const name = String(req.file.originalname || 'image').slice(0, 200);
  const img = await saveImage(oid(req.params.bid), name, req.file.buffer, type, { width: Number(req.body.width) || 0, height: Number(req.body.height) || 0 });
  res.json(toJson(img));
}));

// Copy an image from a web address into the library, so emails don't depend on the other site
// (which may block hotlinking, move the file or need a login).
api.post('/businesses/:bid/images/from-url', wrap(async (req, res) => {
  const { buffer, contentType, finalUrl } = await fetchRemote(req.body.url, { maxBytes: MAX_LINK_BYTES });
  const type = sniffImage(buffer);
  if (!type) {
    if (/text\/html/i.test(contentType)) throw new HttpError(400, 'That link opens a web page, not an image. Open the image, right-click it and choose "Copy image address", then paste that link.');
    if (/svg/i.test(contentType)) throw new HttpError(400, 'SVG images are not supported in email. Use a JPG or PNG.');
    throw new HttpError(400, 'That link is not a JPG, PNG, GIF or WebP image');
  }
  let name = nameFromUrl(String(finalUrl));
  if (!/\.(jpe?g|png|gif|webp)$/i.test(name)) name = `${nameFromUrl(req.body.url).replace(/\.[^.]+$/, '') || 'image'}.${type.ext}`;
  const img = await saveImage(oid(req.params.bid), name.slice(0, 200), buffer, type);
  res.json(toJson(img));
}));

// ---------- files (PDFs, documents…) for buttons and links ----------
api.get('/businesses/:bid/files', wrap(async (req, res) => {
  const rows = await Image.find({ business: oid(req.params.bid), kind: 'file' }).sort({ createdAt: -1 }).lean();
  res.json(rows.map(toJson));
}));

api.post('/businesses/:bid/files', single, wrap(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a file');
  const name = String(req.file.originalname || 'file').slice(0, 200);
  const type = sniffFile(req.file.buffer, name);
  if (!type) throw new HttpError(400, 'Supported files: PDF, Word, Excel, PowerPoint, ZIP, CSV, TXT, MP3, MP4 and images');
  const file = await Image.create({
    business: oid(req.params.bid), kind: 'file', name,
    mime: type.mime, ext: type.ext, size: req.file.size, data: req.file.buffer,
  });
  res.json(toJson(file));
}));

// Large files upload in parts: start → parts (each under the proxy's request limit) → finish.
// The finished file is stored in GridFS, which has no per-document size limit.
api.post('/businesses/:bid/files/uploads', wrap(async (req, res) => {
  const size = Number(req.body.size);
  if (!(size > 0)) throw new HttpError(400, 'Choose a file');
  if (size > MAX_FILE_BYTES) throw new HttpError(400, `Files can be up to ${MAX_FILE_BYTES / 1048576} MB`);
  res.json({ uploadId: new mongoose.Types.ObjectId(), partSize: PART_BYTES });
}));

api.post('/businesses/:bid/files/uploads/:uid/parts/:index', single, wrap(async (req, res) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= Math.ceil(MAX_FILE_BYTES / PART_BYTES)) throw new HttpError(400, 'Invalid part');
  if (!req.file || req.file.size > PART_BYTES) throw new HttpError(400, 'Invalid part');
  const business = oid(req.params.bid);
  const upload = oid(req.params.uid);
  await UploadPart.updateOne({ upload, index }, { business, data: req.file.buffer, createdAt: new Date() }, { upsert: true });
  res.json({ ok: true });
}));

api.post('/businesses/:bid/files/uploads/:uid/finish', wrap(async (req, res) => {
  const business = oid(req.params.bid);
  const upload = oid(req.params.uid);
  const parts = Number(req.body.parts);
  const name = String(req.body.name || 'file').slice(0, 200);
  const stored = await UploadPart.find({ upload, business }).select('index').sort({ index: 1 }).lean();
  if (!parts || stored.length !== parts || stored.some((p, i) => p.index !== i)) throw new HttpError(400, 'Some parts of the upload are missing. Please upload the file again.');
  const first = await UploadPart.findOne({ upload, index: 0 }).lean();
  const firstBuf = Buffer.isBuffer(first.data) ? first.data : Buffer.from(first.data.buffer);
  const type = sniffFile(firstBuf, name);
  if (!type) {
    await UploadPart.deleteMany({ upload });
    throw new HttpError(400, 'Supported files: PDF, Word, Excel, PowerPoint, ZIP, CSV, TXT, MP3, MP4 and images');
  }
  // Copy the parts in order into GridFS, one at a time to keep memory low.
  const stream = filesBucket().openUploadStream(name, { metadata: { business, mime: type.mime } });
  let size = 0;
  try {
    for (let i = 0; i < parts; i++) {
      const p = i === 0 ? first : await UploadPart.findOne({ upload, index: i }).lean();
      const buf = Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data.buffer);
      size += buf.length;
      if (size > MAX_FILE_BYTES) throw new HttpError(400, `Files can be up to ${MAX_FILE_BYTES / 1048576} MB`);
      if (!stream.write(buf)) await new Promise((ok) => stream.once('drain', ok));
    }
    await new Promise((ok, fail) => stream.end((err) => (err ? fail(err) : ok())));
  } catch (e) {
    stream.abort().catch(() => {});
    await UploadPart.deleteMany({ upload });
    throw e;
  }
  await UploadPart.deleteMany({ upload });
  const file = await Image.create({ business, kind: 'file', name, mime: type.mime, ext: type.ext, size, gridId: stream.id });
  res.json(toJson(file));
}));

// Copy a file (PDF, document…) from a web address into the file library.
api.post('/businesses/:bid/files/from-url', wrap(async (req, res) => {
  const { buffer, contentType, finalUrl } = await fetchRemote(req.body.url, { maxBytes: MAX_LINK_BYTES });
  let name = nameFromUrl(String(finalUrl));
  if (!/\.[a-z0-9]{2,4}$/i.test(name)) name = nameFromUrl(req.body.url);
  const type = sniffFile(buffer, name);
  if (!type) {
    if (/text\/html/i.test(contentType)) throw new HttpError(400, 'That link opens a web page, not a file. To link to the page, use the "Web page" tab instead.');
    throw new HttpError(400, 'Supported files: PDF, Word, Excel, PowerPoint, ZIP, CSV, TXT, MP3, MP4 and images');
  }
  if (!name.toLowerCase().endsWith(`.${type.ext}`)) name = `${name.replace(/\.[^.]+$/, '') || 'file'}.${type.ext}`;
  const file = await Image.create({
    business: oid(req.params.bid), kind: 'file', name: name.slice(0, 200),
    mime: type.mime, ext: type.ext, size: buffer.length, data: buffer,
  });
  res.json(toJson(file));
}));

api.delete('/images/:id', wrap(async (req, res) => {
  const img = await Image.findByIdAndDelete(oid(req.params.id)).select('business gridId').lean();
  if (img) invalidateImages(img.business);
  if (img?.gridId) await filesBucket().delete(img.gridId).catch(() => {});
  res.json({ ok: true });
}));

// ---------- public: loaded by recipients' email apps ----------
const pub = express.Router();

// Shown in the browser; everything else downloads.
const INLINE = /^(image\/|application\/pdf|video\/mp4|audio\/mpeg)/;

pub.get('/i/:file', wrap(async (req, res) => {
  const id = req.params.file.split('.')[0];
  if (!/^[a-f0-9]{24}$/.test(id)) return res.status(404).end();
  const img = await Image.findById(id).select('+data mime kind name size gridId').lean();
  if (!img) return res.status(404).end();
  if (img.gridId) res.set('Content-Length', String(img.size));
  res.set({
    'Content-Type': img.mime,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  if (img.kind === 'file') {
    const name = String(img.name || 'file');
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.set('Content-Disposition', `${INLINE.test(img.mime) ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  }
  if (img.gridId) {
    const download = filesBucket().openDownloadStream(img.gridId);
    download.on('error', () => (res.headersSent ? res.destroy() : res.status(404).end()));
    return download.pipe(res);
  }
  // .lean() returns a BSON Binary; convert its bytes (a Node Buffer's .buffer would be the whole memory pool).
  res.end(Buffer.isBuffer(img.data) ? img.data : Buffer.from(img.data.buffer));
}));

module.exports = { api, pub };
