/**
 * Bulk-imports a folder of "country lead" Excel files into one business.
 *
 * Handles the layouts in the Mail folder:
 *  - a country title row, then a header row (Sr.No / Name / E-Mail / Phone)
 *  - sheets without a title row (country = sheet name)
 *  - several country blocks side by side on one sheet ("A Countries.xlsx")
 *  - cells holding several emails separated by spaces, commas or new lines
 *
 * Each file becomes a list; every contact gets country, phone and source fields
 * (usable as {{country}} and in segments) plus a country tag.
 *
 * Usage:
 *   node scripts/import-folder.js <folder> "<Business name>"           (dry run)
 *   node scripts/import-folder.js <folder> "<Business name>" --commit  (write to DB)
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const XLSX = require('xlsx');
const mongoose = require('mongoose');
const { Business, List, Contact } = require('../src/models');

const [folder, businessName] = process.argv.slice(2);
const COMMIT = process.argv.includes('--commit');
if (!folder || !businessName) {
  console.error('Usage: node scripts/import-folder.js <folder> "<Business name>" [--commit]');
  process.exit(1);
}

const EMAIL_G = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;
const isEmailHeader = (v) => /e-?\s*mail/i.test(v);
const isNameHeader = (v) => /^\s*(name|company|store|shop)/i.test(v);
const isPhoneHeader = (v) => /phone|mobile|contact\s*no|tel/i.test(v);
const isHeaderRow = (row) => row.some((c) => isEmailHeader(String(c)) && String(c).length < 20 && !String(c).includes('@'));

// Dummy addresses left in the sheets ("exemplo@email.co.ao", "email@xyz.com", "tuemail@mail.com"...).
const PLACEHOLDER = /^(exemplo|example|email|e-mail|tuemail|tucorreo|youremail|your\.?email|yourname|name|test|sample|xxx+|abc|info@example)@|@(example|xyz|domain|email)\.[a-z.]+$/i;

const COUNTRY_FIX = {
  newzealand: 'New Zealand', netherland: 'Netherlands', 'cote d lvoire': "Côte d'Ivoire", 'central african repbulic': 'Central African Republic',
  'czechia (czech republic)': 'Czechia', 'saint vincent and the grenadine': 'Saint Vincent and the Grenadines', 'furniture store in europe': 'Europe',
};
function cleanCountry(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s || /^sheet\d*$/i.test(s)) return '';
  const fix = COUNTRY_FIX[s.toLowerCase()];
  if (fix) return fix;
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, p, c) => p + c.toUpperCase()).replace(/\b(And|Of|The)\b/g, (w) => w.toLowerCase());
}
const cleanPhone = (v) => String(v || '').replace(/[^\d+]/g, '');
const cleanName = (v) => String(v || '').replace(/\s+/g, ' ').trim();

let placeholders = 0;

/** Returns [{ email, name, phone, country }] for one sheet. */
function parseSheet(ws, sheetName) {
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const out = [];
  let blocks = null; // [{ emailCol, nameCol, phoneCol, country }]

  const buildBlocks = (headerIdx) => {
    const header = grid[headerIdx].map(String);
    const emailCols = header.map((h, i) => (isEmailHeader(h) ? i : -1)).filter((i) => i >= 0);
    return emailCols.map((e, k) => {
      const lo = k ? emailCols[k - 1] + 1 : 0;
      const hi = k + 1 < emailCols.length ? emailCols[k + 1] : header.length;
      let nameCol = -1;
      for (let i = e - 1; i >= lo; i--) if (isNameHeader(header[i])) { nameCol = i; break; }
      if (nameCol < 0 && e - 1 >= lo) nameCol = e - 1;
      let phoneCol = -1;
      for (let i = e + 1; i < hi; i++) if (isPhoneHeader(header[i])) { phoneCol = i; break; }
      // Country title: nearest non-empty cell above the header within this block.
      let country = '';
      const start = Math.max(lo, nameCol >= 0 ? nameCol - 1 : lo);
      for (let r = headerIdx - 1; r >= 0 && !country; r--) {
        for (let c = start; c <= e && !country; c++) {
          const v = String(grid[r][c] || '').trim();
          if (v && !EMAIL_G.test(v) && !/^\d+$/.test(v)) country = v;
          EMAIL_G.lastIndex = 0;
        }
      }
      return { emailCol: e, nameCol, phoneCol, start: nameCol >= 0 ? nameCol : lo, country: cleanCountry(country) || cleanCountry(sheetName) };
    }).map((b, k, arr) => ({ ...b, end: k + 1 < arr.length ? arr[k + 1].start - 1 : header.length + 20 }));
  };

  grid.forEach((row, r) => {
    if (isHeaderRow(row)) { blocks = buildBlocks(r); return; }
    if (!blocks) return;
    for (const b of blocks) {
      // Emails can spill out of the Email column into neighbouring cells, so scan the whole block width.
      const emails = row.slice(b.start, b.end + 1).flatMap((c) => String(c).match(EMAIL_G) || []);
      const nameCell = cleanName(row[b.nameCol]);
      for (const raw of emails) {
        const email = raw.toLowerCase().replace(/^[.'-]+|[.'-]+$/g, '');
        if (!EMAIL_RE.test(email)) continue;
        if (PLACEHOLDER.test(email)) { placeholders++; continue; }
        out.push({ email, name: nameCell.includes('@') ? '' : nameCell, phone: cleanPhone(row[b.phoneCol]), country: b.country });
      }
    }
  });

  // Safety net: report emails that no block picked up.
  const seen = new Set(out.map((o) => o.email));
  let stray = 0;
  grid.forEach((row) => row.forEach((c) => (String(c).match(EMAIL_G) || []).forEach((e) => {
    if (!seen.has(e.toLowerCase()) && !PLACEHOLDER.test(e)) stray++;
  })));
  return { rows: out, stray };
}

