import { json } from "./_response.js";

export default async function handler(request, context) {
  try {
    const payload = request.method === "POST" ? await request.json() : {};
    // TODO: implement generic grading
    return json({ ok: true, function: "grade", payload });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
