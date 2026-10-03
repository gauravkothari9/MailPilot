const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { hashPassword, verifyPassword } = require('../services/security');
const { wrap, HttpError } = require('../utils');

const COOKIE = 'mp_token';
// Secure flag follows the real connection (Nginx forwards X-Forwarded-Proto), so it works on plain HTTP and HTTPS.
const cookieOpts = (req) => ({ httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 30 * 24 * 3600 * 1000 });

function issue(req, res, user) {
  res.cookie(COOKIE, jwt.sign({ sub: String(user._id), u: user.username }, process.env.JWT_SECRET, { expiresIn: '30d' }), cookieOpts(req));
}

function readUser(req) {
  try {
    const t = req.cookies?.[COOKIE];
    return t ? jwt.verify(t, process.env.JWT_SECRET) : null;
  } catch { return null; }
}

function requireAuth(req, res, next) {
  const u = readUser(req);
  if (!u) return res.status(401).json({ error: 'Not logged in' });
  req.user = u;
  next();
}

router.get('/status', wrap(async (req, res) => {
  const u = readUser(req);
  res.json({ needsSetup: (await User.countDocuments()) === 0, user: u ? { id: u.sub, username: u.u } : null });
}));

// First run only: create the owner account.
router.post('/setup', wrap(async (req, res) => {
  if (await User.countDocuments()) throw new HttpError(403, 'Already set up');
  // On a public server an empty database must not let the first visitor become admin.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SETUP !== 'true') {
    throw new HttpError(403, 'Account creation is disabled on this server. Set ALLOW_SETUP=true in server/.env to create the first account.');
  }
  const { username, password } = req.body || {};
  if (!username?.trim() || !password || password.length < 8) throw new HttpError(400, 'Username and a password of at least 8 characters are required');
  const user = await User.create({ username: username.trim(), passwordHash: hashPassword(password) });
  issue(req, res, user);
  res.json({ ok: true });
}));

const attempts = new Map();
router.post('/login', wrap(async (req, res) => {
  const a = attempts.get(req.ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60000) Object.assign(a, { n: 0, t: Date.now() });
  if (a.n >= 10) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  const { username, password } = req.body || {};
  const user = await User.findOne({ username: String(username || '').trim() });
  if (!user || !verifyPassword(String(password || ''), user.passwordHash)) {
    a.n++;
    attempts.set(req.ip, a);
    throw new HttpError(401, 'Invalid username or password');
  }
  attempts.delete(req.ip);
  issue(req, res, user);
  res.json({ ok: true });
}));

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

router.post('/password', requireAuth, wrap(async (req, res) => {
  const { current, next } = req.body || {};
  const user = await User.findById(req.user.sub);
  if (!user || !verifyPassword(String(current || ''), user.passwordHash)) throw new HttpError(400, 'Current password is wrong');
  if (!next || next.length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
  user.passwordHash = hashPassword(next);
  await user.save();
  res.json({ ok: true });
}));

module.exports = { router, requireAuth };
