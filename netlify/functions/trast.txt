// ai-image.js
// Netlify Function: SDXL img2img with dynamic version fetch + Firebase bucket upload for dataUrl
import { json } from "./_response.js";
import Replicate from "replicate";
import admin from "firebase-admin";

// --------- Firebase Admin (server-side upload for dataUrl) ----------
if (!admin.apps.length) {
  // Uses Application Default Credentials. On Netlify, provide a service account via env/secret if needed.
  // Also requires FIREBASE_STORAGE_BUCKET env var (e.g., "dailyquiz-d5279.appspot.com").
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
  });
}
const bucket = admin.storage().bucket();

// --------- Replicate client ----------
const replicate = process.env.REPLICATE_API_TOKEN
  ? new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  : null;

// Hardcode the model owner/name; we resolve the version dynamically each invocation.
const SDXL_MODEL = "stability-ai/sdxl";

// Fetch the latest model version id so we can call owner/name:version
async function getLatestVersionId(owner, name, token) {
  const res = await fetch(`https://api.replicate.com/v1/models/${owner}/${name}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Failed to fetch model version (${res.status}): ${text}`);
  }
  const data = JSON.parse(text);
  const id = data?.latest_version?.id;
  if (!id) throw new Error(`No latest_version.id for ${owner}/${name}`);
  return id;
}

// Normalize Replicate output (commonly an array of URLs) to a single URL string
function normalizeOutput(output) {
  if (Array.isArray(output) && output.length) return String(output[0]);
  if (typeof output === "string") return output;
  if (output?.output && Array.isArray(output.output) && output.output.length) {
    return String(output.output[0]);
  }
  throw new Error("No image URL returned from Replicate output");
}

// Upload a data URL ("data:image/png;base64,...") to your Firebase Storage bucket and return a public URL
async function uploadDataUrlToStorage(dataUrl) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/i.exec(dataUrl || "");
  if (!m) throw new Error("Invalid dataUrl (expected 'data:image/...;base64,....').");
  const contentType = m[1];
  const base64 = m[2];
  const buffer = Buffer.from(base64, "base64");
  const filename = `composites/${Date.now()}.png`;
  const file = bucket.file(filename);
  // Public read; if your bucket isn't public, swap for a signed URL flow.
  await file.save(buffer, { contentType, public: true, resumable: false, validation: false });
  return `https://storage.googleapis.com/${bucket.name}/${filename}`;
}

export default async function handler(request) {
  try {
    if (request.method !== "POST") {
      return json(
        {
          ok: false,
          error: "Use POST with JSON body.",
          example: { guideUrl: "https://...", strength: 0.35, prompt: "..." }
        },
        405
      );
    }

    if (!replicate) throw new Error("Missing REPLICATE_API_TOKEN");
    if (!process.env.FIREBASE_STORAGE_BUCKET) throw new Error("Missing FIREBASE_STORAGE_BUCKET");

    // Accept application/json (be forgiving if header is missing but body parses)
    let body = {};
    try {
      body = await request.json();
    } catch {
      return json(
        {
          ok: false,
          error: "Missing or invalid JSON body. Set header: Content-Type: application/json"
        },
        400
      );
    }

    // Input handling: either guideUrl (public URL) OR dataUrl (base64)
    let guideUrl = body.guideUrl || body.imageUrl || body.compositeUrl || null;
    const dataUrl = body.dataUrl || null;

    if (!guideUrl && !dataUrl) {
      return json(
        {
          ok: false,
          error: "Provide either guideUrl (public image URL) or dataUrl (canvas output)."
        },
        400
      );
    }

    if (!guideUrl && dataUrl) {
      // Upload the dataUrl to your Firebase bucket and use that URL as the guide image
      guideUrl = await uploadDataUrlToStorage(dataUrl);
    }

    // Map your UI fields
    const prompt =
      (typeof body.prompt === "string" && body.prompt.trim()) ||
      "Make the scene photorealistic while preserving the guide layout.";

    // SDXL uses "prompt_strength" (0..1). We map from your "strength" input.
    // Lower values adhere more closely to the guide image.
    const prompt_strength =
      typeof body.strength === "number" ? Math.max(0, Math.min(1, body.strength)) : 0.35;

    // Optional size (SDXL defaults to square; adjust if needed)
    const width =
      typeof body.width === "number" && body.width > 0 ? Math.min(2048, body.width) : 1024;
    const height =
      typeof body.height === "number" && body.height > 0 ? Math.min(2048, body.height) : 1024;

    // Resolve the latest version ID so we don't hit "version is required"
    const [owner, name] = SDXL_MODEL.split("/");
    const version = await getLatestVersionId(owner, name, process.env.REPLICATE_API_TOKEN);

    // Build SDXL input
    const input = {
      prompt,
      image: guideUrl,
      prompt_strength,
      width,
      height
      // negative_prompt: body.negativePrompt ?? undefined,
      // scheduler / seed / num_outputs can be added if you need them and the model supports them
    };

    // Call Replicate with owner/name:version
    const output = await replicate.run(`${owner}/${name}:${version}`, { input });
    const url = normalizeOutput(output);

    return json({
      ok: true,
      image: { url, source: SDXL_MODEL },
      guideUrl,
      debug: {
        model: SDXL_MODEL,
        version,
        input: { prompt, image: guideUrl, prompt_strength, width, height }
      }
    });
  } catch (e) {
    // Improve common errors
    const msg = String(e?.message || e);
    const is422Version = /version is required|validation failed|422/.test(msg);
    const is402 = /402|payment required|insufficient credit/i.test(msg);
    const hint = is402
      ? "Replicate credit is insufficient. Add credit or switch provider."
      : is422Version
      ? "Replicate requires a model version. This function resolves the latest version automatically; check network logs for the version fetch."
      : undefined;

    return json({ ok: false, error: msg, hint }, is402 ? 402 : 500);
  }
}
