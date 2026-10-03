// Public endpoints hit by recipients' email clients: open pixel, click redirects, unsubscribe.
const router = require('express').Router();
const mongoose = require('mongoose');
const { Message, Link, Contact, Business } = require('../models');
const { logEvent, escapeHtml } = require('../services/mailer');
const { wrap } = require('../utils');

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const meta = (req) => ({ ip: req.ip, userAgent: (req.headers['user-agent'] || '').slice(0, 400) });

// Security gateways (Proofpoint, Mimecast, Barracuda, Microsoft Safe Links...) and link prefetchers
// open/click every link within seconds of delivery. Counting them would fake engagement.
const BOT_UA = /bot|crawl|spider|slurp|scanner|preview|prefetch|barracuda|proofpoint|mimecast|symantec|messagelabs|fortinet|fortiguard|trendmicro|sophos|cisco|ironport|bitdefender|kaspersky|safelinks|urldefense|appengine-google|python|curl|wget|go-http|java\/|okhttp|axios|node-fetch|headless|phantom|libwww|httpclient/i;
const FAST = { open: 2000, click: 8000 };

function isBot(req, msg, kind) {
  if (BOT_UA.test(req.headers['user-agent'] || '')) return true;
  if (!req.headers['user-agent']) return true;
  return !!msg.sentAt && Date.now() - new Date(msg.sentAt).getTime() < FAST[kind];
}

async function recordOpen(msg, req) {
  if (isBot(req, msg, 'open')) return logEvent(msg, 'open', { ...meta(req), bot: true });
  await Message.updateOne({ _id: msg._id }, [{ $set: { openCount: { $add: ['$openCount', 1] }, openedAt: { $ifNull: ['$openedAt', '$$NOW'] } } }]);
  await logEvent(msg, 'open', meta(req));
}

router.get('/t/o/:token.gif', async (req, res) => {
  try {
    const msg = await Message.findOne({ token: req.params.token });
    if (msg) await recordOpen(msg, req);
  } catch (e) { console.error(e); }
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate, private', Pragma: 'no-cache' });
  res.end(PIXEL);
});

router.get('/t/c/:token/:linkId', wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.linkId)) return res.status(404).send('Link not found');
  const link = await Link.findById(req.params.linkId);
  if (!link) return res.status(404).send('Link not found');
  const msg = await Message.findOne({ token: req.params.token });
  if (msg && String(msg.campaign) === String(link.campaign)) {
    if (isBot(req, msg, 'click')) {
      await logEvent(msg, 'click', { link: link._id, url: link.url, ...meta(req), bot: true });
      return res.redirect(302, link.url);
    }
    if (!msg.openedAt) await recordOpen(msg, req); // a click proves an open even with images blocked
    await Message.updateOne({ _id: msg._id }, [{ $set: { clickCount: { $add: ['$clickCount', 1] }, clickedAt: { $ifNull: ['$clickedAt', '$$NOW'] } } }]);
    await logEvent(msg, 'click', { link: link._id, url: link.url, ...meta(req) });
  }
  res.redirect(302, link.url);
}));

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,Arial,sans-serif;background:#f4f5f7;margin:0;display:grid;place-items:center;min-height:100vh;color:#111827}
.card{background:#fff;padding:36px;border-radius:14px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:420px;margin:16px;text-align:center}
button{background:#111827;color:#fff;border:0;padding:12px 22px;border-radius:8px;font-size:15px;cursor:pointer}p{color:#4b5563;line-height:1.5}</style></head>
<body><div class="card">${body}</div></body></html>`;

router.get('/u/:token', wrap(async (req, res) => {
  const msg = await Message.findOne({ token: req.params.token });
  if (!msg) return res.send(page('Unsubscribe', '<h2>Unsubscribe</h2><p>This is a preview link. Real recipients see a confirmation button here.</p>'));
  const [biz, contact] = await Promise.all([Business.findById(msg.business).lean(), msg.contact ? Contact.findById(msg.contact).lean() : null]);
  const name = escapeHtml(biz?.name || 'us');
  if (contact?.unsubscribed) return res.send(page('Unsubscribed', `<h2>You're unsubscribed</h2><p>${escapeHtml(msg.email)} will no longer receive emails from ${name}.</p>`));
  res.send(page('Unsubscribe', `<h2>Unsubscribe?</h2><p>Stop receiving emails from <b>${name}</b> at ${escapeHtml(msg.email)}.</p><form method="post"><button type="submit">Unsubscribe me</button></form>`));
}));

// Handles the confirm button and RFC 8058 one-click unsubscribe from Gmail/Yahoo.
router.post('/u/:token', wrap(async (req, res) => {
  const msg = await Message.findOne({ token: req.params.token });
  if (msg) {
    if (msg.contact) await Contact.updateOne({ _id: msg.contact, unsubscribed: false }, { unsubscribed: true, unsubscribedAt: new Date() });
    if (!msg.unsubscribedAt) {
      await Message.updateOne({ _id: msg._id }, { unsubscribedAt: new Date() });
      await logEvent(msg, 'unsubscribe', meta(req));
    }
  }
  res.send(page('Unsubscribed', "<h2>You're unsubscribed</h2><p>You won't receive any more marketing emails from us.</p>"));
}));

module.exports = router;
