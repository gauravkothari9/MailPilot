// Audience building: lists, follow-up audiences and segment rules.
const { Message } = require('../models');

const esc = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BASE_FIELDS = ['email', 'firstName', 'lastName', 'company', 'phone'];

/** Turns one segment rule into a Mongo condition. Custom Excel columns live under fields.<name>. */
function ruleToQuery({ field, op, value = '' }) {
  if (field === 'tags') {
    const tag = String(value).trim().toLowerCase();
    return op === 'not_has' ? { tags: { $ne: tag } } : { tags: tag };
  }
  const key = BASE_FIELDS.includes(field) ? field : `fields.${String(field).replace(/^fields\./, '').replace(/[^\w]/g, '')}`;
  const v = String(value).trim();
  switch (op) {
    case 'equals': return { [key]: new RegExp(`^${esc(v)}$`, 'i') };
    case 'not_equals': return { [key]: { $not: new RegExp(`^${esc(v)}$`, 'i') } };
    case 'contains': return { [key]: new RegExp(esc(v), 'i') };
    case 'not_contains': return { [key]: { $not: new RegExp(esc(v), 'i') } };
    case 'starts_with': return { [key]: new RegExp(`^${esc(v)}`, 'i') };
    case 'ends_with': return { [key]: new RegExp(`${esc(v)}$`, 'i') };
    case 'empty': return { $or: [{ [key]: { $exists: false } }, { [key]: '' }] };
    case 'not_empty': return { [key]: { $exists: true, $nin: ['', null] } };
    default: return {};
  }
}

/** Contacts a campaign targets: a list, all subscribers, hand-picked contacts (or non-openers / non-clickers of an earlier campaign), narrowed by segment rules. */
async function audienceQuery(campaign) {
  const q = { business: campaign.business, unsubscribed: false, bounced: false };
  if (campaign.audience === 'non_openers' || campaign.audience === 'non_clickers') {
    const field = campaign.audience === 'non_openers' ? 'openedAt' : 'clickedAt';
    const ids = await Message.distinct('contact', { campaign: campaign.sourceCampaign, status: 'sent', [field]: null });
    q._id = { $in: ids };
  } else if (campaign.audience === 'contacts') {
    q._id = { $in: campaign.contacts || [] };
  } else if (campaign.audience !== 'all') {
    q.lists = campaign.list;
  }
  const rules = (campaign.rules || []).filter((r) => r.field && r.op);
  if (rules.length) q.$and = rules.map(ruleToQuery);
  return q;
}

module.exports = { audienceQuery, ruleToQuery };
