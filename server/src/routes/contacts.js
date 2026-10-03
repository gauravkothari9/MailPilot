// Lists, contacts and Excel/CSV import.
const router = require('express').Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { List, Contact, Message, Event } = require('../models');
const { randomToken } = require('../services/security');
const { wrap, oid, int, slug, escapeRegex, sendCsv, EMAIL_RE, HttpError } = require('../utils');

const cleanTags = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(','))
  .map((t) => String(t).trim().toLowerCase()).filter(Boolean))];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ---------- lists ----------

router.get('/businesses/:bid/lists', wrap(async (req, res) => {
  const business = oid(req.params.bid);
  const lists = await List.find({ business }).sort({ createdAt: -1 }).lean();
  const counts = await Contact.aggregate([
    { $match: { business } },
    { $unwind: '$lists' },
    { $group: { _id: '$lists', contacts: { $sum: 1 }, active: { $sum: { $cond: [{ $or: ['$unsubscribed', '$bounced'] }, 0, 1] } } } },
  ]);
  const map = new Map(counts.map((c) => [String(c._id), c]));
  res.json(lists.map((l) => ({ ...l, contacts: map.get(String(l._id))?.contacts || 0, active: map.get(String(l._id))?.active || 0 })));
}));

router.post('/businesses/:bid/lists', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new HttpError(400, 'List name is required');
  res.json(await List.create({ business: oid(req.params.bid), name }));
}));

router.put('/lists/:id', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new HttpError(400, 'List name is required');
  await List.updateOne({ _id: oid(req.params.id) }, { name });
  res.json({ ok: true });
}));

router.delete('/lists/:id', wrap(async (req, res) => {
  const id = oid(req.params.id);
  if (req.query.withContacts === '1') {
    // Remove contacts that only belong to this list.
    await Contact.deleteMany({ lists: [id] });
  }
  await Contact.updateMany({ lists: id }, { $pull: { lists: id } });
  await List.deleteOne({ _id: id });
  res.json({ ok: true });
}));

// ---------- import ----------

const pending = new Map();
setInterval(() => {
  for (const [k, v] of pending) if (Date.now() - v.at > 30 * 60000) pending.delete(k);
}, 60000).unref();

function guessMapping(headers) {
  const map = {};
  const norm = (h) => h.toLowerCase().replace(/[^a-z]/g, '');
  const used = () => Object.values(map);
  const find = (tests) => headers.find((h) => !used().includes(h) && tests.some((t) => (t instanceof RegExp ? t.test(norm(h)) : norm(h) === t)));
  map.email = find(['email', 'emailaddress', 'mail', 'emailid', 'mailid', /email/, /mail/]);
  map.firstName = find(['firstname', 'first', 'fname', 'givenname', /firstname/]);
  map.lastName = find(['lastname', 'last', 'lname', 'surname', 'familyname', /lastname/]);
  if (!map.firstName) map.fullName = find(['name', 'fullname', 'contactname', 'customername', 'clientname', /name$/]);
  map.company = find(['company', 'companyname', 'organization', 'organisation', 'business', 'businessname', 'firm', /company/]);
  map.phone = find(['phone', 'phonenumber', 'mobile', 'mobilenumber', 'contactnumber', 'cell', 'tel', 'telephone', 'whatsapp', /phone/, /mobile/]);
  Object.keys(map).forEach((k) => map[k] === undefined && delete map[k]);
  return map;
}

router.post('/businesses/:bid/import/preview', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose an Excel (.xlsx, .xls) or CSV file');
  let wb;
  try { wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true }); } catch { throw new HttpError(400, 'Could not read this file. Save it as .xlsx or .csv and try again.'); }
  const sheet = req.body.sheet && wb.SheetNames.includes(req.body.sheet) ? req.body.sheet : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '', raw: false });
  if (!rows.length) throw new HttpError(400, 'That sheet has no rows. Make sure the first row contains column headers.');
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((h) => !/^__EMPTY/.test(h));
  const uploadId = randomToken(12);
  pending.set(uploadId, { rows, headers, at: Date.now(), filename: req.file.originalname, business: req.params.bid });
  res.json({ uploadId, filename: req.file.originalname, sheets: wb.SheetNames, sheet, headers, total: rows.length, sample: rows.slice(0, 8), mapping: guessMapping(headers) });
}));

