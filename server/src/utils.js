const mongoose = require('mongoose');
const { Message } = require('./models');

const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function oid(id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(400, 'Invalid id');
  return new mongoose.Types.ObjectId(String(id));
}

const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);
const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function sendCsv(res, filename, rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]+/g, '_')}"`);
  res.send('﻿' + [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\r\n'));
}

const cnt = (cond) => ({ $sum: { $cond: [cond, 1, 0] } });
const STATS_GROUP = {
  total: { $sum: 1 },
  sent: cnt({ $eq: ['$status', 'sent'] }),
  failed: cnt({ $eq: ['$status', 'failed'] }),
  queued: cnt({ $in: ['$status', ['queued', 'sending']] }),
  skipped: cnt({ $eq: ['$status', 'skipped'] }),
  opened: cnt({ $gt: ['$openedAt', null] }),
  opens: { $sum: '$openCount' },
  clicked: cnt({ $gt: ['$clickedAt', null] }),
  clicks: { $sum: '$clickCount' },
  unsubscribed: cnt({ $gt: ['$unsubscribedAt', null] }),
};
const EMPTY = { total: 0, sent: 0, failed: 0, queued: 0, skipped: 0, opened: 0, opens: 0, clicked: 0, clicks: 0, unsubscribed: 0 };
const pct = (a, b) => (b ? +((100 * a) / b).toFixed(1) : 0);

function withRates(raw) {
  const s = { ...EMPTY, ...raw };
  delete s._id;
  return {
    ...s,
    delivered_rate: pct(s.sent, s.sent + s.failed),
    open_rate: pct(s.opened, s.sent),
    click_rate: pct(s.clicked, s.sent),
    click_to_open: pct(s.clicked, s.opened),
    unsub_rate: pct(s.unsubscribed, s.sent),
  };
}

async function statsFor(match) {
  const [s] = await Message.aggregate([{ $match: match }, { $group: { _id: null, ...STATS_GROUP } }]);
  return withRates(s);
}

async function statsByCampaign(ids) {
  const rows = await Message.aggregate([{ $match: { campaign: { $in: ids } } }, { $group: { _id: '$campaign', ...STATS_GROUP } }]);
  const map = new Map(rows.map((r) => [String(r._id), withRates(r)]));
  return (id) => map.get(String(id)) || withRates({});
}

module.exports = { EMAIL_RE, HttpError, wrap, oid, int, slug, escapeRegex, sendCsv, statsFor, statsByCampaign };
