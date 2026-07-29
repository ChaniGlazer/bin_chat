// openai-transcribe.js - תמלול הקלטות באמצעות OpenAI (whisper-1 / gpt-4o-mini-transcribe)
const MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';

/**
 * שולח קובץ שמע ל-OpenAI ומחזיר את הטקסט המתומלל.
 * במקרה של כישלון (מפתח חסר, שגיאת רשת וכו') זורק שגיאה - הקורא אחראי להחליט
 * מה לעשות (למשל: לשמור את ההקלטה בלי טקסט מתומלל).
 */
async function transcribeAudio(audioBuffer, mimeType = 'audio/wav') {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('חסר OPENAI_API_KEY ב-.env');
  }

  const extension = mimeType === 'audio/wav' ? 'wav' : 'mp3';
  const blob = new Blob([audioBuffer], { type: mimeType });

  const form = new FormData();
  form.append('file', blob, `recording.${extension}`);
  form.append('model', MODEL);
  form.append('language', 'he'); // רמז לעברית - משפר דיוק, המודל עדיין מזהה שפות אחרות

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI transcription נכשל (HTTP ${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.text?.trim() || '';
}

module.exports = { transcribeAudio };
