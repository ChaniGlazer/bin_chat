// webpush.js - שליחת Push דרך VAPID (הרבה יותר פשוט מ-APNs)
const webpush = require('web-push');

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_CONTACT_EMAIL || 'admin@example.com'}`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * שולח הודעה לכל ה-subscriptions שסופקו.
 * מחזיר מערך תוצאות עם endpoint + ok + statusCode, כדי שהקורא יוכל
 * למחוק subscriptions שפגו (404/410) מהדאטהבייס.
 */
async function sendPushToAll(subscriptions, text) {
  const payload = JSON.stringify({ title: 'הודעה חדשה', body: text });

  const settled = await Promise.allSettled(
    subscriptions.map((sub) => webpush.sendNotification(sub, payload))
  );

  return settled.map((result, i) => {
    const endpoint = subscriptions[i].endpoint;
    if (result.status === 'fulfilled') {
      return { endpoint, ok: true };
    }
    const statusCode = result.reason?.statusCode;
    console.error(`שליחה נכשלה ל-${endpoint}:`, statusCode, result.reason?.body);
    return { endpoint, ok: false, statusCode, expired: statusCode === 404 || statusCode === 410 };
  });
}

module.exports = { sendPushToAll };
