// yemot-ivr.js - שלוחה אחת משותפת לכל המשתמשים בימות המשיח (route `/yemot`, מוגדרת פעם
// אחת בפאנל ימות - אין צורך בשלוחה נפרדת לכל משתמש). מזהה את השולח אוטומטית לפי מספר
// המתקשר (ApiPhone), ושואלת רק "למי לשלוח" בתפריט טונים דינמי לפי USERS_JSON - מקליטה
// הודעה קולית, מתמללת אותה ושולחת אותה לנמען שנבחר (ראו chat.js).
const { YemotRouter } = require('yemot-router2');
const { downloadRecording } = require('./yemot-api');
const { transcribeAudio } = require('./openai-transcribe');
const { findByYemotExtension, findByPhone, listAllForMenu } = require('./users');
const { deliverMessage } = require('./chat');

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

/** בונה הודעת תפריט "לבנימין הקש 1, לשמואל הקש 2..." מתוך כל המשתמשים הרשומים. */
function buildMenuPrompt() {
  const users = listAllForMenu();
  const parts = users.map((u) => `ל${u.label} הקש ${u.yemot_extension}`);
  return parts.join(', ');
}

async function askForRecipient(call) {
  const code = await call.read(
    [{ type: 'text', data: `למי ברצונך לשלוח הודעה? ${buildMenuPrompt()}, ולאחר מכן סולמית` }],
    'tap',
    { max_digits: 10, min_digits: 1, digits_allowed: [], typing_playback_mode: 'Digits' }
  );
  return findByYemotExtension(String(code));
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
    await deliverMessage(sender, recipient, text);
  } catch (err) {
    console.error('שגיאה בטיפול בהקלטה מימות המשיח:', err);
    return call.id_list_message([
      { type: 'text', data: 'אירעה שגיאה בשמירת ההודעה, נסה שוב מאוחר יותר' },
    ]);
  }

  return call.id_list_message([{ type: 'text', data: 'ההודעה נשמרה בהצלחה, תודה' }]);
});

module.exports = yemotRouter;
