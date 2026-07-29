// generate-vapid-keys.js - הרץ פעם אחת: node generate-vapid-keys.js
// ותעתיק את המפתחות ל-.env (ולמשתני הסביבה ב-Render)
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
