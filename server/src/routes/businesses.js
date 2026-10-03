// Businesses, their sender email accounts, and global settings.
const router = require('express').Router();
const { Business, Sender, Contact, Campaign, List, Message, Event, Link, getSetting, setSetting } = require('../models');
const { encrypt } = require('../services/security');
const mailer = require('../services/mailer');
const { checkDomain } = require('../services/deliverability');
const { wrap, oid, int, EMAIL_RE, HttpError } = require('../utils');

// ---------- settings ----------

router.get('/settings', wrap(async (req, res) => {
  res.json({ public_url: await mailer.publicUrl(), saved: !!(await getSetting('public_url')) });
}));

router.put('/settings', wrap(async (req, res) => {
  const url = String(req.body.public_url || '').trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\/\S+$/i.test(url)) throw new HttpError(400, 'Public URL must start with http:// or https://');
  await setSetting('public_url', url);
  res.json({ ok: true });
}));

// ---------- businesses ----------

router.get('/businesses', wrap(async (req, res) => {
  const list = await Business.find().sort({ name: 1 }).lean();
  const counts = async (Model) => new Map((await Model.aggregate([{ $group: { _id: '$business', n: { $sum: 1 } } }])).map((r) => [String(r._id), r.n]));
  const [contacts, senders, campaigns] = await Promise.all([counts(Contact), counts(Sender), counts(Campaign)]);
  res.json(list.map((b) => ({ ...b, contacts: contacts.get(String(b._id)) || 0, senders: senders.get(String(b._id)) || 0, campaigns: campaigns.get(String(b._id)) || 0 })));
}));

const bizFields = (b) => {
  if (!b.name?.trim()) throw new HttpError(400, 'Business name is required');
  return { name: b.name.trim(), website: b.website || '', address: b.address || '', color: b.color || '#4f46e5' };
};

router.post('/businesses', wrap(async (req, res) => {
  res.json(await Business.create(bizFields(req.body)));
}));

router.put('/businesses/:id', wrap(async (req, res) => {
  await Business.updateOne({ _id: oid(req.params.id) }, bizFields(req.body));
  res.json({ ok: true });
}));

router.delete('/businesses/:id', wrap(async (req, res) => {
  const business = oid(req.params.id);
  const campaigns = await Campaign.find({ business }).distinct('_id');
  await Promise.all([
    Sender.deleteMany({ business }), List.deleteMany({ business }), Contact.deleteMany({ business }),
    Message.deleteMany({ business }), Event.deleteMany({ business }), Link.deleteMany({ campaign: { $in: campaigns } }),
    Campaign.deleteMany({ business }),
  ]);
  await Business.deleteOne({ _id: business });
  res.json({ ok: true });
}));

// ---------- senders ----------

router.get('/businesses/:bid/senders', wrap(async (req, res) => {
  const senders = await Sender.find({ business: oid(req.params.bid) }).sort({ createdAt: 1 }).lean();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const sent = await Message.aggregate([
    { $match: { sender: { $in: senders.map((s) => s._id) }, status: 'sent', sentAt: { $gte: start } } },
    { $group: { _id: '$sender', n: { $sum: 1 } } },
  ]);
  const map = new Map(sent.map((r) => [String(r._id), r.n]));
  res.json(senders.map((s) => ({ ...s, sentToday: map.get(String(s._id)) || 0 })));
}));

function senderFields(b, requirePass) {
  const f = {
    label: String(b.label || '').trim(),
    fromName: String(b.fromName || '').trim(),
    fromEmail: String(b.fromEmail || '').trim().toLowerCase(),
    replyTo: String(b.replyTo || '').trim(),
    smtpHost: String(b.smtpHost || '').trim(),
    smtpPort: int(b.smtpPort, 587),
    smtpSecure: !!b.smtpSecure,
    smtpUser: String(b.smtpUser || '').trim(),
    ratePerMinute: Math.max(1, int(b.ratePerMinute, 20)),
    dailyLimit: Math.max(1, int(b.dailyLimit, 500)),
  };
  if (!f.fromName || !EMAIL_RE.test(f.fromEmail) || !f.smtpHost || !f.smtpUser) throw new HttpError(400, 'From name, a valid from email, SMTP host and SMTP username are required');
  if (f.replyTo && !EMAIL_RE.test(f.replyTo)) throw new HttpError(400, 'Reply-to must be a valid email');
  if (requirePass && !b.smtpPass) throw new HttpError(400, 'SMTP password is required');
  if (b.smtpPass) f.smtpPassEnc = encrypt(b.smtpPass);
  return f;
}

router.post('/businesses/:bid/senders', wrap(async (req, res) => {
  const s = await Sender.create({ business: oid(req.params.bid), ...senderFields(req.body, true) });
  res.json({ _id: s._id, verify: await mailer.verifySender(s._id) });
}));

router.put('/senders/:id', wrap(async (req, res) => {
  const id = oid(req.params.id);
  await Sender.updateOne({ _id: id }, senderFields(req.body, false));
  res.json({ ok: true, verify: await mailer.verifySender(id) });
}));

router.delete('/senders/:id', wrap(async (req, res) => {
  mailer.dropTransport(req.params.id);
  await Sender.deleteOne({ _id: oid(req.params.id) });
  res.json({ ok: true });
}));

router.post('/senders/:id/verify', wrap(async (req, res) => {
  res.json(await mailer.verifySender(oid(req.params.id)));
}));

router.get('/senders/:id/deliverability', wrap(async (req, res) => {
  const s = await Sender.findById(oid(req.params.id)).lean();
  if (!s) throw new HttpError(404, 'Sender not found');
  res.json(await checkDomain(s.fromEmail));
}));

router.post('/senders/:id/test', wrap(async (req, res) => {
  const s = await Sender.findById(oid(req.params.id)).select('+smtpPassEnc');
  if (!s) throw new HttpError(404, 'Sender not found');
  const to = String(req.body.to || '').trim();
  if (!EMAIL_RE.test(to)) throw new HttpError(400, 'Enter a valid email address');
  const biz = await Business.findById(s.business).lean();
  try {
    await mailer.sendTest({
      subject: `Test email from ${s.fromName}`,
      html: `<p>Hi {{first_name}},</p><p>Your sender <b>${mailer.escapeHtml(s.fromEmail)}</b> is connected and working in MailPilot. 🎉</p>`,
    }, s, biz, to);
  } catch (e) { throw new HttpError(400, e.message); }
  res.json({ ok: true });
}));

module.exports = router;
