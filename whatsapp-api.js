// whatsapp-api.js - קריאות ל-Twilio WhatsApp API - שליחת הודעות (חופשי בתוך חלון 24 שעות
// של שיחה פעילה, Content Template כשהחלון סגור), המרת טלפון מקומי לפורמט E.164 שTwilio
// דורש, ואימות חתימת ה-webhook הנכנס (ראו whatsapp-router.js)
const crypto = require('node:crypto');

function credentials() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!accountSid || !authToken || !from) {
    throw new Error('חסרים TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM ב-.env');
  }
  return { accountSid, authToken, from };
}

/** ממיר טלפון מקומי מאוחסן (למשל "0501111111") לפורמט E.164 עם "+" (למשל "+972501111111"). */
function toE164(localPhone) {
  const countryCode = process.env.WHATSAPP_COUNTRY_CODE || '972';
  const digits = String(localPhone).replace(/\D/g, '');
  const national = digits.replace(/^0/, '');
  return `+${countryCode}${national}`;
}

async function postMessage(params) {
  const { accountSid, authToken, from } = credentials();
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const body = new URLSearchParams({ From: `whatsapp:${from.replace(/^whatsapp:/, '')}`, ...params });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json();

  if (!res.ok) {
    const err = new Error(`WhatsApp שליחה נכשלה: ${data?.message || 'unknown error'}`);
    err.code = data?.code;
    throw err;
  }
  return data;
}

/**
 * הודעת טקסט חופשית - חינמית, אבל עובדת רק בתוך חלון 24 שעות מאז הודעה אחרונה שהתקבלה
 * מהנמען הזה (מדיניות WhatsApp) - אחרת Twilio מחזירה שגיאת קוד 63016/63024 (ראו chat.js,
 * שם הכישלון הזה מפעיל ניסיון נוסף עם sendWhatsAppTemplate אם מוגדר).
 */
async function sendWhatsAppText(text, recipientPhone) {
  return postMessage({ To: `whatsapp:${toE164(recipientPhone)}`, Body: text });
}

/**
 * הודעת Content Template מאושרת מראש (Twilio Content API) - היחידה שמותר לשלוח כשחלון
 * 24 השעות סגור (למשל התראת Yemot יזומה). ה-template חייב כבר להיות מאושר ב-Twilio
 * Content Template Builder (קטגוריית Utility) עם משתנה גוף אחד לטקסט ההודעה - ראו README.
 */
async function sendWhatsAppTemplate(contentSid, contentVariables, recipientPhone) {
  return postMessage({
    To: `whatsapp:${toE164(recipientPhone)}`,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify(contentVariables),
  });
}

/**
 * מאמת שה-webhook הנכנס באמת הגיע מ-Twilio - נוסחת האימות הרשמית: HMAC-SHA1 עם
 * TWILIO_AUTH_TOKEN על ה-URL המלא ששימש לקריאה, בתוספת כל זוג מפתח+ערך מהפרמטרים
 * (ממוינים לפי מפתח, בלי מפרידים), base64 - מול header X-Twilio-Signature.
 * ראו https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
function verifyTwilioSignature(url, params, signatureHeader) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !signatureHeader) return false;

  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, key) => acc + key + params[key], url);

  const expected = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');

  const expectedBuf = Buffer.from(expected, 'base64');
  const providedBuf = Buffer.from(signatureHeader, 'base64');
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

module.exports = {
  toE164,
  sendWhatsAppText,
  sendWhatsAppTemplate,
  verifyTwilioSignature,
};
