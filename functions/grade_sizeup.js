import { json } from "./_response.js";

export default async function handler(request, context) {
  try {
    const input = request.method === "POST" ? await request.json() : {};
    // TODO: your grading logic
    return json({ ok: true, function: "grade_sizeup", input });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
