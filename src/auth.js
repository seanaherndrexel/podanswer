// Accounts: bcrypt passwords + signed session cookies (no session store needed).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { q } = require('./db');

const SECRET = process.env.SESSION_SECRET || process.env.ADMIN_KEY || 'dev-only-insecure-secret';
const COOKIE = 'pa_session';
const MAX_AGE_DAYS = 30;

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(cookie) {
  if (!cookie || cookie.indexOf('.') < 0) return null;
  const [body, mac] = cookie.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}

function setSession(res, user) {
  const value = sign({ uid: user.id, email: user.email, exp: Date.now() + MAX_AGE_DAYS * 864e5 });
  res.cookie(COOKIE, value, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV !== 'development',
    maxAge: MAX_AGE_DAYS * 864e5, path: '/',
  });
}

const clearSession = (res) => res.clearCookie(COOKIE, { path: '/' });

// Populates req.user on every request when a valid cookie is present.
async function attachUser(req, res, next) {
  req.user = null;
  const p = verify(req.cookies && req.cookies[COOKIE]);
  if (p && p.uid) {
    try {
      const r = await q(`SELECT id, email, name, stripe_customer_id, is_admin FROM users WHERE id=$1`, [p.uid]);
      req.user = r.rows[0] || null;
    } catch { /* database blip: treat as logged out */ }
  }
  next();
}

const requireUser = (req, res, next) =>
  (req.user ? next() : res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`));

const hash = (pw) => bcrypt.hash(pw, 10);
const check = (pw, h) => bcrypt.compare(pw, h);

async function createUser({ email, password, name }) {
  const password_hash = await hash(password);
  const r = await q(
    `INSERT INTO users (email, password_hash, name) VALUES (lower($1),$2,$3) RETURNING id, email, name, stripe_customer_id, is_admin`,
    [String(email).trim(), password_hash, name || null]
  );
  return r.rows[0];
}

async function findUserByEmail(email) {
  const r = await q(`SELECT * FROM users WHERE email=lower($1)`, [String(email || '').trim()]);
  return r.rows[0] || null;
}

module.exports = { attachUser, requireUser, setSession, clearSession, createUser, findUserByEmail, check, COOKIE };
