require('dotenv').config();
const path = require('node:path');
const express = require('express');
const db = require('./db');
const { backupToYemot, restoreAllFromYemot } = require('./backup');
const { verifyPassword, findByUsername, listOthers, seedUsersFromEnv } = require('./users');
const { deliverMessage } = require('./chat');
const yemotRouter = require('./yemot-ivr');

seedUsersFromEnv();

const app = express();
app.use(express.json());

// שלוחת ימות המשיח (מודול API) - שלוחה אחת משותפת לכולם, צריכה להצביע ל-<כתובת-השרת>/yemot
// (ראו yemot-ivr.js - היא שואלת "מי אתה" ו"למי לשלוח" בתפריט טונים דינמי) - חייב להישאר
// לפני requireAuth, זו קריאה חיצונית משרת ימות, לא מהדפדפן
app.use('/yemot', yemotRouter.asExpressRouter);

// כל מה שמתחת לכאן (הדף, הקבצים הסטטיים וה-API) דורש שם משתמש+סיסמה - כל משתמש עם
// login נפרד משלו (מוגדרים ב-USERS_JSON, ראו users.js). שום סוד לא נשלח לדפדפן,
// הדפדפן שולח Basic Auth רק אחרי שהמשתמש הקליד את הסיסמה בפרומפט המובנה.
function requireAuth(req, res, next) {
  const header = req.header('authorization') || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [username, pass] = Buffer.from(encoded, 'base64').toString().split(':');
    const user = findByUsername(username);
    if (user && verifyPassword(pass, user.password_hash)) {
      req.user = user;
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

// רשימת "אנשי קשר" לצ'אט - שאר המשתמשים הרשומים במערכת
app.get('/contacts', (req, res) => {
  res.json(listOthers(req.user.id));
});

// הדפדפן שולח לכאן את אובייקט ה-PushSubscription אחרי הרשמה
app.post('/register-device', (req, res) => {
  const subscription = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ error: 'invalid subscription' });

  db.prepare(
    'INSERT OR REPLACE INTO subscriptions (endpoint, user_id, subscription_json) VALUES (?, ?, ?)'
  ).run(subscription.endpoint, req.user.id, JSON.stringify(subscription));

  backupToYemot(req.user);
  res.json({ ok: true });
});

// שולח הודעה למשתמש אחר - נשמרת ב-DB, נדחפת ב-Push אם יש לו מכשיר רשום, ומועלית כ-TTS
// לתיבת ימות שלו (ראו chat.js). `to` הוא ה-username של הנמען.
app.post('/send', async (req, res) => {
  const { to, text } = req.body;
  if (!to || !text) return res.status(400).json({ error: 'to and text required' });

  const recipient = findByUsername(to);
  if (!recipient) return res.status(404).json({ error: 'unknown recipient' });

  await deliverMessage(req.user, recipient, text);
  res.json({ ok: true });
});

// שיחה מול משתמש ספציפי (?with=username) - שתי הכיוונים, לא רק מה שקיבלתי
app.get('/messages', (req, res) => {
  const partner = req.query.with ? findByUsername(req.query.with) : null;
  if (!partner) return res.status(400).json({ error: 'with (username) required' });

  const rows = db
    .prepare(
      `SELECT id, sender_id, recipient_id, text, created_at FROM messages
       WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
       ORDER BY id DESC LIMIT 100`
    )
    .all(req.user.id, partner.id, partner.id, req.user.id);

  const messages = rows.reverse().map((m) => ({
    id: m.id,
    text: m.text,
    created_at: m.created_at,
    direction: m.sender_id === req.user.id ? 'out' : 'in',
  }));
  res.json(messages);
});

const PORT = process.env.PORT || 3000;
restoreAllFromYemot()
  .catch((err) => console.error('שחזור גיבוי מימות המשיח נכשל:', err.message))
  .finally(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  });