(async () => {
  const files = fs.readdirSync(folder).filter((f) => /\.(xlsx|xls|csv)$/i.test(f) && !f.startsWith('~$')).sort();
  const perFile = [];
  const all = new Map(); // email -> record (first occurrence wins for fields)
  let strayTotal = 0;

  for (const f of files) {
    const wb = XLSX.readFile(path.join(folder, f));
    const rows = [];
    for (const sn of wb.SheetNames) {
      const { rows: r, stray } = parseSheet(wb.Sheets[sn], sn);
      rows.push(...r);
      strayTotal += stray;
      if (stray) console.log(`  ! ${f} / ${sn}: ${stray} email(s) outside the email column were skipped`);
    }
    const unique = new Map();
    rows.forEach((r) => !unique.has(r.email) && unique.set(r.email, r));
    const countries = [...new Set([...unique.values()].map((r) => r.country))];
    perFile.push({ file: f, list: f.replace(/\.[^.]+$/, ''), emails: [...unique.keys()], found: rows.length, countries });
    for (const r of unique.values()) {
      if (!all.has(r.email)) all.set(r.email, { ...r, files: [f] });
      else all.get(r.email).files.push(f);
    }
  }

  console.log('\nFile                 Emails  Countries');
  perFile.forEach((p) => console.log(`${p.file.padEnd(20)} ${String(p.emails.length).padStart(6)}  ${p.countries.join(', ').slice(0, 110)}`));
  const byCountry = {};
  for (const r of all.values()) byCountry[r.country || '(unknown)'] = (byCountry[r.country || '(unknown)'] || 0) + 1;
  console.log(`\nUnique emails across all files: ${all.size}`);
  console.log(`Countries: ${Object.keys(byCountry).length}${byCountry['(unknown)'] ? ` (unknown: ${byCountry['(unknown)']})` : ''}`);
  console.log(`Emails appearing in more than one file: ${[...all.values()].filter((r) => r.files.length > 1).length}`);
  if (strayTotal) console.log(`Skipped stray emails: ${strayTotal}`);
  console.log(`Placeholder/dummy emails ignored: ${placeholders}`);

  if (!COMMIT) {
    console.log('\nDry run only. Re-run with --commit to import.');
    return;
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const business = await Business.findOne({ name: businessName });
  if (!business) throw new Error(`Business "${businessName}" not found`);

  let added = 0;
  let updated = 0;
  for (const p of perFile) {
    const list = (await List.findOne({ business: business._id, name: p.list })) || (await List.create({ business: business._id, name: p.list }));
    const ops = p.emails.map((email) => {
      const r = all.get(email);
      const set = {};
      if (r.name) set.company = r.name;
      if (r.phone) set.phone = r.phone;
      if (r.country) set['fields.country'] = r.country;
      set['fields.source_file'] = r.files[0];
      const tag = r.country ? r.country.toLowerCase() : null;
      return {
        updateOne: {
          filter: { business: business._id, email },
          update: { $setOnInsert: set, $addToSet: { lists: list._id, tags: { $each: ['furniture-leads', ...(tag ? [tag] : [])] } } },
          upsert: true,
        },
      };
    });
    for (let i = 0; i < ops.length; i += 1000) {
      const res = await Contact.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
      added += res.upsertedCount;
      updated += res.matchedCount;
    }
    console.log(`  ✓ ${p.list}: ${p.emails.length} contacts`);
  }
  console.log(`\nImported into "${business.name}": ${added} new contacts, ${updated} list memberships added to existing contacts, ${perFile.length} lists.`);
})()
  .catch((e) => { console.error('Import failed:', e.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
