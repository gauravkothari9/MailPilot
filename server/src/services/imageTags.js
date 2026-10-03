// Image merge tags.
//
//   {{image:logo}}                          → full <img> for the library image tagged "logo"
//   {{image_url:logo}}                      → just its address (for custom HTML)
//   {{image:banner_[country]}}              → per-contact image, e.g. "banner_new_zealand"
//   {{image:banner_[country]|banner_default}} → fallback image when there's no match
//
// Unknown tags render as nothing, so a missing image never shows a broken icon.
const { Image } = require('../models');

const tagSlug = (s) => String(s ?? '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  .slice(0, 60);

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Small per-business cache so a campaign send doesn't query the library for every recipient.
const cache = new Map();
const TTL = 30000;

async function imageMap(businessId) {
  const key = String(businessId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.map;
  const rows = await Image.find({ business: businessId, tag: { $nin: [null, ''] } }).select('tag ext width name').lean();
  const map = new Map(rows.map((r) => [r.tag, r]));
  cache.set(key, { at: Date.now(), map });
  return map;
}

const invalidateImages = (businessId) => cache.delete(String(businessId));

const IMAGE_TAG = /\{\{\s*(image|image_url)\s*:\s*([^}|]+?)\s*(?:\|\s*([^}]*?))?\s*\}\}/gi;

/** Resolves "banner_[country]" for one contact; null if a [field] is empty. */
function resolveName(template, vars) {
  let missing = false;
  const name = template.replace(/\[\s*([\w.-]+)\s*\]/g, (m, field) => {
    const v = vars[field.toLowerCase()];
    if (v === undefined || v === null || String(v).trim() === '') { missing = true; return ''; }
    return tagSlug(v);
  });
  return missing ? null : tagSlug(name);
}

async function applyImageTags(html, businessId, vars) {
  const text = String(html || '');
  if (!businessId || !/\{\{\s*image(_url)?\s*:/i.test(text)) return text;
  const map = await imageMap(businessId);
  return text.replace(IMAGE_TAG, (m, kind, name, fallback) => {
    const find = (t) => {
      if (!t) return null;
      const resolved = resolveName(t, vars);
      return resolved ? map.get(resolved) || null : null;
    };
    const img = find(name) || find(fallback);
    if (!img) return '';
    const url = `/i/${img._id}.${img.ext}`;
    if (kind.toLowerCase() === 'image_url') return url;
    const width = Math.min(img.width || 560, 560);
    const alt = escapeHtml((img.name || img.tag).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
    return `<img src="${url}" alt="${alt}" width="${width}" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:100%;margin:0 auto;" />`;
  });
}

/** Next free tag for a business, e.g. "banner", "banner_2". */
async function uniqueTag(businessId, wanted, excludeId) {
  const base = tagSlug(wanted) || 'image';
  const taken = new Set((await Image.find({ business: businessId, tag: new RegExp(`^${base}(_\\d+)?$`), ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).select('tag').lean()).map((r) => r.tag));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

module.exports = { applyImageTags, invalidateImages, uniqueTag, tagSlug };
