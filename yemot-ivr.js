// yemot-ivr.js - שלוחה אחת משותפת לכל המשתמשים בימות המשיח (route `/yemot`, מוגדרת פעם
// אחת בפאנל ימות - אין צורך בשלוחה נפרדת לכל משתמש). מזהה את השולח אוטומטית לפי מספר
// המתקשר (ApiPhone), ושואלת רק "למי לשלוח" בתפריט טונים דינמי לפי USERS_JSON + קבוצות
// (ראו groups.js) - מקליטה הודעה קולית, מתמללת אותה ושולחת אותה לנמען/לקבוצה שנבחרו
// (ראו chat.js).
// route `/yemot/tzintuk` (שלוחת API נפרדת, מוגדרת פעם אחת בפאנל) - יוצרת אוטומטית שלוחת
// tzintuk אישית למי שמתקשר (אם עוד אין לו), ומעבירה אותו אליה (go_to_folder) כדי שיירשם.
const { YemotRouter } = require('yemot-router2');
const { downloadRecording, provisionTzintukExtension } = require('./yemot-api');
const { backupToYemot } = require('./backup');
const { transcribeAudio } = require('./openai-transcribe');
const {
  findByYemotExtension,
  findByPhone,
  listAllForMenu,
  tzintukExtensionFor,
  setTzintukList,
} = require('./users');
const { findGroupByYemotExtension, listGroupsForMenu, listGroupMembersExcept } = require('./groups');
const { deliverMessage, deliverGroupMessage } = require('./chat');

const yemotRouter = YemotRouter({
  printLog: true,
  // בלי זה, שגיאה בתוך שיחה מפילה את כל השרת (וכל שיחה אחרת/בקשה אחרת שנופלת יחד איתה
  // בזמן שRender מרים אותו מחדש) - והמתקשר שומע "אין מענה בשרת API"
  uncaughtErrorHandler: (error, call) => {
    console.error('שגיאה לא צפויה בטיפול בשיחה מימות המשיח:', error);
    call.id_list_message([
      { type: 'text', data: 'אירעה שגיאה, נסה שוב מאוחר יותר' },
    ]);
  },
});

/** בונה הודעת תפריט "לבנימין הקש 1, לשמואל הקש 2..., לכולם הקש 9" ממשתמשים+קבוצות. */
function buildMenuPrompt() {
  const users = listAllForMenu();
  const groups = listGroupsForMenu();
  const parts = [
    ...users.map((u) => `ל${u.label} הקש ${u.yemot_extension}`),
    ...groups.map((g) => `ל${g.name} הקש ${g.yemot_extension}`),
  ];
  return parts.join(', ');
}

/** מחזיר { type: 'user', record } או { type: 'group', record } לפי מה שהוקש, או null אם לא נמצא. */
async function askForRecipient(call) {
  const code = await call.read(
    [{ type: 'text', data: `למי ברצונך לשלוח הודעה? ${buildMenuPrompt()}, ולאחר מכן סולמית` }],
    'tap',
    { max_digits: 10, min_digits: 1, digits_allowed: [], typing_playback_mode: 'Digits' }
  );

  const user = findByYemotExtension(String(code));
  if (user) return { type: 'user', record: user };

  const group = findGroupByYemotExtension(String(code));
  if (group) return { type: 'group', record: group };

  return null;
}

async function transcribeRecording(filePath) {
  const audioBuffer = await downloadRecording(filePath);
  try {
    return (await transcribeAudio(audioBuffer, 'audio/wav'))?.trim() || null;
  } catch (err) {
    console.error('תמלול נכשל:', err.message);
    return null;
  }
}

yemotRouter.get('/', async (call) => {
  // הערה: שם השדה של מספר המתקשר לא מתועד באופן חד-משמעי. printLog: true ידפיס ללוגים
  // של Render את כל values שמגיעות מימות - כדאי לבדוק שם בשיחת בדיקה ראשונה ולעדכן אם צריך.
  const callerPhone = call.ApiPhone || call.values?.ApiPhone || null;
  const sender = callerPhone ? findByPhone(callerPhone) : null;
  if (!sender) {
    console.error(`שיחה ממספר לא מזוהה כמשתמש: ${callerPhone}`);
    return call.id_list_message([{ type: 'text', data: 'המספר שלך לא מזוהה במערכת, נסה שוב מאוחר יותר' }]);
  }

  const recipient = await askForRecipient(call);
  if (!recipient) {
    return call.id_list_message([{ type: 'text', data: 'קוד לא נמצא, נסה שוב מאוחר יותר' }]);
  }

  const filePath = await call.read(
    [
      {
        type: 'text',
        data: 'אחרי הצפצוף, הקלט את ההודעה שלך, לחץ סולמית לסיום ההקלטה',
      },
    ],
    'record',
    {
      max_length: '120', // 2 דקות מקסימום
    }
  );

  try {
    // מתמללים ומשליכים את בייטי האודיו - לא שומרים הקלטה, רק טקסט
    const transcript = await transcribeRecording(filePath);
    const text = transcript || `התקבלה הודעה קולית מ-${sender.phone}, אך התמלול נכשל`;

    if (recipient.type === 'group') {
      const members = listGroupMembersExcept(recipient.record.id, sender.id);
      await deliverGroupMessage(sender, recipient.record, text, members);
    } else {
      await deliverMessage(sender, recipient.record, text);
    }
  } catch (err) {
    console.error('שגיאה בטיפול בהקלטה מימות המשיח:', err);
    return call.id_list_message([
      { type: 'text', data: 'אירעה שגיאה בשמירת ההודעה, נסה שוב מאוחר יותר' },
    ]);
  }

  return call.id_list_message([{ type: 'text', data: 'ההודעה נשמרה בהצלחה, תודה' }]);
});

// שלוחת רישום לצינתוקים - יוצרת אוטומטית שלוחת tzintuk אישית למי שמתקשר (בפעם הראשונה
// בלבד - בפעמים הבאות פשוט מעבירה אליה, שם ימות עצמה מציעה תפריט "הוספה/הסרה מהרשימה").
yemotRouter.get('/tzintuk', async (call) => {
  const callerPhone = call.ApiPhone || call.values?.ApiPhone || null;
  const user = callerPhone ? findByPhone(callerPhone) : null;
  if (!user) {
    console.error(`שיחה לרישום צינתוק ממספר לא מזוהה כמשתמש: ${callerPhone}`);
    return call.id_list_message([{ type: 'text', data: 'המספר שלך לא מזוהה במערכת, נסה שוב מאוחר יותר' }]);
  }

  const extensionPath = tzintukExtensionFor(user);
  if (!user.tzintuk_list) {
    try {
      await provisionTzintukExtension(extensionPath, extensionPath);
      setTzintukList(user.id, extensionPath);
      user.tzintuk_list = extensionPath;
      await backupToYemot(user); // שומר את הרישום מיד לגיבוי בימות, כדי שלא יאבד ב-redeploy הבא
      console.log(`נוצרה שלוחת צינתוק חדשה עבור ${user.username} (${user.phone}): tzintukList=${extensionPath}`);
    } catch (err) {
      console.error(`יצירת שלוחת צינתוק ל-${user.username} נכשלה:`, err.message);
      return call.id_list_message([{ type: 'text', data: 'אירעה שגיאה ביצירת הרישום, נסה שוב מאוחר יותר' }]);
    }
  } else {
    console.log(`${user.username} (${user.phone}) כבר רשום עם tzintukList=${user.tzintuk_list}`);
  }

  return call.go_to_folder(`/${extensionPath}`);
});

module.exports = yemotRouter;
