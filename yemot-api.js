// yemot-api.js - קריאות ל-API הרגיל (היוצא) של ימות המשיח, כדי להוריד קבצי הקלטה
// מבוסס על המסמך Yemot_Campaign_API.docx (Login, DownloadFile)
const BASE_URL = 'https://www.call2all.co.il/ym/api/';

async function login() {
  const username = process.env.YEMOT_SYSTEM_NUMBER;
  const password = process.env.YEMOT_PASSWORD;
  if (!username || !password) {
    throw new Error('חסרים YEMOT_SYSTEM_NUMBER / YEMOT_PASSWORD ב-.env');
  }

  const url = `${BASE_URL}Login?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.responseStatus !== 'OK') {
    throw new Error(`Yemot Login נכשל: ${data.message || 'unknown error'}`);
  }
  return data.token;
}

async function downloadFile(token, path) {
  const url = `${BASE_URL}DownloadFile?token=${encodeURIComponent(token)}&path=${encodeURIComponent(path)}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Yemot DownloadFile נכשל (HTTP ${res.status}) עבור path=${path}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** מתחבר ומוריד קובץ הקלטה במכה אחת */
async function downloadRecording(path) {
  const token = await login();
  // הנתיב שמוחזר מ-call.read (מודול ה-IVR) הוא יחסי לשלוחה (למשל "5/000.wav") -
  // ל-DownloadFile צריך קידומת "ivr2:" כדי שיידע למצוא את הקובץ בפועל
  return downloadFile(token, `ivr2:${path}`);
}

/**
 * `tts: true` = מספור אוטומטי (ראו https://f2.freeivr.co.il/topic/9590 - עם path שהוא
 * תיקייה בלבד, בלי שם קובץ, ו-tts=1 בכתובת, ימות עצמה בוחרת את המספר הבא בתור ומוסיפה
 * סיומת .tts - זה מה שגורם ל"השמעת הקובץ האחרון שהועלה" לעבוד נכון בלי התנגשויות שמות.
 */
async function uploadFile(token, path, buffer, filename, { tts = false } = {}) {
  const form = new FormData();
  form.append('token', token);
  form.append('path', path);
  form.append('file', new Blob([buffer], { type: 'text/plain' }), filename);

  const url = `${BASE_URL}UploadFile${tts ? '?tts=1' : ''}`;
  const res = await fetch(url, { method: 'POST', body: form });
  const data = await res.json();

  if (data.responseStatus !== 'OK') {
    throw new Error(`Yemot UploadFile נכשל: ${data.message || 'unknown error'}`);
  }
  return data;
}

/**
 * שולח הודעת טקסט כקובץ TTS לשלוחת ה-TTS של הנמען, בתת-תיקייה לפי מספר הטלפון של הנמען
 * עצמו - כך שכשהוא מתקשר לשלוחה (שיכולה להיות משותפת למספר משתמשים, ראו users.js)
 * ימות מזהה אותו לפי Caller ID ומנחית אותו ישר על התיקייה עם ההודעות שלו.
 * לא קובעים שם קובץ בעצמנו - ימות עצמה ממספרת את הקובץ אוטומטית (tts:true למעלה),
 * ומשמיעה תמיד את המספר הגבוה ביותר בתיקייה, כלומר את ההודעה האחרונה שהועלתה.
 */
async function sendTextReply(text, recipientExtension, recipientPhone) {
  // אותם תווים לא חוקיים שימות דוחה בהקראת TTS בכל הקשר אחר (ראו yemot-ivr.js)
  const sanitized = text.replace(/[."'&-]/g, '');

  const token = await login();
  // אותה קידומת "ivr2:" שצריך גם ב-DownloadFile (ראו downloadRecording למעלה) - תיקייה
  // בלבד, בלי שם קובץ, כדי שהמספור האוטומטי של ימות יפעל (ראו הערה מעל uploadFile)
  const path = `ivr2:${recipientExtension}/Phone/${recipientPhone}`;
  return uploadFile(token, path, Buffer.from(sanitized, 'utf-8'), 'reply.tts', { tts: true });
}

/**
 * מעלה אובייקט כקובץ JSON לנתיב ivr2: נתון - משמש לגיבוי הודעות/subscriptions
 * לשרת של ימות, כדי שהנתונים ישרדו גם כשהדיסק של Render נמחק בין deploy-ים.
 */
async function uploadJson(path, obj) {
  const token = await login();
  return uploadFile(token, path, Buffer.from(JSON.stringify(obj), 'utf-8'), 'backup.json');
}

/** מוריד ומפענח קובץ JSON שהועלה עם uploadJson. מחזיר null אם אין עדיין גיבוי (או שגיאת רשת). */
async function downloadJson(path) {
  try {
    const token = await login();
    const buf = await downloadFile(token, path);
    return JSON.parse(buf.toString('utf-8'));
  } catch (err) {
    console.error('הורדת גיבוי מימות המשיח נכשלה (יכול להיות שעדיין אין גיבוי):', err.message);
    return null;
  }
}

/**
 * מפעיל צינתוק (שיחה יוצאת אוטומטית) לכל הרשומים ברשימת tzintuk נתונה - ראו
 * https://f2.freeivr.co.il/topic/14130 ו-https://mitmachim.top/topic/28633.
 * שימו לב: זה ה-API היחיד ב-yemot-api.js שמשתמש בטוקן "מספר:סיסמה" ישירות במקום
 * Login+session-token - כך זה מתועד ל-RunTzintuk באופן ספציפי. יש לו עלות קטנה
 * (חלק מיחידה למספר) - לא זהה לחלוטין לשאר הקריאות שבקובץ הזה שהן ללא עלות.
 * דורש שהנמען כבר נרשם פעם אחת לרשימה הזו (התקשר לשלוחת ההרשמה בפאנל ימות).
 */
async function runTzintuk(listId) {
  const username = process.env.YEMOT_SYSTEM_NUMBER;
  const password = process.env.YEMOT_PASSWORD;
  if (!username || !password) {
    throw new Error('חסרים YEMOT_SYSTEM_NUMBER / YEMOT_PASSWORD ב-.env');
  }

  const token = `${username}:${password}`;
  const url = `${BASE_URL}RunTzintuk?token=${encodeURIComponent(token)}&phones=${encodeURIComponent(`tzl:${listId}`)}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.responseStatus !== 'OK') {
    throw new Error(`Yemot RunTzintuk נכשל: ${data.message || 'unknown error'}`);
  }
  return data;
}

module.exports = { downloadRecording, sendTextReply, uploadJson, downloadJson, runTzintuk };
