// Example ESM function using Replicate. Requires REPLICATE_API_TOKEN env var.
import Replicate from "replicate";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

export default async function handler(event) {
  try {
    const input = event.body ? JSON.parse(event.body) : {};
    const prompt = input?.prompt ?? "a realistic fire scene (placeholder)";

    // Example: Stable Diffusion XL (update to your preferred model/version)
    // Check Replicate for current version IDs.
    const output = await replicate.run(
      "stability-ai/sdxl:abf5a9d8f0f21c22dbacb0d7f8b5f08bfc4f6d6a830a0d2f9e9f33a7c3ac5c24",
      { input: { prompt } }
    );

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, output })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
}
