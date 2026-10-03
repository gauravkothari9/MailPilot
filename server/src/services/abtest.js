// A/B subject-line testing: per-variant stats and winner selection.
const { Message } = require('../models');

async function variantStats(campaignId) {
  const rows = await Message.aggregate([
    { $match: { campaign: campaignId, abTestSlice: true } },
    { $group: {
      _id: '$variant',
      sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
      opened: { $sum: { $cond: [{ $gt: ['$openedAt', null] }, 1, 0] } },
      clicked: { $sum: { $cond: [{ $gt: ['$clickedAt', null] }, 1, 0] } },
    } },
  ]);
  const out = {};
  for (const v of ['A', 'B']) {
    const r = rows.find((x) => x._id === v) || { sent: 0, opened: 0, clicked: 0 };
    out[v] = {
      sent: r.sent, opened: r.opened, clicked: r.clicked,
      openRate: r.sent ? +((100 * r.opened) / r.sent).toFixed(1) : 0,
      clickRate: r.sent ? +((100 * r.clicked) / r.sent).toFixed(1) : 0,
    };
  }
  return out;
}

async function pickWinner(campaign) {
  const s = await variantStats(campaign._id);
  const key = campaign.abTest.metric === 'clicks' ? 'clickRate' : 'openRate';
  return s.B[key] > s.A[key] ? 'B' : 'A'; // ties keep the original subject
}

module.exports = { variantStats, pickWinner };