router.post('/businesses/:bid/import/commit', wrap(async (req, res) => {
  const business = oid(req.params.bid);
  const { uploadId, mapping = {}, listId, newListName, extraColumns = true, updateExisting = true } = req.body;
  const tags = cleanTags(req.body.tags);
  const up = pending.get(uploadId);
  if (!up || up.business !== req.params.bid) throw new HttpError(400, 'Upload expired. Please upload the file again.');
  if (!mapping.email) throw new HttpError(400, 'Select which column contains the email address');

  let list;
  if (listId) {
    list = await List.findOne({ _id: oid(listId), business });
    if (!list) throw new HttpError(404, 'List not found');
  } else {
    list = await List.create({ business, name: String(newListName || '').trim() || up.filename.replace(/\.[^.]+$/, '') });
  }

  const mapped = new Set(Object.values(mapping).filter(Boolean));
  const extras = extraColumns ? up.headers.filter((h) => !mapped.has(h)) : [];
  const stats = { listId: list._id, listName: list.name, added: 0, updated: 0, existing: 0, invalid: 0, duplicateInFile: 0, invalidRows: [] };
  const seen = new Set();
  const records = [];

  up.rows.forEach((row, i) => {
    const get = (k) => (mapping[k] ? String(row[mapping[k]] ?? '').trim() : '');
    const email = get('email').replace(/^mailto:/i, '').toLowerCase();
    if (!EMAIL_RE.test(email)) {
      stats.invalid++;
      if (stats.invalidRows.length < 20) stats.invalidRows.push({ row: i + 2, value: get('email') });
      return;
    }
    if (seen.has(email)) { stats.duplicateInFile++; return; }
    seen.add(email);
    let firstName = get('firstName');
    let lastName = get('lastName');
    const full = get('fullName');
    if (full && !firstName && !lastName) {
      const parts = full.split(/\s+/);
      firstName = parts.shift();
      lastName = parts.join(' ');
    }
    const fields = {};
    for (const h of extras) if (String(row[h] ?? '').trim() !== '') fields[slug(h)] = String(row[h]).trim();
    records.push({ email, firstName, lastName, company: get('company'), phone: get('phone'), fields });
  });

  const existing = new Set((await Contact.find({ business, email: { $in: records.map((r) => r.email) } }).select('email').lean()).map((c) => c.email));
  const ops = records.map((r) => {
    const isNew = !existing.has(r.email);
    if (isNew) stats.added++;
    else if (updateExisting) stats.updated++;
    else stats.existing++;
    const set = {};
    if (isNew || updateExisting) {
      for (const k of ['firstName', 'lastName', 'company', 'phone']) if (r[k]) set[k] = r[k];
      for (const [k, v] of Object.entries(r.fields)) set[`fields.${k}`] = v;
    }
    const update = { $addToSet: { lists: list._id, ...(tags.length ? { tags: { $each: tags } } : {}) } };
    if (Object.keys(set).length) update.$set = set;
    return { updateOne: { filter: { business, email: r.email }, update, upsert: true } };
  });
  for (let i = 0; i < ops.length; i += 1000) await Contact.bulkWrite(ops.slice(i, i + 1000), { ordered: false });

  pending.delete(uploadId);
  res.json(stats);
}));

// ---------- contacts ----------

/**
 * 0-100: open rate weighs 50, click rate 35, recency of last open 15 (decays over 90 days).
 * null when the contact has never been emailed.
 */
