// yemot-ivr.js - השלוחה שמקבלת שיחות מימות המשיח (מודול API), מקליטה הודעה קולית,
// מתמללת אותה ושולחת אותה לנמען שנבחר בטונים (ראו chat.js). כתובת ה-API של כל משתמש
// צריכה להצביע ל-<כתובת-השרת>/yemot/<username> (ראו users.js) - כך יודעים מי השולח.
const { YemotRouter } = require('yemot-router2');
const { downloadRecording } = require('./yemot-api');
const { transcribeAudio } = require('./openai-transcribe');
const { findByUsername, findByYemotExtension } = require('./users');
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

async function transcribeRecording(filePath) {
  const audioBuffer = await downloadRecording(filePath);
  try {
    return (await transcribeAudio(audioBuffer, 'audio/wav'))?.trim() || null;
  } catch (err) {
    console.error('תמלול נכשל:', err.message);
    return null;
  }
}

yemotRouter.get('/:username', async (call) => {
  const sender = findByUsername(call.req.params.username);
  if (!sender) {
    console.error(`שיחה מימות המשיח לשם משתמש לא מוכר: ${call.req.params.username}`);
    return call.id_list_message([{ type: 'text', data: 'שלוחה לא מוגדרת, נסה שוב מאוחר יותר' }]);
  }

  // מבקשים את מספר השלוחה (yemotExtension) של מי שרוצים לשלוח לו הודעה
  const recipientExtension = await call.read(
    [{ type: 'text', data: 'הקש את מספר השלוחה של מי שברצונך לשלוח לו הודעה, ולאחריו סולמית' }],
    'tap',
    { max_digits: 10, min_digits: 1, digits_allowed: [], typing_playback_mode: 'Digits' }
  );

  const recipient = findByYemotExtension(String(recipientExtension));
  if (!recipient) {
    return call.id_list_message([{ type: 'text', data: 'שלוחה לא נמצאה, נסה שוב מאוחר יותר' }]);
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
