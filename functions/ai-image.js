// functions/ai-image.js
import { json } from "./_response.js";
import Replicate from "replicate";
import admin from "firebase-admin";

// ---------- CORS ----------
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": CORS_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ---------- Firebase Admin ----------
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET, // e.g., "dailyquiz-d5279.appspot.com"
  });
}
const bucket = admin.storage().bucket();

// ---------- Replicate ----------
const replicate = process.env.REPLICATE_API_TOKEN
  ? new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  : null;

const SDXL_MODEL = "stability-ai/sdxl";

async function getLatestVersionId(owner, name, token) {
  const res = await fetch(`https://api.replicate.com/v1/models/${owner}/${name}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Failed to fetch model version (${res.status}): ${text}`);
  const data = JSON.parse(text);
  const id = data?.latest_version?.id;
  if (!id) throw new Error(`No latest_version.id for ${owner}/${name}`);
  return id;
}

function normalizeOutput(output) {
  if (Array.isArray(output) && output.length) return String(output[0]);
  if (typeof output === "string") return output;
  if (output?.output && Array.isArray(output.output) && output.output.length) {
    return String(output.output[0]);
  }
  throw new Error("No image URL returned from Replicate output");
}

async function uploadDataUrlToStorage(dataUrl) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/i.exec(dataUrl || "");
  if (!m) throw new Error("Invalid dataUrl (expected 'data:image/...;base64,....').");
  const contentType = m[1];
  const base64 = m[2];
  const buffer = Buffer.from(base64, "base64");
  const filename = `composites/${Date.now()}.png`;
  const file = bucket.file(filename);
  await file.save(buffer, { contentType, public: true, resumable: false, validation: false });
  return `https://storage.googleapis.com/${bucket.name}/${filename}`;
}

export default async function handler(request) {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    if (request.method !== "POST") {
      return json(
        { ok: false, error: "Use POST with JSON body.", example: { guideUrl: "https://...", prompt: "...", strength: 0.35 } },
        405,
        CORS_HEADERS
      );
    }

    if (!replicate) throw new Error("Missing REPLICATE_API_TOKEN");
    if (!process.env.FIREBASE_STORAGE_BUCKET) throw new Error("Missing FIREBASE_STORAGE_BUCKET");

    let body = {};
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid or missing JSON body. Use Content-Type: application/json." }, 400, CORS_HEADERS);
    }

    let guideUrl = body.guideUrl || body.imageUrl || body.compositeUrl || null;
    const dataUrl = body.dataUrl || null;

    if (!guideUrl && !dataUrl) {
      return json(
        { ok: false, error: "Provide either guideUrl (public URL) or dataUrl (base64 canvas output).", receivedKeys: Object.keys(body || {}) },
        400,
        CORS_HEADERS
      );
    }

    if (!guideUrl && dataUrl) {
      guideUrl = await uploadDataUrlToStorage(dataUrl);
    }

    const prompt =
      (typeof body.prompt === "string" && body.prompt.trim()) ||
      "Make the scene photorealistic while preserving the guide layout.";

    const prompt_strength = typeof body.strength === "number" ? Math.max(0, Math.min(1, body.strength)) : 0.35;
    const width  = typeof body.width  === "number" && body.width  > 0 ? Math.min(2048, body.width)  : 1024;
    const height = typeof body.height === "number" && body.height > 0 ? Math.min(2048, body.height) : 1024;

    const [owner, name] = SDXL_MODEL.split("/");
    const version = await getLatestVersionId(owner, name, process.env.REPLICATE_API_TOKEN);

    const input = { prompt, image: guideUrl, prompt_strength, width, height };
    const output = await replicate.run(`${owner}/${name}:${version}`, { input });
    const url = normalizeOutput(output);

    return json(
      { ok: true, image: { url, source: SDXL_MODEL }, guideUrl, debug: { model: SDXL_MODEL, version, input } },
      200,
      CORS_HEADERS
    );
  } catch (e) {
    const msg = String(e?.message || e);
    const is402 = /402|payment required|insufficient credit/i.test(msg);
    const is422 = /version is required|validation failed|422/.test(msg);
    return json(
      {
        ok: false,
        error: msg,
        hint: is402
          ? "Replicate credit is insufficient."
          : is422
          ? "Replicate requires a model version. This function fetches it dynamically; check logs if it persists."
          : undefined
      },
      is402 ? 402 : 500,
      CORS_HEADERS
    );
  }
}
