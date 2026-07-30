// backup.js - שומר גיבוי של הודעות + subscriptions של כל משתמש כקובץ JSON נפרד
// בשרת של ימות המשיח (במקום רק בדיסק של Render, שנמחק בכל deploy מחדש). כל משתמש
// מגבה לתיקייה הייעודית שלו (Phone/<הטלפון שלו>) תחת שלוחת ה-TTS שלו - חובה כי כמה
// משתמשים חולקים אותה שלוחה (yemot_reply_extension), אז לא ניתן להשתמש בנתיב אחד לכולם.
// ההודעות נשמרות עם sender_username/recipient_username (לא sender_id/recipient_id) כי
// ה-id הפנימי הוא רץ אוטומטי שמתחלף בין מופעי DB שונים של אותו פרויקט (למשל שרת מקומי
// מול Render) - אימות לפי username הוא היחיד שנשאר תקף בין המופעים.
const db = require('./db');
const { uploadJson, downloadJson } = require('./yemot-api');
const { findByUsername, setTzintukList } = require('./users');

function backupPath(user) {
  return `ivr2:${user.yemot_reply_extension}/Phone/${user.phone}/backup.json`;
}

/** שולף את הודעות+subscriptions+רישום צינתוק של משתמש בודד ומעלה כקובץ JSON. לא קריטי - שגיאה כאן לא מפילה בקשה. */
async function backupToYemot(user) {
  try {
    const messages = db
      .prepare(
        `SELECT m.text, m.created_at, su.username AS sender_username, ru.username AS recipient_username
         FROM messages m
         JOIN users su ON su.id = m.sender_id
         JOIN users ru ON ru.id = m.recipient_id
         WHERE m.sender_id = ? OR m.recipient_id = ?`
      )
      .all(user.id, user.id);
    const subscriptions = db.prepare('SELECT subscription_json, created_at FROM subscriptions WHERE user_id = ?').all(user.id);
    await uploadJson(backupPath(user), { messages, subscriptions, tzintukList: user.tzintuk_list || null });
  } catch (err) {
    console.error(`גיבוי לימות המשיח נכשל (${user.username}):`, err.message);
  }
}

/**
 * ממזג הודעות (וב-restore הראשוני גם subscriptions) מהגיבוי של משתמש ל-DB המקומי.
 * בטוח להריץ שוב ושוב - זיהוי כפילויות לפי תוכן (שולח+נמען+טקסט+זמן), לא לפי id שלא
 * ניתן לשחזור בין מופעי DB שונים. רישום הצינתוק (tzintukList) משוחזר תמיד כשאין ערך
 * מקומי - זה קריטי לשחזר גם כשיש כבר הודעות מקומיות (למשל אחרי redeploy שמחק רק חלק
 * מהנתונים), כי בלעדיו הודעות חדשות לא יפעילו צינתוק אף שהמשתמש כבר רשום בימות בפועל.
 */
async function mergeFromYemot(user, { includeSubscriptions }) {
  const data = await downloadJson(backupPath(user));
  if (!data) return 0;

  const insertMsg = db.prepare(
    'INSERT INTO messages (sender_id, recipient_id, text, created_at) VALUES (?, ?, ?, ?)'
  );
  const existsMsg = db.prepare(
    'SELECT 1 FROM messages WHERE sender_id = ? AND recipient_id = ? AND text = ? AND created_at = ?'
  );

  let added = 0;
  for (const m of data.messages || []) {
    const sender = findByUsername(m.sender_username);
    const recipient = findByUsername(m.recipient_username);
    if (!sender || !recipient) continue; // משתמש שכבר לא קיים ב-USERS_JSON
    if (existsMsg.get(sender.id, recipient.id, m.text, m.created_at)) continue;
    insertMsg.run(sender.id, recipient.id, m.text, m.created_at);
    added++;
  }

  if (includeSubscriptions) {
    const insertSub = db.prepare(
      'INSERT OR REPLACE INTO subscriptions (endpoint, user_id, subscription_json, created_at) VALUES (?, ?, ?, ?)'
    );
    for (const s of data.subscriptions || []) {
      const sub = JSON.parse(s.subscription_json);
      insertSub.run(sub.endpoint, user.id, s.subscription_json, s.created_at);
    }
  }

  if (data.tzintukList && !user.tzintuk_list) {
    setTzintukList(user.id, data.tzintukList);
    console.log(`שוחזר רישום צינתוק (tzintuk_list=${data.tzintukList}) עבור ${user.username} מהגיבוי בימות המשיח`);
  }

  return added;
}

/**
 * משחזר את הנתונים של משתמש בודד מהגיבוי בימות. רישום הצינתוק משוחזר תמיד (אם חסר
 * מקומית); הודעות+subscriptions משוחזרים רק אם אין למשתמש כבר הודעות מקומיות (למשל
 * אחרי deploy חדש ב-Render שמחק את הדיסק) - לא דורסים נתונים מקומיים קיימים.
 */
async function restoreFromYemot(user) {
  const { c } = db
    .prepare('SELECT COUNT(*) AS c FROM messages WHERE sender_id = ? OR recipient_id = ?')
    .get(user.id, user.id);

  const added = await mergeFromYemot(user, { includeSubscriptions: c === 0 });
  if (c === 0 && added) {
    console.log(`שוחזרו ${added} הודעות מהגיבוי בימות המשיח עבור ${user.username}`);
  }
}

/** מריץ שחזור לכל המשתמשים הרשומים - נקרא באתחול השרת. */
async function restoreAllFromYemot() {
  const users = db.prepare('SELECT * FROM users').all();
  for (const user of users) {
    await restoreFromYemot(user);
  }
}

/**
 * מסנכרן (תמיד, גם אם כבר יש הודעות מקומיות) הודעות חדשות מהגיבוי בימות לכל המשתמשים -
 * למצב "מירור מקומי" (LOCAL_MIRROR=true), ראו server.js. לא מסנכרן subscriptions - שרת
 * מקומי לא אמור לשלוח Push בעצמו, רק להציג הודעות שנוצרו ע"י המופע האמיתי (למשל Render).
 */
async function syncAllFromYemot() {
  const users = db.prepare('SELECT * FROM users').all();
  let total = 0;
  for (const user of users) {
    total += await mergeFromYemot(user, { includeSubscriptions: false });
  }
  if (total > 0) {
    console.log(`מירור מקומי: התקבלו ${total} הודעות חדשות מהגיבוי בימות המשיח`);
  }
}

module.exports = { backupToYemot, restoreAllFromYemot, syncAllFromYemot };
