// backup.js - שומר גיבוי של הודעות + subscriptions של כל משתמש כקובץ JSON נפרד
// בשרת של ימות המשיח (במקום רק בדיסק של Render, שנמחק בכל deploy מחדש)
const db = require('./db');
const { uploadJson, downloadJson } = require('./yemot-api');

function backupPath(user) {
  return `ivr2:${user.yemot_reply_extension}/backup.json`;
}

/** שולף את הודעות+subscriptions של משתמש בודד (שנשלחו ע"י או אליו) ומעלה כקובץ JSON. לא קריטי - שגיאה כאן לא מפילה בקשה. */
async function backupToYemot(user) {
  try {
    const messages = db
      .prepare('SELECT * FROM messages WHERE sender_id = ? OR recipient_id = ?')
      .all(user.id, user.id);
    const subscriptions = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').all(user.id);
    await uploadJson(backupPath(user), { messages, subscriptions });
  } catch (err) {
    console.error(`גיבוי לימות המשיח נכשל (${user.username}):`, err.message);
  }
}

/**
 * משחזר את הנתונים של משתמש בודד מהגיבוי בימות - רק אם אין לו כבר הודעות מקומיות
 * (למשל אחרי deploy חדש ב-Render שמחק את הדיסק). לא דורס נתונים מקומיים קיימים.
 * משתמשים ב-INSERT OR IGNORE כי אותה הודעה (זוג שולח/נמען) יכולה להופיע בגיבוי של שני
 * הצדדים - לא רוצים שגיאת מפתח כפול כששוחזרים גם את הגיבוי של הצד השני.
 */
async function restoreFromYemot(user) {
  const { c } = db
    .prepare('SELECT COUNT(*) AS c FROM messages WHERE sender_id = ? OR recipient_id = ?')
    .get(user.id, user.id);
  if (c > 0) return;

  const data = await downloadJson(backupPath(user));
  if (!data) return;

  const insertMsg = db.prepare(
    'INSERT OR IGNORE INTO messages (id, sender_id, recipient_id, text, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  for (const m of data.messages || []) {
    insertMsg.run(m.id, m.sender_id, m.recipient_id, m.text, m.created_at);
  }

  const insertSub = db.prepare(
    'INSERT OR REPLACE INTO subscriptions (endpoint, user_id, subscription_json, created_at) VALUES (?, ?, ?, ?)'
  );
  for (const s of data.subscriptions || []) {
    insertSub.run(s.endpoint, user.id, s.subscription_json, s.created_at);
  }

  console.log(
    `שוחזרו ${data.messages?.length || 0} הודעות ו-${data.subscriptions?.length || 0} subscriptions מהגיבוי בימות המשיח עבור ${user.username}`
  );
}

/** מריץ שחזור לכל המשתמשים הרשומים - נקרא באתחול השרת. */
async function restoreAllFromYemot() {
  const users = db.prepare('SELECT * FROM users').all();
  for (const user of users) {
    await restoreFromYemot(user);
  }
}

module.exports = { backupToYemot, restoreAllFromYemot };
