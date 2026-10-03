const crypto = require('crypto');

const KEY = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');
if (KEY.length !== 32) {
  throw new Error('ENCRYPTION_KEY in server/.env must be 64 hex characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}

// AES-256-GCM, used for SMTP passwords at rest.
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

function decrypt(blob) {
  const [iv, tag, enc] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':').map((s) => Buffer.from(s, 'hex'));
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(hash, test);
}

const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

module.exports = { encrypt, decrypt, hashPassword, verifyPassword, randomToken };
