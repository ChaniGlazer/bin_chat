require('dotenv').config();
const path = require('node:path');
const express = require('express');
const db = require('./db');
const { sendPushToAll } = require('./webpush');
const { sendTextReply } = require('./yemot-api');
const yemotRouter = require('./yemot-ivr');

const app = express();
app.use(express.json());

// שלוחת ימות המשיח (מודול API) צריכה להצביע ל-<כתובת-השרת>/yemot
// חייב להישאר לפני requireAuth - זו קריאה חיצונית משרת ימות, לא מהדפדפן
app.use('/yemot', yemotRouter.asExpressRouter);

// כל מה שמתחת לכאן (הדף, הקבצים הסטטיים וה-API) דורש שם משתמש+סיסמה.
// זה מחליף את המפתח שהיה קבוע בקוד הלקוח - עכשיו שום סוד לא נשלח לדפדפן,
// הדפדפן שולח Basic Auth רק אחרי שהמשתמש הקליד את הסיסמה בפרומפט המובנה.
function requireAuth(req, res, next) {
  const header = req.header('authorization') || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
    if (process.env.APP_PASSWORD && user === process.env.APP_USER && pass === process.env.APP_PASSWORD) {
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="messages-app", charset="UTF-8"');
  res.status(401).send('נדרשת התחברות');
}

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// הדפדפן שולח לכאן את אובייקט ה-PushSubscription אחרי הרשמה
app.post('/register-device', (req, res) => {
  const subscription = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ error: 'invalid subscription' });

  db.prepare(
    'INSERT OR REPLACE INTO subscriptions (endpoint, subscription_json) VALUES (?, ?)'
  ).run(subscription.endpoint, JSON.stringify(subscription));

  res.json({ ok: true });
});

app.post('/send', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  db.prepare('INSERT INTO messages (text) VALUES (?)').run(text);

  const rows = db.prepare('SELECT subscription_json FROM subscriptions').all();
  const subscriptions = rows.map((r) => JSON.parse(r.subscription_json));

  const results = subscriptions.length ? await sendPushToAll(subscriptions, text) : [];

  // ניקוי subscriptions שפגו
  const expired = results.filter((r) => r.expired).map((r) => r.endpoint);
  if (expired.length) {
    const del = db.prepare('DELETE FROM subscriptions WHERE endpoint = ?');
    expired.forEach((e) => del.run(e));
  }

  res.json({ ok: true, sentTo: subscriptions.length, results });
});

// לא מחזירים את audio_base64 כאן (יכול להיות כבד) - רק מטא-דאטה
app.get('/messages', (req, res) => {
  const rows = db
    .prepare('SELECT id, text, from_phone, direction, created_at FROM messages ORDER BY id DESC LIMIT 100')
    .all();
  res.json(rows.reverse());
});

// שולח תשובת טקסט כקובץ TTS לשלוחה שהמחייג יכול לחייג אליה ולשמוע (ראו yemot-api.js)
app.post('/reply', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  try {
    await sendTextReply(text);
  } catch (err) {
    console.error('שליחת תשובה לימות המשיח נכשלה:', err);
    return res.status(500).json({ error: 'send failed' });
  }

  db.prepare("INSERT INTO messages (text, direction) VALUES (?, 'out')").run(text);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
