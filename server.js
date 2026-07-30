require('dotenv').config();
const path = require('node:path');
const express = require('express');
const db = require('./db');
const { backupToYemot, restoreAllFromYemot, syncAllFromYemot } = require('./backup');
const { verifyPassword, findByUsername, listOthers, seedUsersFromEnv } = require('./users');
const { deliverMessage, deliverGroupMessage } = require('./chat');
const { ensureDefaultGroup, findGroupById, listGroupsForUser, listGroupMembersExcept, isMember } = require('./groups');
const yemotRouter = require('./yemot-ivr');

seedUsersFromEnv();
ensureDefaultGroup();

const app = express();
app.use(express.json());

// לוג זמני לאבחון "אין מענה בשרת API" - yemot-router2 דורש 4 פרמטרים חובה
// (ApiPhone/ApiDID/ApiExtension/ApiCallId) ועונה בשקט בלי שום לוג אם אחד מהם חסר,
// אז זה חייב לקרות *לפני* ה-mount שלו כדי לתפוס בקשות שנכשלות שם. אפשר להסיר
// אחרי שהבעיה עם שלוחת ה-tzintuk תיפתר.
app.use('/yemot', (req, res, next) => {
  console.log(`[yemot debug] ${req.method} ${req.originalUrl} query=${JSON.stringify(req.query)} body=${JSON.stringify(req.body)}`);
  next();
});

// שלוחת ימות המשיח (מודול API) - שלוחה אחת משותפת לכולם, צריכה להצביע ל-<כתובת-השרת>/yemot
// (ראו yemot-ivr.js - היא שואלת "מי אתה" ו"למי לשלוח" בתפריט טונים דינמי) - חייב להישאר
// לפני requireAuth, זו קריאה חיצונית משרת ימות, לא מהדפדפן
app.use('/yemot', yemotRouter.asExpressRouter);

// הקבצים הסטטיים (index.html, app.js וכו') פתוחים לכולם בלי אימות - כדי שהעמוד יעלה
// ויוכל להציג טופס התחברות משלו. זה נחוץ כי הפרומפט המובנה של הדפדפן ל-Basic Auth
// לא עובד באמינות ב-PWA מותקן ב-iOS (מסך הבית) - אז לא אפשר להסתמך עליו, וכל האימות
// עובר דרך /login + Authorization header שה-JS מצרף בעצמו לכל בקשת API (ראו public/app.js).
app.use(express.static(path.join(__dirname, 'public')));

// כל ה-API שמתחת לכאן דורש שם משתמש+סיסמה - כל משתמש עם login נפרד משלו (מוגדרים
// ב-USERS_JSON, ראו users.js). שום סוד לא מוטבע בקוד - ה-JS שולח את מה שהוקלד בטופס.
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
  res.status(401).json({ error: 'unauthorized' });
}

// בודק אם username/password תקינים - נקרא מטופס ההתחברות של ה-JS (לא Basic Auth
// מהדפדפן) כדי לדעת אם לשמור אותם ב-localStorage ולהמשיך.
app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = username ? findByUsername(username) : null;
  if (!user || !verifyPassword(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
  }
  res.json({ ok: true });
});

app.use(requireAuth);

app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// רשימת "אנשי קשר" לצ'אט - שאר המשתמשים הרשומים במערכת
app.get('/contacts', (req, res) => {
  res.json(listOthers(req.user.id));
});

// קבוצות שהמשתמש חבר בהן (ראו groups.js - כרגע תמיד קבוצה אחת קבועה, "כולם")
app.get('/groups', (req, res) => {
  res.json(listGroupsForUser(req.user.id));
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

// שולח הודעה למשתמש אחר או לקבוצה - נשמרת ב-DB, נדחפת ב-Push. הודעה אישית גם מועלית
// כ-TTS ומפעילה צינתוק (ראו chat.js). `to` = username לנמען יחיד, `toGroup` = מזהה קבוצה.
app.post('/send', async (req, res) => {
  const { to, toGroup, text } = req.body;
  if ((!to && !toGroup) || !text) return res.status(400).json({ error: 'to/toGroup and text required' });

  if (toGroup) {
    const group = findGroupById(toGroup);
    if (!group || !isMember(group.id, req.user.id)) return res.status(404).json({ error: 'unknown group' });

    const members = listGroupMembersExcept(group.id, req.user.id);
    await deliverGroupMessage(req.user, group, text, members);
    return res.json({ ok: true });
  }

  const recipient = findByUsername(to);
  if (!recipient) return res.status(404).json({ error: 'unknown recipient' });

  await deliverMessage(req.user, recipient, text);
  res.json({ ok: true });
});

// שיחה מול משתמש ספציפי (?with=username) או קבוצה (?group=id) - לא רק מה שקיבלתי
app.get('/messages', (req, res) => {
  if (req.query.group) {
    const group = findGroupById(req.query.group);
    if (!group || !isMember(group.id, req.user.id)) return res.status(404).json({ error: 'unknown group' });

    const rows = db
      .prepare(
        `SELECT gm.id, gm.text, gm.created_at, gm.sender_id, u.label, u.username FROM group_messages gm
         JOIN users u ON u.id = gm.sender_id
         WHERE gm.group_id = ? ORDER BY gm.id DESC LIMIT 100`
      )
      .all(group.id);

    const messages = rows.reverse().map((m) => ({
      id: m.id,
      text: m.text,
      created_at: m.created_at,
      direction: m.sender_id === req.user.id ? 'out' : 'in',
      sender: m.label || m.username,
    }));
    return res.json(messages);
  }

  const partner = req.query.with ? findByUsername(req.query.with) : null;
  if (!partner) return res.status(400).json({ error: 'with (username) or group (id) required' });

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

    // מצב "מירור מקומי" - שרת שרץ במקביל לרנדר (למשל על המחשב שלך) רק כדי להציג את
    // כל הצ'אטים, בלי לשמש בפועל לשליחה/קבלה. מושך מהגיבוי בימות כל דקה כדי לראות
    // הודעות חדשות שנשלחו דרך המופע האמיתי (ראו LOCAL_MIRROR ב-README).
    if (process.env.LOCAL_MIRROR === 'true') {
      console.log('מצב מירור מקומי פעיל - מסנכרן הודעות מהגיבוי בימות המשיח כל דקה');
      setInterval(() => {
        syncAllFromYemot().catch((err) => console.error('סנכרון מירור מקומי נכשל:', err.message));
      }, 60_000);
    }
  });
