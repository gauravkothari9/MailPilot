// Email template library: built-in starters plus templates saved per business.
const router = require('express').Router();
const { Template, Campaign } = require('../models');
const { wrap, oid, HttpError } = require('../utils');

const shell = (inner, accent = '#4f46e5') => `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f5f7;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
${inner.replace(/ACCENT/g, accent)}
    <p style="text-align:center;font-size:12px;color:#6b7280;margin-top:20px;line-height:1.6;">
      {{business_name}} · {{business_address}}<br>
      <a href="{{unsubscribe_url}}" style="color:#6b7280;">Unsubscribe</a>
    </p>
  </div>
</body>
</html>`;

const BUILT_IN = [
  {
    _id: 'builtin-newsletter', builtIn: true, name: 'Newsletter', subject: '{{business_name}} – this month\'s highlights',
    preheader: 'What\'s new, what\'s coming, and a little something for you',
    html: shell(`    <div style="background:#ffffff;border-radius:12px;overflow:hidden;">
      <div style="background:ACCENT;padding:28px 32px;color:#ffffff;">
        <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.85;">Monthly newsletter</div>
        <h1 style="margin:6px 0 0;font-size:26px;">Hi {{first_name|there}}, here's what's new</h1>
      </div>
      <div style="padding:28px 32px;">
        <h2 style="font-size:18px;margin:0 0 8px;color:#111827;">📰 Headline story</h2>
        <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">Share your biggest update of the month here. Keep it short and link to the full story.</p>
        <h2 style="font-size:18px;margin:0 0 8px;color:#111827;">✨ Tip of the month</h2>
        <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">A useful tip your customers will appreciate.</p>
        <h2 style="font-size:18px;margin:0 0 8px;color:#111827;">📅 Coming up</h2>
        <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">Events, launches or offers coming soon.</p>
        <p style="text-align:center;margin:0;"><a href="{{business_website|https://example.com}}" style="display:inline-block;background:ACCENT;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:bold;">Read more</a></p>
      </div>
    </div>`),
  },
  {
    _id: 'builtin-sale', builtIn: true, name: 'Sale / Promotion', subject: '{{first_name|Hey}}, 25% off ends Sunday 🎉',
    preheader: 'Your exclusive discount is inside',
    html: shell(`    <div style="background:#ffffff;border-radius:12px;padding:36px 32px;text-align:center;">
      <div style="display:inline-block;background:#fef3c7;color:#92400e;font-weight:bold;font-size:13px;padding:6px 14px;border-radius:999px;">LIMITED TIME</div>
      <h1 style="margin:18px 0 6px;font-size:44px;color:#111827;">25% OFF</h1>
      <p style="font-size:17px;color:#4b5563;margin:0 0 24px;">Everything at {{business_name}}, just for you, {{first_name|friend}}.</p>
      <div style="border:2px dashed ACCENT;border-radius:10px;padding:14px;margin:0 auto 24px;max-width:260px;">
        <div style="font-size:12px;color:#6b7280;">Use code</div>
        <div style="font-size:24px;font-weight:bold;letter-spacing:.12em;color:ACCENT;">SAVE25</div>
      </div>
      <a href="{{business_website|https://example.com}}" style="display:inline-block;background:ACCENT;color:#ffffff;text-decoration:none;padding:15px 34px;border-radius:8px;font-weight:bold;font-size:16px;">Shop the sale</a>
      <p style="font-size:12px;color:#9ca3af;margin:20px 0 0;">Offer ends Sunday at midnight.</p>
    </div>`, '#dc2626'),
  },
  {
    _id: 'builtin-announcement', builtIn: true, name: 'Product announcement', subject: 'Introducing something new from {{business_name}}',
    preheader: 'We\'ve been working on this for a while',
    html: shell(`    <div style="background:#ffffff;border-radius:12px;padding:32px;">
      <p style="font-size:13px;color:ACCENT;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;margin:0 0 8px;">New launch</p>
      <h1 style="margin:0 0 14px;font-size:26px;color:#111827;">Meet our newest product</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi {{first_name|there}}, we're excited to share something we've been building for customers like you.</p>
      <ul style="font-size:15px;line-height:1.8;padding-left:20px;margin:0 0 24px;">
        <li>Benefit number one</li>
        <li>Benefit number two</li>
        <li>Benefit number three</li>
      </ul>
      <a href="{{business_website|https://example.com}}" style="display:inline-block;background:ACCENT;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:bold;">See it now</a>
    </div>`, '#0d9488'),
  },
  {
    _id: 'builtin-plain', builtIn: true, name: 'Personal plain-text style', subject: 'Quick question, {{first_name}}',
    preheader: '',
    html: `<!doctype html>
<html>
<body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#111827;">
  <p>Hi {{first_name|there}},</p>
  <p>Plain, personal emails often get the best replies because they look like a note from a real person.</p>
  <p>Write a short message here and end with one clear question or link.</p>
  <p>Thanks,<br>Your name<br>{{business_name}}</p>
  <p style="font-size:12px;color:#9ca3af;margin-top:32px;">Don't want these emails? <a href="{{unsubscribe_url}}" style="color:#9ca3af;">Unsubscribe</a></p>
</body>
</html>`,
  },
];

router.get('/businesses/:bid/templates', wrap(async (req, res) => {
  const saved = await Template.find({ $or: [{ business: oid(req.params.bid) }, { business: null }] }).sort({ updatedAt: -1 }).lean();
  res.json([...saved, ...BUILT_IN]);
}));

router.post('/businesses/:bid/templates', wrap(async (req, res) => {
  const { name, subject, preheader, html, campaignId } = req.body;
  let data = { subject, preheader, html };
  if (campaignId) {
    const c = await Campaign.findById(oid(campaignId)).lean();
    if (!c) throw new HttpError(404, 'Campaign not found');
    data = { subject: c.subject, preheader: c.preheader, html: c.html };
  }
  if (!String(name || '').trim()) throw new HttpError(400, 'Template name is required');
  if (!data.html) throw new HttpError(400, 'Template content is empty');
  res.json(await Template.create({ business: oid(req.params.bid), name: name.trim(), ...data }));
}));

router.delete('/templates/:id', wrap(async (req, res) => {
  await Template.deleteOne({ _id: oid(req.params.id) });
  res.json({ ok: true });
}));

// Apply a template (built-in or saved) to a draft campaign.
router.post('/campaigns/:id/apply-template', wrap(async (req, res) => {
  const c = await Campaign.findById(oid(req.params.id));
  if (!c) throw new HttpError(404, 'Campaign not found');
  if (!['draft', 'paused'].includes(c.status)) throw new HttpError(400, 'Only drafts can change template');
  const t = BUILT_IN.find((b) => b._id === req.body.templateId) || (await Template.findById(oid(req.body.templateId)).lean());
  if (!t) throw new HttpError(404, 'Template not found');
  c.html = t.html;
  if (t.subject && !c.subject) c.subject = t.subject;
  if (t.preheader && !c.preheader) c.preheader = t.preheader;
  await c.save();
  res.json({ ok: true });
}));

module.exports = router;
