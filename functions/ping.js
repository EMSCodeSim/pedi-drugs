import { json } from "./_response.js";

export default async function handler(request, context) {
  return json({ ok: true, ts: Date.now() });
}
