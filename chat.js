// chat.js - שולח הודעה בין שני משתמשים רשומים, או לקבוצה (ראו groups.js), בלי קשר לערוץ
// שבו הגיעה ההודעה: שומר ב-DB, דוחף Push למי שיש לו מכשיר רשום. הודעות אישיות (1:1) גם
// מעלות TTS לתיבת ימות של הנמען (בתיקיית phone/<הטלפון של הנמען עצמו> תחת שלוחת ה-TTS
// שלו - כך שכשהוא מתקשר לשלוחה המשותפת מהטלפון שלו, ימות מזהה אותו לפי Caller ID ומנחית
// אותו בדיוק על התיקייה שלו) ומפעילות צינתוק אם יש tzintuk_list רשום (ראו yemot-api.js -
// runTzintuk). הודעות קבוצה נשלחות רק ב-Push, לא בטלפון.
const db = require('./db');
const { sendPushToAll } = require('./webpush');
const { sendTextReply, runTzintuk } = require('./yemot-api');
const { backupToYemot } = require('./backup');

/** דוחף Push לרשימת משתמשים (חוץ מהשולח כבר מסונן ע"י הקורא), ומנקה subscriptions שפגו. */
async function pushToUsers(users, title, body) {
  for (const user of users) {
    const rows = db.prepare('SELECT subscription_json FROM subscriptions WHERE user_id = ?').all(user.id);
    const subscriptions = rows.map((r) => JSON.parse(r.subscription_json));
    if (!subscriptions.length) continue;

    const results = await sendPushToAll(subscriptions, title, body);
    const expired = results.filter((r) => r.expired).map((r) => r.endpoint);
    if (expired.length) {
      const del = db.prepare('DELETE FROM subscriptions WHERE endpoint = ?');
      expired.forEach((e) => del.run(e));
    }
  }
}

async function deliverMessage(sender, recipient, text) {
  db.prepare('INSERT INTO messages (sender_id, recipient_id, text) VALUES (?, ?, ?)').run(
    sender.id,
    recipient.id,
    text
  );

  await pushToUsers([recipient], sender.label || sender.username, text);

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
      console.log(`צינתוק הופעל בהצלחה ל-${recipient.username} (tzintuk_list=${recipient.tzintuk_list})`);
    } catch (err) {
      console.error(`הפעלת צינתוק ל-${recipient.username} נכשלה:`, err.message);
    }
  } else {
    console.log(`לא הופעל צינתוק ל-${recipient.username} - אין לו tzintuk_list רשום`);
  }

  backupToYemot(sender);
  backupToYemot(recipient);
}

/** הודעה לקבוצה - Push בלבד לכל החברים חוץ מהשולח, בלי TTS/צינתוק (ראו groups.js). */
async function deliverGroupMessage(sender, group, text, members) {
  db.prepare('INSERT INTO group_messages (group_id, sender_id, text) VALUES (?, ?, ?)').run(
    group.id,
    sender.id,
    text
  );

  await pushToUsers(members, `${sender.label || sender.username} (${group.name})`, text);
}

module.exports = { deliverMessage, deliverGroupMessage };
