// functions/ai-image.js
// Netlify Function for Replicate SDXL image-to-image
// - Supports guideUrl (public image URL) OR dataUrl (base64 canvas output)
// - Automatically fetches latest SDXL version to prevent 422 errors

import { json } from "./_response.js";
import Replicate from "replicate";
import admin from "firebase-admin";

// ---------- Firebase Admin Setup ----------
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET // e.g., "dailyquiz-d5279.appspot.com"
  });
}
const bucket = admin.storage().bucket();

// ---------- Replicate Setup ----------
const replicate = process.env.REPLICATE_API_TOKEN
  ? new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  : null;

// Hard-coded base model name
const SDXL_MODEL = "stability-ai/sdxl";

// Fetch latest model version from Replicate dynamically
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
  if (!id) throw new Error(`No latest_version.id found for ${owner}/${name}`);
  return id;
}

// Normalize Replicate output to a single URL
function normalizeOutput(output) {
  if (Array.isArray(output) && output.length) return String(output[0]);
  if (typeof output === "string") return output;
  if (output?.output && Array.isArray(output.output) && output.output.length) {
    return String(output.output[0]);
  }
  throw new Error("No image URL returned from Replicate output");
}

// Upload a base64 data URL to Firebase Storage and return its public URL
async function uploadDataUrlToStorage(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/i.exec(dataUrl || "");
  if (!match) throw new Error("Invalid dataUrl format (expected 'data:image/...;base64,....').");

  const contentType = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");
  const filename = `composites/${Date.now()}.png`;

  const file = bucket.file(filename);
  await file.save(buffer, { contentType, public: true, resumable: false, validation: false });
  return `https://storage.googleapis.com/${bucket.name}/${filename}`;
}

// ---------- Handler ----------
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

    if (!replicate) throw new Error("Missing REPLICATE_API_TOKEN environment variable");
    if (!process.env.FIREBASE_STORAGE_BUCKET) {
      throw new Error("Missing FIREBASE_STORAGE_BUCKET environment variable");
    }

    // Parse JSON body
    let body = {};
    try {
      body = await request.json();
    } catch {
      return json(
        { ok: false, error: "Invalid or missing JSON body. Use Content-Type: application/json." },
        400
      );
    }

    // Either a guideUrl or a dataUrl must be provided
    let guideUrl = body.guideUrl || body.imageUrl || null;
    const dataUrl = body.dataUrl || null;

    if (!guideUrl && !dataUrl) {
      return json(
        {
          ok: false,
          error: "Provide either guideUrl (public URL) or dataUrl (base64 canvas output)."
        },
        400
      );
    }

    // If dataUrl was provided, upload it to Firebase and use that URL as the guide
    if (!guideUrl && dataUrl) {
      guideUrl = await uploadDataUrlToStorage(dataUrl);
    }

    const prompt =
      (typeof body.prompt === "string" && body.prompt.trim()) ||
      "Make the scene photorealistic while preserving layout.";

    // SDXL uses prompt_strength (0..1). Lower = follow guide image more closely.
    const prompt_strength =
      typeof body.strength === "number" ? Math.max(0, Math.min(1, body.strength)) : 0.35;

    const width =
      typeof body.width === "number" && body.width > 0 ? Math.min(2048, body.width) : 1024;
    const height =
      typeof body.height === "number" && body.height > 0 ? Math.min(2048, body.height) : 1024;

    // Fetch the latest SDXL version to prevent 422 errors
    const [owner, name] = SDXL_MODEL.split("/");
    const version = await getLatestVersionId(owner, name, process.env.REPLICATE_API_TOKEN);

    // Build the input payload for SDXL
    const input = {
      prompt,
      image: guideUrl,
      prompt_strength,
      width,
      height
    };

    // Call Replicate
    const output = await replicate.run(`${owner}/${name}:${version}`, { input });
    const resultUrl = normalizeOutput(output);

    return json({
      ok: true,
      image: { url: resultUrl, source: SDXL_MODEL },
      guideUrl,
      debug: {
        model: SDXL_MODEL,
        version,
        input
      }
    });
  } catch (e) {
    const msg = String(e?.message || e);
    const is422 = /version is required|422/i.test(msg);
    const is402 = /402|payment required|insufficient credit/i.test(msg);

    return json(
      {
        ok: false,
        error: msg,
        hint: is402
          ? "Your Replicate account is out of credits. Add credits or use a free model."
          : is422
          ? "The Replicate model version was missing. This function fetches it dynamically; check network logs if the error persists."
          : undefined
      },
      is402 ? 402 : 500
    );
  }
}
