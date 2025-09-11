// functions/ai-image.js
import { json } from "./_response.js";
import Replicate from "replicate";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// Choose the model by owner/name (no version hash here)
const MODEL = "stability-ai/sdxl";  // change to the model you actually want
let MODEL_VERSION_ID = null;        // cached after first lookup

async function getLatestVersionId() {
  if (MODEL_VERSION_ID) return MODEL_VERSION_ID;
  const model = await replicate.models.get(MODEL);
  const id = model?.latest_version?.id;
  if (!id) throw new Error(`Unable to resolve latest version for ${MODEL}`);
  MODEL_VERSION_ID = id; // cache for warm invocations
  return id;
}

export default async function handler(request) {
  try {
    const body = request.method === "POST" ? await request.json() : {};
    const prompt = body?.prompt ?? "a realistic fire scene (placeholder)";

    const version = await getLatestVersionId(); // <-- no hard-coded hash
    const output = await replicate.run(`${MODEL}:${version}`, {
      input: { prompt }
    });

    return json({ ok: true, model: MODEL, version, output });
  } catch (e) {
    // Handle common Replicate 4xx nicely
    const msg = String(e?.message || e);
    const hint =
      /permission|not permitted|does not exist|invalid version/i.test(msg)
        ? `Check that your REPLICATE_API_TOKEN has access to "${MODEL}" (some models require a subscription) and that the model name is correct.`
        : undefined;

    return json({ ok: false, error: msg, hint }, 500);
  }
}
