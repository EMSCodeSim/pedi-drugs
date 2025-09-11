import { json } from "./_response.js";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(request, context) {
  try {
    const body = request.method === "POST" ? await request.json() : {};
    const prompt = body?.prompt ?? "Say hello from Netlify Functions.";

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });

    return json({
      ok: true,
      text: resp.choices?.[0]?.message?.content ?? ""
    });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
