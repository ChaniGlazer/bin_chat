// users.js - ניהול משתמשים לתמיכה ברב-משתמשים וצ'אט בין-משתמשים: כל משתמש עם login נפרד,
// שלוחות ימות נפרדות (אחת לשיחות נכנסות, אחת לשמיעת הודעות/TTS), ומספר טלפון משלו -
// המספר הזה הוא ה"כתובת" של המשתמש הן באפליקציה (מזהה שיחה) והן בימות (תיקיית phone/<מספר>
// תחת שלוחת ה-TTS שלו, וגם לזיהוי אוטומטי לפי ApiPhone כשהוא מתקשר מהטלפון של עצמו).
// המשתמשים מוגדרים ב-.env (USERS_JSON) ונטענים ל-DB באתחול - אין UI לניהול משתמשים,
// זה תואם לגישה הקיימת בפרויקט (הגדרות ב-.env, לא פאנל ניהול).
const crypto = require('node:crypto');
const db = require('./db');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function findByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function findByYemotExtension(extension) {
  return db.prepare('SELECT * FROM users WHERE yemot_extension = ?').get(extension);
}

function findByPhone(phone) {
  return db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
}

/** רשימת "אנשי קשר" לצ'אט - כל המשתמשים חוץ מהמשתמש עצמו, בלי שדות רגישים. */
function listOthers(excludeUserId) {
  return db
    .prepare('SELECT id, username, phone, yemot_extension FROM users WHERE id != ? ORDER BY username')
    .all(excludeUserId);
}

/**
 * טוען משתמשים מתוך USERS_JSON (מערך JSON ב-.env) ל-DB. פורמט:
 * [{"username":"...","password":"...","phone":"...","yemotExtension":"135","yemotReplyExtension":"6"}, ...]
 * `password` אופציונלי - למשתמש "טלפון בלבד" שלא נכנס לאפליקציה (למשל מדבר רק דרך ימות)
 * אפשר להשמיט אותו; במקרה כזה נוצרת סיסמה רנדומלית שאף אחד לא מכיר, כך שלא ניתן להתחבר
 * לאפליקציה בשמו בפועל, אבל הוא עדיין מופיע כאיש קשר לצ'אט ויכול לשלוח/לקבל דרך ימות.
 * הסיסמה מוצפנת (scrypt) לפני השמירה. אם המשתמש כבר קיים - מעדכנים סיסמה+טלפון+שלוחות
 * (ה-.env הוא מקור האמת, כמו שאר ההגדרות בפרויקט), בלי לגעת בהודעות/subscriptions שלו.
 */
function seedUsersFromEnv() {
  const raw = process.env.USERS_JSON;
  if (!raw) return;

  let users;
  try {
    users = JSON.parse(raw);
  } catch (err) {
    throw new Error(`USERS_JSON לא JSON תקין: ${err.message}`);
  }

  const upsert = db.prepare(`
    INSERT INTO users (username, password_hash, phone, yemot_extension, yemot_reply_extension)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      password_hash = excluded.password_hash,
      phone = excluded.phone,
      yemot_extension = excluded.yemot_extension,
      yemot_reply_extension = excluded.yemot_reply_extension
  `);

  for (const u of users) {
    if (!u.username || !u.phone || !u.yemotExtension || !u.yemotReplyExtension) {
      throw new Error(`רשומה חסרה שדות ב-USERS_JSON: ${JSON.stringify(u)}`);
    }
    const password = u.password || crypto.randomBytes(24).toString('hex');
    upsert.run(
      u.username,
      hashPassword(password),
      String(u.phone),
      String(u.yemotExtension),
      String(u.yemotReplyExtension)
    );
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  findByUsername,
  findByYemotExtension,
  findByPhone,
  listOthers,
  seedUsersFromEnv,
};
