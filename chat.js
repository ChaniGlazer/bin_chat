// chat.js - שולח הודעה בין שני משתמשים רשומים (מהאפליקציה או מימות), בלי קשר לערוץ שבו
// הגיעה ההודעה: שומר ב-DB, דוחף Push אם לנמען יש מכשיר רשום, מעלה TTS לתיבת ימות של
// הנמען (בתיקיית phone/<הטלפון של הנמען עצמו> תחת שלוחת ה-TTS שלו) - כך שכשהוא מתקשר
// לשלוחה המשותפת מהטלפון שלו, ימות מזהה אותו לפי Caller ID ומנחית אותו בדיוק על התיקייה שלו -
// ואם יש לו tzintuk_list רשום, גם מפעיל שיחת התראה יוצאת אליו (ראו yemot-api.js - runTzintuk).
const db = require('./db');
const { sendPushToAll } = require('./webpush');
const { sendTextReply, runTzintuk } = require('./yemot-api');
const { backupToYemot } = require('./backup');

async function deliverMessage(sender, recipient, text) {
  db.prepare('INSERT INTO messages (sender_id, recipient_id, text) VALUES (?, ?, ?)').run(
    sender.id,
    recipient.id,
    text
  );

  const rows = db.prepare('SELECT subscription_json FROM subscriptions WHERE user_id = ?').all(recipient.id);
  const subscriptions = rows.map((r) => JSON.parse(r.subscription_json));
  if (subscriptions.length) {
    const results = await sendPushToAll(subscriptions, sender.label || sender.username, text);
    const expired = results.filter((r) => r.expired).map((r) => r.endpoint);
    if (expired.length) {
      const del = db.prepare('DELETE FROM subscriptions WHERE endpoint = ?');
      expired.forEach((e) => del.run(e));
    }
  }

  try {
    // מוסיפים את שם השולח לפני הטקסט (רק בהקראה בטלפון - ב-DB/Push נשמר הטקסט הנקי)
    // כדי שהשומע ידע ממי ההודעה, בלי לחייב אותו לזהות לפי קול/הקשר.
    await sendTextReply(`הודעה מ${sender.label || sender.username}. ${text}`, recipient.yemot_reply_extension, recipient.phone);
  } catch (err) {
    console.error(`שליחת TTS לתיבת ימות של ${recipient.username} נכשלה:`, err.message);
  }

  if (recipient.tzintuk_list) {
    try {
      await runTzintuk(recipient.tzintuk_list);
    } catch (err) {
      console.error(`הפעלת צינתוק ל-${recipient.username} נכשלה:`, err.message);
    }
  }

  backupToYemot(sender);
  backupToYemot(recipient);
}

module.exports = { deliverMessage };
