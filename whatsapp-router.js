// whatsapp-router.js - webhook דו-כיווני מול Twilio WhatsApp API. בשונה מ-yemot-ivr.js אין
// כאן מכונת מצבים של שיחה חיה - כל בקשה נכנסת היא הודעת טקסט בודדת, עומדת בפני עצמה.
// בשונה מ-Meta אין handshake נפרד - Twilio רק שולח POST להודעה נכנסת, והתשובה חוזרת
// בתוך אותה בקשה כ-TwiML (XML), בלי צורך בקריאת API נוספת.
const express = require('express');
const { verifyTwilioSignature } = require('./whatsapp-api');
const { findByPhoneSuffix, findByYemotExtension, listAllForMenu } = require('./users');
const { findGroupByYemotExtension, listGroupsForMenu, listGroupMembersExcept } = require('./groups');
const { deliverMessage, deliverGroupMessage } = require('./chat');

const router = express.Router();

/** אותו רעיון כמו buildMenuPrompt ב-yemot-ivr.js, מנוסח כטקסט הסבר ל-WhatsApp. */
function buildUsageHint() {
  const users = listAllForMenu();
  const groups = listGroupsForMenu();
  const parts = [
    ...users.map((u) => `${u.yemot_extension} = ${u.label}`),
    ...groups.map((g) => `${g.yemot_extension} = ${g.name}`),
  ];
  return `כדי לשלוח הודעה, כתבו קודם את הקוד של הנמען ואז רווח והטקסט. הקודים: ${parts.join(', ')}. לדוגמה: "1 שלום!"`;
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sendTwiML(res, text) {
  res.type('text/xml').send(`<Response><Message>${escapeXml(text)}</Message></Response>`);
}

router.post('/', async (req, res) => {
  // ה-URL המלא ששימש לחתימה חייב להיות בדיוק זה שTwilio קרא אליו (כולל https, כפי שמוגדר
  // בקונסולת Twilio) - Render שם את req מאחורי proxy, לכן בונים מ-x-forwarded-proto/host
  const protocol = req.header('x-forwarded-proto') || req.protocol;
  const url = `${protocol}://${req.get('host')}${req.originalUrl}`;

  if (!verifyTwilioSignature(url, req.body, req.header('x-twilio-signature'))) {
    console.error('[whatsapp] חתימת webhook לא תקינה - הבקשה נדחתה');
    return res.sendStatus(403);
  }

  const fromPhone = String(req.body.From || '').replace(/^whatsapp:/, '');
  const body = String(req.body.Body || '').trim();

  const sender = findByPhoneSuffix(fromPhone);
  if (!sender) {
    console.error(`[whatsapp] הודעה ממספר לא מזוהה: ${fromPhone}`);
    return sendTwiML(res, 'המספר שלך לא רשום במערכת.');
  }

  const [codeToken, ...rest] = body.split(/\s+/);
  const text = rest.join(' ');
  const recipientUser = text ? findByYemotExtension(codeToken) : null;
  const recipientGroup = text ? findGroupByYemotExtension(codeToken) : null;

  try {
    if (recipientUser && recipientUser.id !== sender.id) {
      await deliverMessage(sender, recipientUser, text);
      return sendTwiML(res, `ההודעה נשלחה ל${recipientUser.label || recipientUser.username}.`);
    }
    if (recipientGroup) {
      const members = listGroupMembersExcept(recipientGroup.id, sender.id);
      await deliverGroupMessage(sender, recipientGroup, text, members);
      return sendTwiML(res, `ההודעה נשלחה לקבוצת ${recipientGroup.name}.`);
    }
    sendTwiML(res, buildUsageHint());
  } catch (err) {
    console.error('[whatsapp] טיפול בהודעה נכנסת נכשל:', err.message);
    sendTwiML(res, 'שליחת ההודעה נכשלה, נסה שוב מאוחר יותר.');
  }
});

module.exports = router;
