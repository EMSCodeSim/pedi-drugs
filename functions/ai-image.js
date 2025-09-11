import { json } from "./_response.js";
import Replicate from "replicate";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// Replace the model/version with what you actually use
const SDXL = "stability-ai/sdxl:abf5a9d8f0f21c22dbacb0d7f8b5f08bfc4f6d6a830a0d2f9e9f33a7c3ac5c24";

export default async function handler(request, context) {
  try {
    const body = request.method === "POST" ? await request.json() : {};
    const prompt = body?.prompt ?? "a realistic fire scene (placeholder)";

    const output = await replicate.run(SDXL, { input: { prompt } });

    return json({ ok: true, output });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
