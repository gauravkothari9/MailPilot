const router = require('express').Router();
const { Campaign, Sender, List, Contact, Business, Message, Link, Event } = require('../models');
const mailer = require('../services/mailer');
const { variantStats } = require('../services/abtest');
const { wrap, oid, int, escapeRegex, sendCsv, statsFor, statsByCampaign, EMAIL_RE, HttpError } = require('../utils');

const STARTER_HTML = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f5f7;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="background:#ffffff;border-radius:12px;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:24px;color:#111827;">Hello {{first_name|there}} 👋</h1>
      <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">
        We have some exciting news from <b>{{business_name}}</b> that we think you'll love.
      </p>
      <p style="font-size:16px;line-height:1.6;margin:0 0 24px;">
        Write your message here. Any column from your Excel sheet works as a tag, like {{company}}.
      </p>
      <p style="text-align:center;margin:0 0 8px;">
        <a href="https://example.com" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold;">Shop now</a>
      </p>
    </div>
    <p style="text-align:center;font-size:12px;color:#6b7280;margin-top:20px;">
      {{business_name}} · <a href="{{unsubscribe_url}}" style="color:#6b7280;">Unsubscribe</a>
    </p>
  </div>
</body>
</html>`;

/** Real (non-bot) opens bucketed by weekday (0 = Sunday) and hour in the viewer's timezone. */
async function openHeatmap(match, tz) {
  let rows;
  try {
    rows = await Event.aggregate([
      { $match: { ...match, type: 'open', bot: { $ne: true } } },
      { $group: { _id: { d: { $dayOfWeek: { date: '$createdAt', timezone: tz } }, h: { $hour: { date: '$createdAt', timezone: tz } } }, n: { $sum: 1 } } },
    ]);
  } catch {
    return openHeatmap(match, 'UTC');
  }
  return rows.map((r) => ({ day: r._id.d - 1, hour: r._id.h, n: r.n }));
}

async function load(id) {
  const c = await Campaign.findById(oid(id));
  if (!c) throw new HttpError(404, 'Campaign not found');
  return c;
}

router.get('/businesses/:bid/campaigns', wrap(async (req, res) => {
  const rows = await Campaign.find({ business: oid(req.params.bid) }).sort({ _id: -1 }).select('-html')
    .populate('sender', 'fromEmail fromName').populate('list', 'name').populate('sourceCampaign', 'name').lean();
  const stats = await statsByCampaign(rows.map((r) => r._id));
  res.json(rows.map((r) => ({ ...r, stats: stats(r._id) })));
}));

router.post('/businesses/:bid/campaigns', wrap(async (req, res) => {
  const business = oid(req.params.bid);
  const [sender, list] = await Promise.all([Sender.findOne({ business }).sort({ _id: 1 }), List.findOne({ business }).sort({ _id: -1 })]);
  const c = await Campaign.create({ business, sender: sender?._id, list: list?._id, name: String(req.body.name || 'Untitled campaign'), html: STARTER_HTML });
  res.json(c);
}));

router.get('/campaigns/:id', wrap(async (req, res) => {
  const c = (await load(req.params.id)).toObject();
  res.json({ ...c, stats: await statsFor({ campaign: c._id }) });
}));

router.put('/campaigns/:id', wrap(async (req, res) => {
  const c = await load(req.params.id);
  if (!['draft', 'paused'].includes(c.status)) throw new HttpError(400, 'Only draft or paused campaigns can be edited');
  const b = req.body;
  for (const k of ['name', 'subject', 'preheader', 'html', 'trackOpens', 'trackClicks', 'audience']) if (b[k] !== undefined) c[k] = b[k];
  for (const k of ['sender', 'list', 'sourceCampaign']) if (b[k] !== undefined) c[k] = b[k] ? oid(b[k]) : undefined;
  if (Array.isArray(b.rules)) c.rules = b.rules.filter((r) => r && r.field && r.op).map((r) => ({ field: String(r.field), op: String(r.op), value: String(r.value ?? '') }));
  if (b.abTest && typeof b.abTest === 'object' && c.status === 'draft') {
    const a = b.abTest;
    c.abTest.enabled = !!a.enabled;
    if (a.subjectB !== undefined) c.abTest.subjectB = String(a.subjectB);
    if (a.testPercent !== undefined) c.abTest.testPercent = Math.min(100, Math.max(2, int(a.testPercent, 20)));
    if (a.waitHours !== undefined) c.abTest.waitHours = Math.max(0, Number(a.waitHours) || 0);
    if (a.metric !== undefined) c.abTest.metric = a.metric === 'clicks' ? 'clicks' : 'opens';
  }
  await c.save();
  res.json({ ok: true });
}));

router.delete('/campaigns/:id', wrap(async (req, res) => {
  const id = oid(req.params.id);
  await Promise.all([Message.deleteMany({ campaign: id }), Event.deleteMany({ campaign: id }), Link.deleteMany({ campaign: id }), Campaign.deleteOne({ _id: id })]);
  res.json({ ok: true });
}));

router.post('/campaigns/:id/duplicate', wrap(async (req, res) => {
  const c = await load(req.params.id);
  const copy = await Campaign.create({
    business: c.business, sender: c.sender, list: c.list, name: `${c.name} (copy)`, subject: c.subject, preheader: c.preheader,
    html: c.html, trackOpens: c.trackOpens, trackClicks: c.trackClicks, rules: c.rules,
    abTest: { enabled: c.abTest?.enabled, subjectB: c.abTest?.subjectB, testPercent: c.abTest?.testPercent, waitHours: c.abTest?.waitHours, metric: c.abTest?.metric },
  });
  res.json(copy);
}));

// Follow-up campaign aimed at people who didn't open / click this one.
router.post('/campaigns/:id/follow-up', wrap(async (req, res) => {
  const c = await load(req.params.id);
  const audience = req.body.audience === 'non_clickers' ? 'non_clickers' : 'non_openers';
  const copy = await Campaign.create({
    business: c.business, sender: c.sender, audience, sourceCampaign: c._id,
    name: `${c.name} – ${audience === 'non_openers' ? 'resend to non-openers' : 'follow-up to non-clickers'}`,
    subject: c.subject, preheader: c.preheader, html: c.html, trackOpens: c.trackOpens, trackClicks: c.trackClicks,
  });
  res.json(copy);
}));

async function sampleContact(c) {
  const q = await mailer.audienceQuery(c);
  return (await Contact.findOne(q)) || { email: 'alex@example.com', firstName: 'Alex', lastName: 'Sample', company: 'Sample Co', phone: '', fields: {} };
}

router.get('/campaigns/:id/audience', wrap(async (req, res) => {
  const c = await load(req.params.id);
  const ok = c.audience === 'list' ? !!c.list : !!c.sourceCampaign;
  res.json({ count: ok ? await Contact.countDocuments(await mailer.audienceQuery(c)) : 0 });
}));

router.post('/campaigns/:id/preview', wrap(async (req, res) => {
  const c = await load(req.params.id);
  for (const k of ['subject', 'preheader', 'html', 'audience']) if (req.body[k] !== undefined) c[k] = req.body[k];
  for (const k of ['list', 'sourceCampaign']) if (req.body[k]) c[k] = oid(req.body[k]);
  const [biz, contact] = await Promise.all([Business.findById(c.business).lean(), sampleContact(c)]);
  const r = await mailer.renderEmail(c, contact, biz, { token: null });
  res.json({ ...r, sampleEmail: contact.email, tags: Object.keys(mailer.contactVars(contact, biz)) });
}));

router.post('/campaigns/:id/test', wrap(async (req, res) => {
  const c = await load(req.params.id);
  const s = c.sender && (await Sender.findById(c.sender).select('+smtpPassEnc'));
  if (!s) throw new HttpError(400, 'Choose a sender email first');
  const tos = String(req.body.to || '').split(/[,;\s]+/).filter(Boolean);
  if (!tos.length || !tos.every((t) => EMAIL_RE.test(t))) throw new HttpError(400, 'Enter valid email address(es)');
  const [biz, contact] = await Promise.all([Business.findById(c.business).lean(), sampleContact(c)]);
  try {
    for (const to of tos.slice(0, 5)) await mailer.sendTest(c, s, biz, to, contact._id ? contact : null);
  } catch (e) { throw new HttpError(400, e.message); }
  res.json({ ok: true });
}));

router.post('/campaigns/:id/send', wrap(async (req, res) => {
  const c = await load(req.params.id);
  if (c.status !== 'draft') throw new HttpError(400, 'This campaign was already sent or scheduled');
  if (!c.subject.trim()) throw new HttpError(400, 'Add a subject line');
  if (!c.html.trim()) throw new HttpError(400, 'Add email content');
  if (!c.sender) throw new HttpError(400, 'Choose a sender email');
  if (c.audience === 'list' && !c.list) throw new HttpError(400, 'Choose a contact list');
  if (c.abTest?.enabled && !c.abTest.subjectB.trim()) throw new HttpError(400, 'Add subject B for the A/B test, or turn the test off');
  const count = await Contact.countDocuments(await mailer.audienceQuery(c));
  if (!count) throw new HttpError(400, 'No subscribed contacts match this audience');
  if (req.body.scheduledAt) {
    const when = new Date(req.body.scheduledAt);
    if (isNaN(when) || when < Date.now() - 60000) throw new HttpError(400, 'Pick a time in the future');
    c.status = 'scheduled';
    c.scheduledAt = when;
    await c.save();
    return res.json({ ok: true, scheduledAt: when, recipients: count });
  }
  res.json({ ok: true, queued: await mailer.queueCampaign(c._id) });
}));

router.post('/campaigns/:id/pause', wrap(async (req, res) => {
  await Campaign.updateOne({ _id: oid(req.params.id), status: { $in: ['sending', 'testing'] } }, { status: 'paused', note: 'Paused by you' });
  res.json({ ok: true });
}));

router.post('/campaigns/:id/resume', wrap(async (req, res) => {
  const c = await load(req.params.id);
  if (c.status !== 'paused') throw new HttpError(400, 'Campaign is not paused');
  if (!c.sender) throw new HttpError(400, 'Choose a sender email first');
  // An A/B test that was paused mid-test goes back to testing.
  c.status = c.abTest?.enabled && c.abTest.testEndsAt && !c.abTest.winner ? 'testing' : 'sending';
  c.note = undefined;
  await c.save();
  res.json({ ok: true });
}));

router.post('/campaigns/:id/cancel', wrap(async (req, res) => {
  const c = await load(req.params.id);
  if (c.status === 'scheduled') {
    c.status = 'draft';
    c.scheduledAt = undefined;
  } else if (['sending', 'testing', 'paused'].includes(c.status)) {
    await Message.updateMany({ campaign: c._id, status: 'queued' }, { status: 'skipped', error: 'Campaign stopped' });
    Object.assign(c, { status: 'sent', note: 'Stopped before finishing', finishedAt: new Date() });
  }
  await c.save();
  res.json({ ok: true });
}));

router.post('/campaigns/:id/retry-failed', wrap(async (req, res) => {
  const c = await load(req.params.id);
  const r = await Message.updateMany({ campaign: c._id, status: 'failed' }, { status: 'queued', $unset: { error: 1 } });
  if (r.modifiedCount) {
    Object.assign(c, { status: 'sending', note: undefined, finishedAt: undefined });
    await c.save();
  }
  res.json({ requeued: r.modifiedCount });
}));

router.post('/campaigns/:id/ab-winner', wrap(async (req, res) => {
  const c = await load(req.params.id);
  if (c.status !== 'testing' && !(c.status === 'paused' && c.abTest?.testEndsAt && !c.abTest.winner)) throw new HttpError(400, 'This campaign is not waiting on an A/B test');
  const winner = req.body.winner === 'B' ? 'B' : 'A';
  c.abTest.winner = winner;
  c.abTest.decidedAt = new Date();
  await c.save();
  res.json({ ok: true, queued: await mailer.queueCampaign(c._id) });
}));

// ---------- reporting ----------

router.get('/campaigns/:id/report', wrap(async (req, res) => {
  const id = oid(req.params.id);
  const campaign = await Campaign.findById(id).select('-html').populate('sender', 'fromEmail fromName').populate('list', 'name').populate('sourceCampaign', 'name').lean();
  if (!campaign) throw new HttpError(404, 'Campaign not found');
  const tz = String(req.query.tz || 'UTC');
  const [stats, links, linkClicks, timeline, opens, recent, heatmap, variants, bots] = await Promise.all([
    statsFor({ campaign: id }),
    Link.find({ campaign: id }).lean(),
    Event.aggregate([{ $match: { campaign: id, type: 'click', bot: { $ne: true } } }, { $group: { _id: '$link', clicks: { $sum: 1 }, people: { $addToSet: '$message' } } }]),
    Event.aggregate([
      { $match: { campaign: id, type: { $in: ['sent', 'open', 'click'] }, bot: { $ne: true } } },
      { $group: { _id: { bucket: { $dateToString: { format: '%Y-%m-%dT%H:00:00Z', date: '$createdAt' } }, type: '$type' }, n: { $sum: 1 } } },
      { $sort: { '_id.bucket': 1 } },
    ]),
    Event.find({ campaign: id, type: 'open', bot: { $ne: true } }).select('userAgent').lean(),
    Event.find({ campaign: id }).sort({ _id: -1 }).limit(50).lean(),
    openHeatmap({ campaign: id }, tz),
    campaign.abTest?.enabled ? variantStats(id) : null,
    Event.countDocuments({ campaign: id, bot: true }),
  ]);
  const lc = new Map(linkClicks.map((l) => [String(l._id), l]));
  const devices = { Mobile: 0, Desktop: 0, 'Gmail / image proxy': 0, Other: 0 };
  for (const { userAgent: ua = '' } of opens) {
    if (/GoogleImageProxy|YahooMailProxy|ggpht/i.test(ua)) devices['Gmail / image proxy']++;
    else if (/Mobile|Android|iPhone|iPad/i.test(ua)) devices.Mobile++;
    else if (/Windows|Macintosh|Linux|Thunderbird|Outlook/i.test(ua)) devices.Desktop++;
    else devices.Other++;
  }
  res.json({
    campaign, stats, devices, recent, heatmap, variants, botEvents: bots,
    links: links.map((l) => ({ ...l, clicks: lc.get(String(l._id))?.clicks || 0, uniqueClicks: lc.get(String(l._id))?.people.length || 0 })).sort((a, b) => b.clicks - a.clicks),
    timeline: timeline.map((t) => ({ bucket: t._id.bucket, type: t._id.type, n: t.n })),
  });
}));

function recipientQuery(req) {
  const q = { campaign: oid(req.params.id) };
  const f = req.query.filter;
  if (f === 'sent') q.status = 'sent';
  if (f === 'failed') q.status = 'failed';
  if (f === 'queued') q.status = { $in: ['queued', 'sending'] };
  if (f === 'skipped') q.status = 'skipped';
  if (f === 'opened') q.openedAt = { $ne: null };
  if (f === 'not_opened') Object.assign(q, { status: 'sent', openedAt: null });
  if (f === 'clicked') q.clickedAt = { $ne: null };
  if (f === 'unsubscribed') q.unsubscribedAt = { $ne: null };
  if (req.query.q) q.email = new RegExp(escapeRegex(req.query.q), 'i');
  return q;
}

router.get('/campaigns/:id/recipients', wrap(async (req, res) => {
  const q = recipientQuery(req);
  const per = Math.min(200, int(req.query.per, 50));
  const page = Math.max(1, int(req.query.page, 1));
  const [total, rows] = await Promise.all([
    Message.countDocuments(q),
    Message.find(q).sort({ _id: 1 }).skip((page - 1) * per).limit(per).populate('contact', 'firstName lastName').lean(),
  ]);
  res.json({ total, page, per, rows });
}));

router.get('/campaigns/:id/recipients/export', wrap(async (req, res) => {
  const rows = await Message.find(recipientQuery(req)).sort({ _id: 1 }).populate('contact', 'firstName lastName').lean();
  sendCsv(res, `campaign-${req.params.id}-recipients.csv`,
    rows.map((r) => ({ ...r, firstName: r.contact?.firstName, lastName: r.contact?.lastName })),
    ['email', 'firstName', 'lastName', 'status', 'error', 'sentAt', 'openedAt', 'openCount', 'clickedAt', 'clickCount', 'unsubscribedAt']);
}));

router.get('/messages/:id', wrap(async (req, res) => {
  const m = await Message.findById(oid(req.params.id)).populate('contact', 'firstName lastName').populate('campaign', 'name subject').lean();
  if (!m) throw new HttpError(404, 'Not found');
  m.events = await Event.find({ message: m._id }).sort({ _id: 1 }).lean();
  res.json(m);
}));

module.exports = router;
module.exports.openHeatmap = openHeatmap;
