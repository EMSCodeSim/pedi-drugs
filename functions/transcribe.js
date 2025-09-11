import { json } from "./_response.js";

export default async function handler(request, context) {
  try {
    // TODO: parse file from request (multipart/form-data) and run transcription
    return json({ ok: true, function: "transcribe", note: "stub" });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
