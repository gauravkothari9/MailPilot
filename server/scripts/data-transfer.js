/**
 * Moves the whole MailPilot database between machines, preserving ids and types.
 *
 *   node scripts/data-transfer.js export <file.json>    dump every collection from MONGODB_URI
 *   node scripts/data-transfer.js import <file.json>    restore into MONGODB_URI (refuses if it already has data)
 *   node scripts/data-transfer.js import <file.json> --force   replace existing data
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const { EJSON } = mongoose.mongo.BSON;
const [mode, file] = process.argv.slice(2);
const FORCE = process.argv.includes('--force');

(async () => {
  if (!['export', 'import'].includes(mode) || !file) throw new Error('Usage: data-transfer.js export|import <file.json> [--force]');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  if (mode === 'export') {
    const out = {};
    for (const { name } of await db.listCollections().toArray()) {
      if (name.startsWith('system.')) continue;
      out[name] = await db.collection(name).find().toArray();
      console.log(`  ${name}: ${out[name].length}`);
    }
    fs.writeFileSync(file, EJSON.stringify(out, { relaxed: false }));
    console.log(`Exported to ${file} (${(fs.statSync(file).size / 1048576).toFixed(1)} MB)`);
    return;
  }

  const data = EJSON.parse(fs.readFileSync(file, 'utf8'), { relaxed: false });
  const existing = (await db.listCollections().toArray()).filter((c) => !c.name.startsWith('system.'));
  let docs = 0;
  for (const c of existing) docs += await db.collection(c.name).countDocuments();
  if (docs && !FORCE) throw new Error(`Target database already has ${docs} documents. Use --force to replace them.`);

  require('../src/models'); // registers schemas so indexes get built
  for (const [name, rows] of Object.entries(data)) {
    const col = db.collection(name);
    await col.deleteMany({});
    for (let i = 0; i < rows.length; i += 2000) await col.insertMany(rows.slice(i, i + 2000), { ordered: false });
    console.log(`  ${name}: ${rows.length}`);
  }
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  console.log('Import complete, indexes built.');
})()
  .catch((e) => { console.error('Failed:', e.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
