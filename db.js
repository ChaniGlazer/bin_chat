// db.js - Lazy Proxy pattern (node:sqlite)
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'messages.db');

let _db = null;

function getDb() {
  if (!_db) {
    _db = new DatabaseSync(DB_PATH);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        phone TEXT NOT NULL,
        label TEXT NOT NULL,
        yemot_extension TEXT NOT NULL,
        yemot_reply_extension TEXT NOT NULL,
        tzintuk_list TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL REFERENCES users(id),
        recipient_id INTEGER NOT NULL REFERENCES users(id),
        text TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS subscriptions (
        endpoint TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        subscription_json TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        yemot_extension TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS group_members (
        group_id INTEGER NOT NULL REFERENCES groups(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        PRIMARY KEY (group_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS group_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL REFERENCES groups(id),
        sender_id INTEGER NOT NULL REFERENCES users(id),
        text TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // מיגרציה: תומך ב-DB ישן שנוצר לפני התמיכה בצ'אט בין-משתמשים (sender_id/recipient_id)
    const columns = _db.prepare('PRAGMA table_info(messages)').all();
    if (!columns.some((c) => c.name === 'sender_id')) {
      _db.exec('ALTER TABLE messages ADD COLUMN sender_id INTEGER REFERENCES users(id)');
    }
    if (!columns.some((c) => c.name === 'recipient_id')) {
      _db.exec('ALTER TABLE messages ADD COLUMN recipient_id INTEGER REFERENCES users(id)');
    }
    const subColumns = _db.prepare('PRAGMA table_info(subscriptions)').all();
    if (!subColumns.some((c) => c.name === 'user_id')) {
      _db.exec('ALTER TABLE subscriptions ADD COLUMN user_id INTEGER REFERENCES users(id)');
    }
    const userColumns = _db.prepare('PRAGMA table_info(users)').all();
    if (!userColumns.some((c) => c.name === 'phone')) {
      _db.exec("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
    }
    if (!userColumns.some((c) => c.name === 'label')) {
      _db.exec("ALTER TABLE users ADD COLUMN label TEXT NOT NULL DEFAULT ''");
    }
    if (!userColumns.some((c) => c.name === 'tzintuk_list')) {
      _db.exec('ALTER TABLE users ADD COLUMN tzintuk_list TEXT');
    }
    const groupColumns = _db.prepare('PRAGMA table_info(groups)').all();
    if (!groupColumns.some((c) => c.name === 'yemot_extension')) {
      _db.exec('ALTER TABLE groups ADD COLUMN yemot_extension TEXT');
    }
  }
  return _db;
}

const db = new Proxy({}, {
  get(_target, prop) {
    const real = getDb();
    const value = real[prop];
    return typeof value === 'function' ? value.bind(real) : value;
  },
});

module.exports = db;
