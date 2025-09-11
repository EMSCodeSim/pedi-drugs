// Minimal stub; replace with your real transcription logic or OpenAI Whisper call.
export default async function handler(event) {
  try {
    // TODO: parse file from event, run transcription
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, function: "transcribe", note: "stub" })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
}
