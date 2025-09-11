// functions/ai-image.js
import { json } from "./_response.js";
import Replicate from "replicate";

const replicate = process.env.REPLICATE_API_TOKEN
  ? new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  : null;

// Use an img2img-capable model you have access to
const REPLICATE_MODEL = process.env.REPLICATE_MODEL || "stability-ai/sdxl-turbo";

function splitModel(full) {
  const [owner, name] = String(full || "").split("/");
  if (!owner || !name) throw new Error(`MODEL must be "owner/name", got "${full}"`);
  return { owner, name };
}

async function getLatestReplicateVersion(owner, name, token) {
  const res = await fetch(`https://api.replicate.com/v1/models/${owner}/${name}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Replicate model lookup failed (${res.status}): ${txt}`);
  const data = JSON.parse(txt);
  const id = data?.latest_version?.id;
  if (!id) throw new Error(`No latest_version.id for ${owner}/${name}`);
  return id;
}

function normalizeOutput(output) {
  if (Array.isArray(output) && output.length) return String(output[0]);
  if (typeof output === "string") return output;
  if (output?.output && Array.isArray(output.output) && output.output.length) return String(output.output[0]);
  throw new Error("No image URL in Replicate output");
}

export default async function handler(request) {
  try {
    if (!replicate) throw new Error("Missing REPLICATE_API_TOKEN");

    const body = request.method === "POST" ? await request.json() : {};
    const prompt   = body?.prompt ?? "enhance realism; keep scene layout from guide";
    const guideUrl = body?.guideUrl;
    if (!guideUrl) {
      return json({ ok: false, error: "Missing guideUrl (public URL for your composited PNG)." }, 400);
    }

    const strength = typeof body?.strength === "number" ? Math.max(0, Math.min(1, body.strength)) : 0.35;

    // Many SDXL forks accept these keys for img2img:
    const input = {
      prompt,
      image: guideUrl,
      strength
      // you can add: negative_prompt, num_outputs, seed, etc. if your chosen model supports them
    };

    const { owner, name } = splitModel(REPLICATE_MODEL);
    const version = await getLatestReplicateVersion(owner, name, process.env.REPLICATE_API_TOKEN);
    const output  = await replicate.run(`${owner}/${name}:${version}`, { input });
    const url     = normalizeOutput(output);

    return json({ ok: true, image: { url, source: "replicate" }, debug: { model: `${owner}/${name}`, version } });
  } catch (e) {
    const msg  = String(e?.message || e);
    const is402 = /402|payment required|insufficient credit/i.test(msg);
    return json(
      { ok: false, error: msg, hint: is402 ? "Add Replicate credit or switch model." : "Ensure model supports img2img and guideUrl is public." },
      is402 ? 402 : 500
    );
  }
}
