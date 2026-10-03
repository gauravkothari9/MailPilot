// Dashboard overview and the cross-campaign activity feed.
const router = require('express').Router();
const { Contact, Campaign, Sender, Event } = require('../models');
const { wrap, oid, int, escapeRegex, statsFor, statsByCampaign } = require('../utils');
const { openHeatmap } = require('./campaigns');

router.get('/overview', wrap(async (req, res) => {
  const scope = req.query.business ? { business: oid(req.query.business) } : {};
  const since = new Date(Date.now() - 29 * 86400000);
  since.setHours(0, 0, 0, 0);

  const tz = String(req.query.tz || 'UTC');
  const [totals, contacts, unsubscribed, campaigns, senders, daily, recentCampaigns, recent, heatmap, bots] = await Promise.all([
    statsFor(scope),
    Contact.countDocuments(scope),
    Contact.countDocuments({ ...scope, unsubscribed: true }),
    Campaign.countDocuments(scope),
    Sender.countDocuments(scope),
    Event.aggregate([
      { $match: { ...scope, createdAt: { $gte: since }, bot: { $ne: true } } },
      { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: tz } }, type: '$type' }, n: { $sum: 1 } } },
    ]),
    Campaign.find(scope).sort({ _id: -1 }).limit(6).select('name status startedAt createdAt business').populate('business', 'name color').lean(),
    Event.find({ ...scope, bot: { $ne: true } }).sort({ _id: -1 }).limit(15).populate('campaign', 'name').lean(),
    openHeatmap(scope, tz),
    Event.countDocuments({ ...scope, bot: true }),
  ]);
  const stats = await statsByCampaign(recentCampaigns.map((c) => c._id));
  res.json({
    totals,
    counts: { contacts, unsubscribed, campaigns, senders },
    since,
    daily: daily.map((d) => ({ day: d._id.day, type: d._id.type, n: d.n })),
    recentCampaigns: recentCampaigns.map((c) => ({ ...c, stats: stats(c._id) })),
    recent,
    heatmap,
    botEvents: bots,
  });
}));

router.get('/businesses/:bid/activity', wrap(async (req, res) => {
  const q = { business: oid(req.params.bid) };
  if (req.query.type) q.type = String(req.query.type);
  if (req.query.campaign) q.campaign = oid(req.query.campaign);
  if (req.query.q) q.email = new RegExp(escapeRegex(req.query.q), 'i');
  if (req.query.bots === 'only') q.bot = true;
  else if (req.query.bots !== 'include') q.bot = { $ne: true };
  const per = 50;
  const page = Math.max(1, int(req.query.page, 1));
  const [total, rows] = await Promise.all([
    Event.countDocuments(q),
    Event.find(q).sort({ _id: -1 }).skip((page - 1) * per).limit(per).populate('campaign', 'name').lean(),
  ]);
  res.json({ total, page, per, rows });
}));

module.exports = router;