function engagementScore(e) {
  if (!e || !e.sent) return null;
  const recency = e.lastOpen ? Math.max(0, 1 - (Date.now() - new Date(e.lastOpen).getTime()) / (90 * 86400000)) : 0;
  return Math.round(Math.min(1, e.opened / e.sent) * 50 + Math.min(1, e.clicked / e.sent) * 35 + recency * 15);
}

router.get('/businesses/:bid/tags', wrap(async (req, res) => {
  const rows = await Contact.aggregate([
    { $match: { business: oid(req.params.bid) } }, { $unwind: '$tags' },
    { $group: { _id: '$tags', count: { $sum: 1 } } }, { $sort: { count: -1 } },
  ]);
  res.json(rows.map((r) => ({ tag: r._id, count: r.count })));
}));

// Custom columns imported from Excel, used by the segment builder and merge-tag picker.
router.get('/businesses/:bid/fields', wrap(async (req, res) => {
  const rows = await Contact.aggregate([
    { $match: { business: oid(req.params.bid) } },
    { $project: { kv: { $objectToArray: { $ifNull: ['$fields', {}] } } } }, { $unwind: '$kv' },
    { $group: { _id: '$kv.k', count: { $sum: 1 } } }, { $sort: { _id: 1 } },
  ]);
  res.json(rows.map((r) => ({ field: r._id, count: r.count })));
}));

function contactQuery(req) {
  const q = { business: oid(req.params.bid) };
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    q.$or = [{ email: rx }, { firstName: rx }, { lastName: rx }, { company: rx }, { phone: rx }];
  }
  if (req.query.list) q.lists = oid(req.query.list);
  if (req.query.tag) q.tags = String(req.query.tag).toLowerCase();
  if (req.query.status === 'subscribed') Object.assign(q, { unsubscribed: false, bounced: false });
  if (req.query.status === 'unsubscribed') q.unsubscribed = true;
  if (req.query.status === 'bounced') q.bounced = true;
  return q;
}

router.get('/businesses/:bid/contacts', wrap(async (req, res) => {
  const q = contactQuery(req);
  const per = Math.min(200, int(req.query.per, 50));
  const page = Math.max(1, int(req.query.page, 1));
  const [total, rows, lists] = await Promise.all([
    Contact.countDocuments(q),
    Contact.find(q).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * per).limit(per).lean(),
    List.find({ business: q.business }).select('name').lean(),
  ]);
  const listName = new Map(lists.map((l) => [String(l._id), l.name]));
  const engagement = await Message.aggregate([
    { $match: { contact: { $in: rows.map((r) => r._id) } } },
    { $group: { _id: '$contact', sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } }, opened: { $sum: { $cond: [{ $gt: ['$openedAt', null] }, 1, 0] } }, clicked: { $sum: { $cond: [{ $gt: ['$clickedAt', null] }, 1, 0] } }, lastOpen: { $max: '$openedAt' } } },
  ]);
  const eng = new Map(engagement.map((e) => [String(e._id), e]));
  res.json({
    total, page, per,
    rows: rows.map((r) => ({
      ...r,
      listNames: (r.lists || []).map((id) => listName.get(String(id))).filter(Boolean),
      sent: eng.get(String(r._id))?.sent || 0,
      opened: eng.get(String(r._id))?.opened || 0,
      clicked: eng.get(String(r._id))?.clicked || 0,
      score: engagementScore(eng.get(String(r._id))),
      lastOpen: eng.get(String(r._id))?.lastOpen || null,
    })),
  });
}));

