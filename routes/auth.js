const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');

const db       = require('../config/database');
const validate = require('../middleware/validate');
const {
  signAccess, signRefresh,
  setTokenCookies, clearTokenCookies,
  requireAuth,
  REFRESH_SECRET, REFRESH_TTL_MS,
} = require('../middleware/auth');

const router = express.Router();

// ── Rate limiter: auth endpoints ──────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
  skipSuccessfulRequests: true,
});

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register',
  authLimiter,
  [
    body('full_name').trim().isLength({ min: 2, max: 80 }).withMessage('Full name must be 2–80 characters.'),
    body('email').trim().isEmail().normalizeEmail().withMessage('Valid email required.'),
    body('username')
      .trim()
      .isLength({ min: 3, max: 30 })
      .matches(/^[a-zA-Z0-9_]+$/)
      .withMessage('Username must be 3–30 alphanumeric characters or underscores.'),
    body('password')
      .isLength({ min: 8 })
      .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter.')
      .matches(/[a-z]/).withMessage('Password must contain a lowercase letter.')
      .matches(/[0-9]/).withMessage('Password must contain a number.')
      .matches(/[^A-Za-z0-9]/).withMessage('Password must contain a special character.'),
  ],
  validate,
  async (req, res) => {
    try {
      const { full_name, email, username, password } = req.body;

      // Check uniqueness
      const byEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (byEmail) return res.status(409).json({ error: 'Email already registered.' });

      const byUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (byUsername) return res.status(409).json({ error: 'Username already taken.' });

      const hash = await bcrypt.hash(password, 12);
      const uuid = uuidv4();

      // Auto-generate student ID
      const count = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'student'").get().n;
      const student_id = `STU-${String(count + 1).padStart(4, '0')}`;

      db.prepare(`
        INSERT INTO users (uuid, full_name, email, username, password_hash, role, student_id)
        VALUES (?, ?, ?, ?, ?, 'student', ?)
      `).run(uuid, full_name, email, username, hash, student_id);

      return res.status(201).json({ message: 'Registration successful. Please log in.' });
    } catch (err) {
      console.error('Register error:', err);
      return res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
  }
);

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login',
  authLimiter,
  [
    body('username').trim().notEmpty().withMessage('Username required.'),
    body('password').notEmpty().withMessage('Password required.'),
  ],
  validate,
  async (req, res) => {
    try {
      const { username, password } = req.body;

      const user = db.prepare(`
        SELECT id, uuid, full_name, email, username, password_hash, role, is_active
        FROM users WHERE username = ?
      `).get(username);

      // Constant-time failure (mitigate user enumeration via timing)
      const dummyHash = '$2a$12$invalidhashpadding000000000000000000000000000000000000000';
      const validPass = await bcrypt.compare(password, user ? user.password_hash : dummyHash);

      if (!user || !validPass) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }
      if (!user.is_active) {
        return res.status(403).json({ error: 'Your account has been disabled. Contact admin.' });
      }

      // Issue tokens
      const payload = { id: user.id, uuid: user.uuid, role: user.role };
      const accessToken  = signAccess(payload);
      const refreshToken = signRefresh(payload);

      // Store hashed refresh token
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const expiresAt = new Date(Date.now() + REFRESH_TTL_MS).toISOString();
      db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
        .run(user.id, tokenHash, expiresAt);

      // Update last_login
      db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

      setTokenCookies(res, accessToken, refreshToken);

      return res.json({
        message: 'Login successful.',
        user: { uuid: user.uuid, full_name: user.full_name, email: user.email, username: user.username, role: user.role },
      });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ error: 'Login failed. Please try again.' });
    }
  }
);

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
router.post('/refresh', (req, res) => {
  const token = req.cookies?.refresh_token;
  if (!token) return res.status(401).json({ error: 'Refresh token missing.' });

  try {
    const decoded = jwt.verify(token, REFRESH_SECRET);

    // Validate stored token hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const stored = db.prepare(`
      SELECT id FROM refresh_tokens
      WHERE token_hash = ? AND user_id = ? AND expires_at > datetime('now')
    `).get(tokenHash, decoded.id);

    if (!stored) return res.status(401).json({ error: 'Invalid or expired refresh token.' });

    const user = db.prepare('SELECT id, uuid, role, is_active FROM users WHERE id = ?').get(decoded.id);
    if (!user || !user.is_active) return res.status(401).json({ error: 'Account not found.' });

    // Rotate tokens
    const newPayload = { id: user.id, uuid: user.uuid, role: user.role };
    const newAccess  = signAccess(newPayload);
    const newRefresh = signRefresh(newPayload);

    const newHash    = crypto.createHash('sha256').update(newRefresh).digest('hex');
    const expiresAt  = new Date(Date.now() + REFRESH_TTL_MS).toISOString();

    db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(stored.id);
    db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
      .run(user.id, newHash, expiresAt);

    setTokenCookies(res, newAccess, newRefresh);
    return res.json({ message: 'Token refreshed.' });
  } catch {
    clearTokenCookies(res);
    return res.status(401).json({ error: 'Invalid refresh token.' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', requireAuth, (req, res) => {
  const token = req.cookies?.refresh_token;
  if (token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(tokenHash);
  }
  clearTokenCookies(res);
  return res.json({ message: 'Logged out successfully.' });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare(`
    SELECT uuid, full_name, email, username, role, student_id, created_at, last_login
    FROM users WHERE id = ?
  `).get(req.user.id);
  return res.json({ user });
});

module.exports = router;
