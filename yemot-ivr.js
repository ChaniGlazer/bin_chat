// yemot-ivr.js - השלוחה שמקבלת שיחות מימות המשיח (מודול API), מקליטה הודעה קולית,
// מתמללת אותה ושומרת רק את הטקסט (ההקלטה עצמה לא נשמרת)
const { YemotRouter } = require('yemot-router2');
const db = require('./db');
const { downloadRecording } = require('./yemot-api');
const { transcribeAudio } = require('./openai-transcribe');
const { sendPushToAll } = require('./webpush');

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

async function handleRecording(filePath, phone) {
  const audioBuffer = await downloadRecording(filePath);

  // מתמללים ומשליכים את בייטי האודיו - לא שומרים הקלטה, רק טקסט
  let transcript = null;
  try {
    transcript = await transcribeAudio(audioBuffer, 'audio/wav');
  } catch (err) {
    console.error('תמלול נכשל:', err.message);
  }

  const text = transcript?.trim()
    ? transcript.trim()
    : phone
      ? `התקבלה הודעה קולית מ-${phone}, אך התמלול נכשל`
      : 'התקבלה הודעה קולית, אך התמלול נכשל';

  db.prepare('INSERT INTO messages (text, from_phone) VALUES (?, ?)').run(text, phone || null);

  const rows = db.prepare('SELECT subscription_json FROM subscriptions').all();
  const subscriptions = rows.map((r) => JSON.parse(r.subscription_json));
  if (subscriptions.length) {
    await sendPushToAll(subscriptions, text);
  }
}

yemotRouter.get('/', async (call) => {
  // הערה: שם השדה של מספר המתקשר לא מתועד באופן חד-משמעי.
  // printLog: true ידפיס ללוגים של Render את כל values שמגיעות מימות -
  // כדאי לבדוק שם בשיחת בדיקה ראשונה ולעדכן אם צריך.
  const callerPhone = call.ApiPhone || call.values?.ApiPhone || null;

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
    await handleRecording(filePath, callerPhone);
  } catch (err) {
    console.error('שגיאה בטיפול בהקלטה מימות המשיח:', err);
    return call.id_list_message([
      { type: 'text', data: 'אירעה שגיאה בשמירת ההודעה, נסה שוב מאוחר יותר' },
    ]);
  }

  return call.id_list_message([{ type: 'text', data: 'ההודעה נשמרה בהצלחה, תודה' }]);
});

module.exports = yemotRouter;