router.get('/businesses/:bid/contacts/export', wrap(async (req, res) => {
  const rows = await Contact.find(contactQuery(req)).sort({ _id: 1 }).lean();
  const extra = new Set();
  rows.forEach((r) => Object.keys(r.fields || {}).forEach((k) => extra.add(k)));
  const out = rows.map((r) => ({ ...r.fields, ...r, tags: (r.tags || []).join(', '), status: r.unsubscribed ? 'unsubscribed' : r.bounced ? 'bounced' : 'subscribed' }));
  sendCsv(res, 'contacts.csv', out, ['email', 'firstName', 'lastName', 'company', 'phone', 'tags', 'status', 'createdAt', ...extra]);
}));

router.post('/businesses/:bid/contacts', wrap(async (req, res) => {
  const business = oid(req.params.bid);
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email');
  if (await Contact.exists({ business, email })) throw new HttpError(400, 'This contact already exists');
  const c = await Contact.create({
    business, email,
    firstName: req.body.firstName || '', lastName: req.body.lastName || '', company: req.body.company || '', phone: req.body.phone || '',
    lists: (req.body.lists || []).map(oid),
    tags: cleanTags(req.body.tags),
  });
  res.json(c);
}));

router.get('/contacts/:id', wrap(async (req, res) => {
  const c = await Contact.findById(oid(req.params.id)).lean();
  if (!c) throw new HttpError(404, 'Not found');
  const [messages, events] = await Promise.all([
    Message.find({ contact: c._id }).sort({ _id: -1 }).populate('campaign', 'name subject').lean(),
    Event.find({ message: { $in: await Message.find({ contact: c._id }).distinct('_id') } }).sort({ _id: -1 }).limit(200).populate('campaign', 'name').lean(),
  ]);
  res.json({ ...c, messages, events });
}));

router.put('/contacts/:id', wrap(async (req, res) => {
  const c = await Contact.findById(oid(req.params.id));
  if (!c) throw new HttpError(404, 'Not found');
  const b = req.body;
  if (b.email !== undefined) {
    const email = String(b.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email');
    c.email = email;
  }
  for (const k of ['firstName', 'lastName', 'company', 'phone']) if (b[k] !== undefined) c[k] = b[k];
  if (b.unsubscribed !== undefined) {
    c.unsubscribed = !!b.unsubscribed;
    c.unsubscribedAt = b.unsubscribed ? c.unsubscribedAt || new Date() : undefined;
  }
  if (b.bounced !== undefined) c.bounced = !!b.bounced;
  if (Array.isArray(b.lists)) c.lists = b.lists.map(oid);
  if (b.tags !== undefined) c.tags = cleanTags(b.tags);
  if (b.fields && typeof b.fields === 'object') c.fields = new Map(Object.entries(b.fields).map(([k, v]) => [slug(k), String(v)]));
  try { await c.save(); } catch (e) {
    throw new HttpError(400, e.code === 11000 ? 'Another contact already uses this email' : e.message);
  }
  res.json({ ok: true });
}));

router.post('/contacts/bulk', wrap(async (req, res) => {
  const ids = (req.body.ids || []).map(oid);
  const { action, listId } = req.body;
  let r;
  if (action === 'delete') r = await Contact.deleteMany({ _id: { $in: ids } });
  else if (action === 'addToList') r = await Contact.updateMany({ _id: { $in: ids } }, { $addToSet: { lists: oid(listId) } });
  else if (action === 'removeFromList') r = await Contact.updateMany({ _id: { $in: ids } }, { $pull: { lists: oid(listId) } });
  else if (action === 'addTag') r = await Contact.updateMany({ _id: { $in: ids } }, { $addToSet: { tags: { $each: cleanTags(req.body.tag) } } });
  else if (action === 'removeTag') r = await Contact.updateMany({ _id: { $in: ids } }, { $pullAll: { tags: cleanTags(req.body.tag) } });
  else if (action === 'unsubscribe') r = await Contact.updateMany({ _id: { $in: ids } }, { unsubscribed: true, unsubscribedAt: new Date() });
  else throw new HttpError(400, 'Unknown action');
  res.json({ affected: r.deletedCount ?? r.modifiedCount });
}));

module.exports = router;
