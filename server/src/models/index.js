const mongoose = require('mongoose');

const { Schema, model } = mongoose;
const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name });
const opts = { timestamps: true };

const User = model('User', new Schema({
  username: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true },
}, opts));

const Setting = model('Setting', new Schema({
  key: { type: String, required: true, unique: true },
  value: String,
}));

const Business = model('Business', new Schema({
  name: { type: String, required: true, trim: true },
  website: String,
  address: String,
  color: { type: String, default: '#4f46e5' },
}, opts));

const Sender = model('Sender', new Schema({
  business: { ...ref('Business'), required: true, index: true },
  label: String,
  fromName: { type: String, required: true },
  fromEmail: { type: String, required: true },
  replyTo: String,
  smtpHost: { type: String, required: true },
  smtpPort: { type: Number, default: 587 },
  smtpSecure: { type: Boolean, default: false },
  smtpUser: { type: String, required: true },
  smtpPassEnc: { type: String, required: true, select: false },
  ratePerMinute: { type: Number, default: 20, min: 1 },
  dailyLimit: { type: Number, default: 500, min: 1 },
  verified: { type: Boolean, default: false },
  lastError: String,
}, opts));

const List = model('List', new Schema({
  business: { ...ref('Business'), required: true, index: true },
  name: { type: String, required: true, trim: true },
}, opts));

const contactSchema = new Schema({
  business: { ...ref('Business'), required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  company: { type: String, default: '' },
  phone: { type: String, default: '' },
  fields: { type: Map, of: String, default: {} },
  lists: [ref('List')],
  tags: { type: [String], default: [], index: true },
  unsubscribed: { type: Boolean, default: false },
  unsubscribedAt: Date,
  bounced: { type: Boolean, default: false },
}, opts);
contactSchema.index({ business: 1, email: 1 }, { unique: true });
contactSchema.index({ lists: 1 });
const Contact = model('Contact', contactSchema);

const Campaign = model('Campaign', new Schema({
  business: { ...ref('Business'), required: true, index: true },
  sender: ref('Sender'),
  list: ref('List'),
  // list | non_openers | non_clickers (of sourceCampaign)
  audience: { type: String, default: 'list' },
  sourceCampaign: ref('Campaign'),
  // Extra segment filters applied on top of the audience, e.g. { field: 'fields.city', op: 'equals', value: 'Pune' }
  rules: { type: [{ _id: false, field: String, op: String, value: String }], default: [] },
  abTest: {
    enabled: { type: Boolean, default: false },
    subjectB: { type: String, default: '' },
    testPercent: { type: Number, default: 20, min: 2, max: 100 },
    waitHours: { type: Number, default: 4, min: 0 },
    metric: { type: String, default: 'opens' }, // opens | clicks
    testEndsAt: Date,
    winner: String, // A | B
    decidedAt: Date,
  },
  name: { type: String, required: true },
  subject: { type: String, default: '' },
  preheader: { type: String, default: '' },
  html: { type: String, default: '' },
  trackOpens: { type: Boolean, default: true },
  trackClicks: { type: Boolean, default: true },
  // draft | scheduled | testing (A/B) | sending | paused | sent
  status: { type: String, default: 'draft', index: true },
  note: String,
  scheduledAt: Date,
  startedAt: Date,
  finishedAt: Date,
}, opts));

const messageSchema = new Schema({
  campaign: { ...ref('Campaign'), required: true },
  business: { ...ref('Business'), required: true },
  sender: ref('Sender'),
  contact: ref('Contact'),
  email: { type: String, required: true },
  variant: String, // A | B when the campaign runs an A/B test
  abTestSlice: Boolean, // part of the A/B test group (vs. the winner rollout)
  token: { type: String, required: true, unique: true },
  // queued | sending | sent | failed | skipped
  status: { type: String, default: 'queued' },
  error: String,
  smtpMessageId: String,
  sentAt: Date,
  openedAt: Date,
  openCount: { type: Number, default: 0 },
  clickedAt: Date,
  clickCount: { type: Number, default: 0 },
  unsubscribedAt: Date,
}, opts);
messageSchema.index({ campaign: 1, status: 1 });
messageSchema.index({ contact: 1 });
messageSchema.index({ sender: 1, status: 1, sentAt: 1 });
const Message = model('Message', messageSchema);

const linkSchema = new Schema({
  campaign: { ...ref('Campaign'), required: true },
  url: { type: String, required: true },
});
linkSchema.index({ campaign: 1, url: 1 }, { unique: true });
const Link = model('Link', linkSchema);

const eventSchema = new Schema({
  message: { ...ref('Message'), required: true, index: true },
  campaign: { ...ref('Campaign'), required: true },
  business: { ...ref('Business'), required: true },
  email: String,
  // sent | open | click | unsubscribe | failed
  type: { type: String, required: true },
  link: ref('Link'),
  url: String,
  ip: String,
  userAgent: String,
  // Security scanners / link prefetchers: kept for audit, excluded from stats
  bot: { type: Boolean, default: false },
}, { timestamps: { createdAt: true, updatedAt: false } });
eventSchema.index({ campaign: 1, type: 1 });
eventSchema.index({ business: 1, createdAt: -1 });
const Event = model('Event', eventSchema);

const Template = model('Template', new Schema({
  business: ref('Business'), // null = available to every business
  name: { type: String, required: true },
  subject: { type: String, default: '' },
  preheader: { type: String, default: '' },
  html: { type: String, required: true },
}, opts));

// Images used inside emails. Stored in MongoDB so they are backed up with everything else
// and survive redeploys; served publicly at /i/<id>.<ext>.
const imageSchema = new Schema({
  business: { ...ref('Business'), required: true, index: true },
  name: String,
  // 'image' (image library, has a merge tag) or 'file' (PDF, document… linked from buttons).
  kind: { type: String, enum: ['image', 'file'], default: 'image' },
  // Merge-tag name, e.g. "logo" for {{image:logo}}. Auto-generated from the file name, editable.
  tag: String,
  mime: { type: String, required: true },
  ext: { type: String, required: true },
  size: Number,
  width: Number,
  height: Number,
  // Small files live in `data`; large files (over MongoDB's 16 MB document limit) in GridFS.
  data: { type: Buffer, select: false, required() { return !this.gridId; } },
  gridId: Schema.Types.ObjectId,
}, opts);
imageSchema.index({ business: 1, tag: 1 });
const Image = model('Image', imageSchema);

// Pieces of a large file upload. Uploads go in pieces because the hosting proxy (Vercel)
// limits each request to ~4.5 MB; unfinished uploads are removed after a day.
const UploadPart = model('UploadPart', new Schema({
  upload: { type: Schema.Types.ObjectId, required: true },
  business: { ...ref('Business'), required: true },
  index: { type: Number, required: true },
  data: { type: Buffer, required: true },
  createdAt: { type: Date, default: Date.now, expires: 86400 },
}).index({ upload: 1, index: 1 }, { unique: true }));

async function getSetting(key, fallback = null) {
  const s = await Setting.findOne({ key }).lean();
  return s ? s.value : fallback;
}

async function setSetting(key, value) {
  await Setting.updateOne({ key }, { value }, { upsert: true });
}

module.exports = { User, Setting, Business, Sender, List, Contact, Campaign, Message, Link, Event, Template, Image, UploadPart, getSetting, setSetting };
