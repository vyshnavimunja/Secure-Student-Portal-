/**
 * database.js – sql.js wrapper that mimics better-sqlite3's synchronous API.
 *
 * sql.js is a pure JavaScript/WASM SQLite port (no native compilation needed).
 * The database is kept in memory and serialised to disk after every write.
 */

const path = require('path');
const fs   = require('fs');

const DB_PATH  = path.join(__dirname, '..', 'data', 'portal.db');
const DATA_DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Internal state ─────────────────────────────────────────────────────────────
let _rawDb = null;   // sql.js Database instance

// ── Compat wrapper ─────────────────────────────────────────────────────────────

/**
 * Persist the in-memory database to disk.
 * Called after every INSERT / UPDATE / DELETE.
 */
function _save() {
  if (!_rawDb) return;
  const data = _rawDb.export();           // Uint8Array
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/**
 * Returns an object with get/all/run – matching the better-sqlite3 API.
 */
function _prepare(sql) {
  return {
    /**
     * Execute and return the first row (or null).
     * Parameters may be passed as multiple arguments or a single array.
     */
    get(...args) {
      if (!_rawDb) throw new Error('Database not initialised.');
      const params = args.flat();
      const stmt   = _rawDb.prepare(sql);
      if (params.length) stmt.bind(params);
      let result = null;
      if (stmt.step()) result = stmt.getAsObject();
      stmt.free();
      return result;
    },

    /**
     * Execute and return all rows as an array.
     */
    all(...args) {
      if (!_rawDb) throw new Error('Database not initialised.');
      const params  = args.flat();
      const stmt    = _rawDb.prepare(sql);
      if (params.length) stmt.bind(params);
      const results = [];
      while (stmt.step()) results.push(stmt.getAsObject());
      stmt.free();
      return results;
    },

    /**
     * Execute a write statement. Returns { changes, lastInsertRowid }.
     */
    run(...args) {
      if (!_rawDb) throw new Error('Database not initialised.');
      const params = args.flat();
      if (params.length) {
        _rawDb.run(sql, params);
      } else {
        _rawDb.run(sql);
      }
      const changes        = _rawDb.getRowsModified();
      const rowidRes       = _rawDb.exec('SELECT last_insert_rowid()');
      const lastInsertRowid = rowidRes[0]?.values[0]?.[0] ?? 0;
      _save();
      return { changes, lastInsertRowid };
    },
  };
}

/**
 * Execute raw SQL (no params, may be multi-statement DDL).
 * Returns the wrapper for chaining.
 */
function _exec(sql) {
  if (!_rawDb) throw new Error('Database not initialised.');
  _rawDb.exec(sql);
  _save();
  return wrapper;
}

/**
 * Execute a PRAGMA statement.
 */
function _pragma(str) {
  if (!_rawDb) throw new Error('Database not initialised.');
  _rawDb.run(`PRAGMA ${str}`);
  return wrapper;
}

// ── Public wrapper object exposed to all routes ────────────────────────────────
const wrapper = { prepare: _prepare, exec: _exec, pragma: _pragma };

// ── Async initialisation ───────────────────────────────────────────────────────
async function initDb() {
  if (_rawDb) return; // already initialised

  const initSqlJs = require('sql.js');
  const SQL       = await initSqlJs();

  const existing = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
  _rawDb = new SQL.Database(existing);

  // Enable foreign keys
  _rawDb.run('PRAGMA foreign_keys = ON');

  // ── Schema ─────────────────────────────────────────────────────────────────
  _rawDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid          TEXT    NOT NULL UNIQUE,
      full_name     TEXT    NOT NULL,
      email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'student' CHECK(role IN ('student','admin')),
      student_id    TEXT    UNIQUE,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      last_login    TEXT
    );

    CREATE TABLE IF NOT EXISTS courses (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      code        TEXT    NOT NULL UNIQUE,
      name        TEXT    NOT NULL,
      description TEXT,
      instructor  TEXT    NOT NULL,
      credits     INTEGER NOT NULL DEFAULT 3,
      semester    TEXT    NOT NULL,
      capacity    INTEGER NOT NULL DEFAULT 30,
      is_active   INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS enrollments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      enrolled_at TEXT    NOT NULL DEFAULT (datetime('now')),
      grade       TEXT,
      status      TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','dropped','completed')),
      UNIQUE(student_id, course_id)
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      content     TEXT    NOT NULL,
      author_id   INTEGER NOT NULL REFERENCES users(id),
      target      TEXT    NOT NULL DEFAULT 'all' CHECK(target IN ('all','students','admins')),
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  TEXT    NOT NULL UNIQUE,
      expires_at  TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  _save(); // persist schema
}

// ── Proxy: routes import `db` and it just works after initDb() ──────────────────
const db = new Proxy(wrapper, {
  get(target, prop) {
    if (prop === 'initDb') return initDb;
    if (!_rawDb && prop !== 'initDb') {
      throw new Error(`Database not initialised. Ensure initDb() is awaited before handling requests.`);
    }
    return target[prop];
  },
});

module.exports = db;
