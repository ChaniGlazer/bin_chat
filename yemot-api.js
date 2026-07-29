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

module.exports = { downloadRecording };
