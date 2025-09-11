// Example ESM function using OpenAI. Requires OPENAI_API_KEY env var.
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(event) {
  try {
    const input = event.body ? JSON.parse(event.body) : {};
    const prompt = input?.prompt ?? "Say hello from Netlify Functions.";

    // Use a small/cheap model if you want:
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        text: resp.choices?.[0]?.message?.content ?? ""
      })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
}
