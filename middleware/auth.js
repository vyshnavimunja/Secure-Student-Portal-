const jwt = require('jsonwebtoken');
const db  = require('../config/database');

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET  || 'CHANGE_ME_access_secret_min32chars!!';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'CHANGE_ME_refresh_secret_min32chars!';
const ACCESS_TTL     = '15m';
const REFRESH_TTL    = '7d';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ── Token generators ──────────────────────────────────────────────────────────

function signAccess(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

function signRefresh(payload) {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

function setTokenCookies(res, accessToken, refreshToken) {
  res.cookie('access_token',  accessToken,  { ...COOKIE_OPTS, maxAge: 15 * 60 * 1000 });
  res.cookie('refresh_token', refreshToken, { ...COOKIE_OPTS, maxAge: REFRESH_TTL_MS });
}

function clearTokenCookies(res) {
  res.clearCookie('access_token',  { ...COOKIE_OPTS });
  res.clearCookie('refresh_token', { ...COOKIE_OPTS });
}

// ── Middleware: require valid access token ────────────────────────────────────

function requireAuth(req, res, next) {
  const token = req.cookies?.access_token;
  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const decoded = jwt.verify(token, ACCESS_SECRET);
    // Confirm user still exists and is active
    const user = db.prepare('SELECT id, uuid, role, is_active FROM users WHERE id = ?').get(decoded.id);
    if (!user || !user.is_active) return res.status(401).json({ error: 'Account not found or disabled.' });
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token.' });
  }
}

// ── Middleware: require specific role ─────────────────────────────────────────

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions.' });
    }
    next();
  };
}

module.exports = {
  signAccess,
  signRefresh,
  setTokenCookies,
  clearTokenCookies,
  requireAuth,
  requireRole,
  ACCESS_SECRET,
  REFRESH_SECRET,
  REFRESH_TTL_MS,
};
