const nodemailer = require('nodemailer');
const { Sender, Business, Contact, Campaign, Message, Link, Event, getSetting } = require('../models');
const { decrypt, randomToken } = require('./security');
const { audienceQuery } = require('./audience');
const { pickWinner } = require('./abtest');
const { applyImageTags } = require('./imageTags');

async function publicUrl() {
  const url = (await getSetting('public_url')) || process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`;
  return url.replace(/\/+$/, '');
}

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- personalization ----------

function contactVars(contact, business) {
  const custom = contact.fields instanceof Map ? Object.fromEntries(contact.fields) : contact.fields || {};
  return {
    ...custom,
    email: contact.email,
    first_name: contact.firstName || '',
    last_name: contact.lastName || '',
    full_name: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
    company: contact.company || '',
    phone: contact.phone || '',
    business_name: business?.name || '',
    business_website: business?.website || '',
    business_address: business?.address || '',
  };
}

const MERGE_TAG = /\{\{\s*([\w.-]+)\s*(?:\|([^}]*))?\}\}/g;
const tagValue = (vars, key, fallback) => (vars[key] !== undefined && vars[key] !== '' ? vars[key] : (fallback ?? '').trim());

// {{tag}} or {{tag|fallback}}
function mergeTags(text, vars, escape) {
  return String(text || '').replace(MERGE_TAG, (m, key, fallback) => {
    const k = key.toLowerCase();
    if (k === 'unsubscribe_url') return m;
    const v = tagValue(vars, k, fallback);
    return escape ? escapeHtml(v) : String(v);
  });
}

/**
 * Tags inside link/image addresses must be URL-safe ("New Zealand" → "New%20Zealand", "+" kept).
 * A tag that starts the address (e.g. href="{{business_website}}") is the address itself, so it's left as is.
 */
function mergeUrlAttributes(html, vars) {
  return html.replace(/(\s(?:src|href|background)\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, value) => {
    if (!value.includes('{{')) return m;
    const merged = value.replace(MERGE_TAG, (t, key, fallback, offset) => {
      const k = key.toLowerCase();
      if (k === 'unsubscribe_url') return t;
      const v = String(tagValue(vars, k, fallback));
      return escapeHtml(offset === 0 ? v : encodeURIComponent(v));
    });
    return pre + q + merged + q;
  });
}

function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function getLinkId(campaignId, url) {
  const link = await Link.findOneAndUpdate({ campaign: campaignId, url }, { $setOnInsert: { campaign: campaignId, url } }, { upsert: true, new: true });
  return link._id;
}

/**
 * Builds subject/html/text for one recipient with tracking injected.
 * token === null disables tracking (previews and test sends).
 */
async function renderEmail(campaign, contact, business, { token = null, relativeAssets = false } = {}) {
  const base = await publicUrl();
  const vars = contactVars(contact, business);
  const unsubUrl = token ? `${base}/u/${token}` : `${base}/u/preview`;

  const subject = mergeTags(campaign.subject, vars, false);
  let html = await applyImageTags(campaign.html, business?._id, vars); // {{image:…}} first, it may contain [field]s
  html = mergeUrlAttributes(html, vars);
  html = mergeTags(html, vars, true);
  // Uploaded images are stored as /i/<id>.<ext>; emails need absolute URLs (the editor preview keeps them relative).
  if (!relativeAssets) html = html.replace(/(\s(?:src|href|background)\s*=\s*["'])\/i\//gi, `$1${base}/i/`);

  const hasUnsub = /\{\{\s*unsubscribe_url\s*\}\}/i.test(html);
  html = html.replace(/\{\{\s*unsubscribe_url\s*\}\}/gi, unsubUrl);

  if (!hasUnsub) {
    // Every marketing email must carry an unsubscribe link (CAN-SPAM / GDPR / Gmail & Yahoo bulk sender rules).
    const footer = `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font:12px/1.5 Arial,sans-serif;color:#6b7280;text-align:center">
  ${escapeHtml(business?.name || '')}${business?.address ? ' · ' + escapeHtml(business.address) : ''}<br>
  You received this email because you subscribed to our updates.
  <a href="${unsubUrl}" style="color:#6b7280">Unsubscribe</a>
</div>`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, footer + '</body>') : html + footer;
  }

  if (campaign.preheader) {
    const pre = `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(mergeTags(campaign.preheader, vars, false))}</div>`;
    html = /<body[^>]*>/i.test(html) ? html.replace(/(<body[^>]*>)/i, `$1${pre}`) : pre + html;
  }

  const text = htmlToText(html);

  if (token && campaign.trackClicks) {
    const matches = [...html.matchAll(/(<a\b[^>]*?\bhref\s*=\s*)(["'])(.*?)\2/gi)];
    const ids = new Map();
    for (const m of matches) {
      const url = m[3].replace(/&amp;/g, '&').trim();
      if (/^https?:\/\//i.test(url) && !url.startsWith(`${base}/u/`) && !ids.has(url)) ids.set(url, await getLinkId(campaign._id, url));
    }
    html = html.replace(/(<a\b[^>]*?\bhref\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, raw) => {
      const id = ids.get(raw.replace(/&amp;/g, '&').trim());
      return id ? `${pre}${q}${base}/t/c/${token}/${id}${q}` : m;
    });
  }

  if (token && campaign.trackOpens) {
    const pixel = `<img src="${base}/t/o/${token}.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" />`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, pixel + '</body>') : html + pixel;
  }

  return { subject, html, text, unsubUrl };
}

// ---------- SMTP transports ----------

const transports = new Map();

function getTransport(sender) {
  const id = String(sender._id);
  const sig = [sender.smtpHost, sender.smtpPort, sender.smtpSecure, sender.smtpUser, sender.smtpPassEnc].join('|');
  const cached = transports.get(id);
  if (cached && cached.sig === sig) return cached.transport;
  if (cached) cached.transport.close();
  const transport = nodemailer.createTransport({
    host: sender.smtpHost,
    port: Number(sender.smtpPort),
    secure: !!sender.smtpSecure,
    auth: { user: sender.smtpUser, pass: decrypt(sender.smtpPassEnc) },
    pool: true,
    maxConnections: 2,
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
  transports.set(id, { sig, transport });
  return transport;
}

function dropTransport(senderId) {
  const cached = transports.get(String(senderId));
  if (cached) cached.transport.close();
  transports.delete(String(senderId));
}

async function verifySender(senderId) {
  const sender = await Sender.findById(senderId).select('+smtpPassEnc');
  dropTransport(senderId);
  try {
    await getTransport(sender).verify();
    await Sender.updateOne({ _id: senderId }, { verified: true, $unset: { lastError: 1 } });
    return { ok: true };
  } catch (e) {
    await Sender.updateOne({ _id: senderId }, { verified: false, lastError: e.message });
    return { ok: false, error: e.message };
  }
}

const buildMail = (sender, to, r, headers = {}) => ({
  from: { name: sender.fromName, address: sender.fromEmail },
  replyTo: sender.replyTo || undefined,
  to,
  subject: r.subject,
  html: r.html,
  text: r.text,
  headers,
});

async function sendTest(campaign, sender, business, to, sampleContact) {
  const contact = sampleContact || { email: to, firstName: 'Alex', lastName: 'Sample', company: 'Sample Co', phone: '', fields: {} };
  const r = await renderEmail(campaign, contact, business, { token: null });
  r.subject = `[TEST] ${r.subject}`;
  return getTransport(sender).sendMail(buildMail(sender, to, r));
}

// ---------- audience & queue ----------

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const newMessage = (campaign, c, variant, abTestSlice) => ({
  campaign: campaign._id, business: campaign.business, sender: campaign.sender, contact: c._id, email: c.email, token: randomToken(18), variant, abTestSlice,
});

/**
 * Creates the message queue for a campaign.
 * With an undecided A/B test only the test slice is queued (half A, half B) and the campaign
 * enters 'testing'; everyone else is queued with the winning subject after the test window.
 */
async function queueCampaign(campaignId) {
  const campaign = await Campaign.findById(campaignId);
  const already = new Set((await Message.distinct('contact', { campaign: campaign._id })).map(String));
  const contacts = (await Contact.find(await audienceQuery(campaign)).select('_id email').lean()).filter((c) => !already.has(String(c._id)));
  const ab = campaign.abTest;
  let docs;

  if (ab?.enabled && ab.subjectB && !ab.winner && contacts.length >= 4) {
    const testSize = Math.max(2, Math.min(contacts.length, Math.ceil((contacts.length * ab.testPercent) / 100)));
    docs = shuffle(contacts).slice(0, testSize).map((c, i) => newMessage(campaign, c, i % 2 === 0 ? 'A' : 'B', true));
    campaign.status = testSize < contacts.length ? 'testing' : 'sending';
    campaign.abTest.testEndsAt = new Date(Date.now() + ab.waitHours * 3600000);
  } else {
    const variant = ab?.enabled && ab.subjectB ? ab.winner || 'A' : undefined;
    docs = contacts.map((c) => newMessage(campaign, c, variant));
    campaign.status = 'sending';
  }

  if (docs.length) await Message.insertMany(docs, { ordered: false });
  campaign.note = undefined;
  campaign.startedAt = campaign.startedAt || new Date();
  await campaign.save();
  return docs.length;
}

async function decideAbWinner(campaignId) {
  const campaign = await Campaign.findById(campaignId);
  campaign.abTest.winner = await pickWinner(campaign);
  campaign.abTest.decidedAt = new Date();
  await campaign.save();
  return queueCampaign(campaign._id);
}

// ---------- worker ----------

const FATAL_CODES = new Set(['EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ENOTFOUND', 'ETLS']);
const senderNextAt = new Map();
let ticking = false;

async function logEvent(msg, type, extra = {}) {
  await Event.create({ message: msg._id, campaign: msg.campaign, business: msg.business, email: msg.email, type, ...extra });
}

async function processCampaign(c) {
  const sender = c.sender && (await Sender.findById(c.sender).select('+smtpPassEnc'));
  if (!sender) {
    await Campaign.updateOne({ _id: c._id }, { status: 'paused', note: 'Sender account was removed. Pick another sender and resume.' });
    return;
  }
  const sid = String(sender._id);
  if ((senderNextAt.get(sid) || 0) > Date.now()) return;
  if (c.delayMinutes > 0 && c.nextSendAt > new Date()) return;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const sentToday = await Message.countDocuments({ sender: sender._id, status: 'sent', sentAt: { $gte: startOfDay } });
  if (sentToday >= sender.dailyLimit) {
    if (c.note !== 'daily-limit') await Campaign.updateOne({ _id: c._id }, { note: 'daily-limit' });
    return;
  }

  // Claim next message atomically so it can never be sent twice.
  const msg = await Message.findOneAndUpdate({ campaign: c._id, status: 'queued' }, { status: 'sending', sender: sender._id }, { sort: { _id: 1 }, new: true });
  if (!msg) {
    if (await Message.exists({ campaign: c._id, status: 'sending' })) return;
    if (c.status === 'testing') {
      // A/B test slice is out: wait for the test window, then send the winner to everyone else.
      if (c.abTest.testEndsAt <= new Date()) await decideAbWinner(c._id);
      else if (c.note !== 'ab-waiting') await Campaign.updateOne({ _id: c._id }, { note: 'ab-waiting' });
      return;
    }
    await Campaign.updateOne({ _id: c._id }, { status: 'sent', finishedAt: new Date(), $unset: { note: 1 } });
    return;
  }

  const contact = msg.contact && (await Contact.findById(msg.contact));
  if (!contact || contact.unsubscribed || contact.bounced) {
    await Message.updateOne({ _id: msg._id }, { status: 'skipped', error: contact ? 'Contact unsubscribed or bounced' : 'Contact deleted' });
    return;
  }

  senderNextAt.set(sid, Date.now() + Math.ceil(60000 / Math.max(1, sender.ratePerMinute)));
  if (c.delayMinutes > 0) await Campaign.updateOne({ _id: c._id }, { nextSendAt: new Date(Date.now() + c.delayMinutes * 60000) });
  const business = await Business.findById(c.business).lean();

  try {
    const subject = msg.variant === 'B' && c.abTest?.subjectB ? c.abTest.subjectB : c.subject;
    const r = await renderEmail({ ...c.toObject(), subject }, contact, business, { token: msg.token });
    const info = await getTransport(sender).sendMail(buildMail(sender, msg.email, r, {
      'List-Unsubscribe': `<${r.unsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'X-Campaign-ID': String(c._id),
    }));
    await Message.updateOne({ _id: msg._id }, { status: 'sent', sentAt: new Date(), smtpMessageId: info.messageId, $unset: { error: 1 } });
    await logEvent(msg, 'sent');
    if (c.note && c.note !== 'ab-waiting') await Campaign.updateOne({ _id: c._id }, { $unset: { note: 1 } });
  } catch (e) {
    if (FATAL_CODES.has(e.code)) {
      // Account/connection problem, not this recipient: pause rather than failing everyone.
      await Message.updateOne({ _id: msg._id }, { status: 'queued' });
      await Campaign.updateOne({ _id: c._id }, { status: 'paused', note: `Sender error: ${e.message}` });
      await Sender.updateOne({ _id: sender._id }, { verified: false, lastError: e.message });
      dropTransport(sid);
    } else {
      await Message.updateOne({ _id: msg._id }, { status: 'failed', error: e.message });
      await logEvent(msg, 'failed', { url: e.message });
      if (e.responseCode >= 550 && e.responseCode < 560) await Contact.updateOne({ _id: contact._id }, { bounced: true });
    }
  }
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const due = await Campaign.find({ status: 'scheduled', scheduledAt: { $lte: new Date() } }).select('_id');
    for (const c of due) await queueCampaign(c._id);
    const active = await Campaign.find({ status: { $in: ['sending', 'testing'] } }).sort({ startedAt: 1 });
    // Different senders run in parallel; campaigns sharing a sender go one at a time (throttled via senderNextAt).
    const bySender = new Map();
    for (const c of active) {
      const k = String(c.sender);
      if (!bySender.has(k)) bySender.set(k, []);
      bySender.get(k).push(c);
    }
    await Promise.all([...bySender.values()].map(async (group) => {
      for (const c of group) await processCampaign(c).catch((e) => console.error('Campaign', String(c._id), e));
    }));
  } finally {
    ticking = false;
  }
}

async function startWorker() {
  await Message.updateMany({ status: 'sending' }, { status: 'queued' }); // interrupted by a restart
  setInterval(() => tick().catch((e) => console.error('Worker error', e)), 500);
}

module.exports = { renderEmail, sendTest, verifySender, dropTransport, queueCampaign, decideAbWinner, audienceQuery, startWorker, logEvent, publicUrl, contactVars, escapeHtml };
