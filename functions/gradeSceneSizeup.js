import { json } from "./_response.js";

export default async function handler(request, context) {
  try {
    const payload = request.method === "POST" ? await request.json() : {};
    // TODO: implement scene size-up grading
    return json({ ok: true, function: "gradeSceneSizeup", payload });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
