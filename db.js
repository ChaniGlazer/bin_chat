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
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        from_phone TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS subscriptions (
        endpoint TEXT PRIMARY KEY,
        subscription_json TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
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
