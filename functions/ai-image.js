import { json } from "./_response.js";
import Replicate from "replicate";
import admin from "firebase-admin";

// ---------- Firebase Admin: upload composite dataUrl to bucket ----------
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET // Example: "dailyquiz-d5279.appspot.com"
  });
}
const bucket = admin.storage().bucket();

// ---------- Replicate Setup ----------
const replicate = process.env.REPLICATE_API_TOKEN
  ? new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  : null;

// Stability AI SDXL model on Replicate
const SDXL_MODEL = "stability-ai/sdxl";

async function getLatestVersion(owner, name, token) {
  const res = await fetch(`https://api.replicate.com/v1/models/${owner}/${name}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Failed to fetch model info: ${text}`);
  const data = JSON.parse(text);
  const id = data?.latest_version?.id;
  if (!id) throw new Error(`No latest version ID for ${owner}/${name}`);
  return id;
}

async function uploadDataUrlToStorage(dataUrl) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/i.exec(dataUrl || "");
  if (!m) throw new Error("Invalid dataUrl format");
  const contentType = m[1];
  const b64 = m[2];
  const buffer = Buffer.from(b64, "base64");
  const filename = `composites/${Date.now()}.png`;
  const file = bucket.file(filename);
  await file.save(buffer, { contentType, public: true, resumable: false, validation: false });
  return `https://storage.googleapis.com/${bucket.name}/${filename}`;
}

function normalizeOutput(output) {
  if (Array.isArray(output) && output.length) return output[0];
  if (typeof output === "string") return output;
  if (output?.output && Array.isArray(output.output) && output.output.length) return output.output[0];
  throw new Error("No image URL returned from SDXL");
}

// ---------- Main Handler ----------
export default async function handler(request) {
  try {
    if (request.method !== "POST") {
      return json(
        { ok: false, error: "Use POST with JSON body." },
        405
      );
    }

    if (!replicate) throw new Error("Missing REPLICATE_API_TOKEN");
    if (!process.env.FIREBASE_STORAGE_BUCKET) throw new Error("Missing FIREBASE_STORAGE_BUCKET");

    const body = await request.json().catch(() => ({}));

    let guideUrl = body.guideUrl || null;
    const dataUrl = body.dataUrl || null;

    // If only dataUrl provided, upload it to Firebase
    if (!guideUrl && dataUrl) {
      guideUrl = await uploadDataUrlToStorage(dataUrl);
    }

    if (!guideUrl) {
      return json(
        { ok: false, error: "Provide either guideUrl (public image URL) or dataUrl (canvas output)." },
        400
      );
    }

    const prompt = body.prompt ?? "Make the scene photorealistic while keeping layout";
    const prompt_strength = typeof body.strength === "number" ? Math.max(0, Math.min(1, body.strength)) : 0.35;

    // Prepare SDXL input
    const input = {
      prompt,
      image: guideUrl,
      prompt_strength,   // SDXL parameter
      width: body.width || 1024,
      height: body.height || 1024
    };

    // Get latest version for stability-ai/sdxl
    const [owner, name] = SDXL_MODEL.split("/");
    const version = await getLatestVersion(owner, name, process.env.REPLICATE_API_TOKEN);

    // Run Replicate with SDXL
    const output = await replicate.run(`${owner}/${name}:${version}`, { input });
    const url = normalizeOutput(output);

    return json({
      ok: true,
      image: { url, source: "stability-ai/sdxl" },
      guideUrl,
      debug: { model: SDXL_MODEL, version, input }
    });
  } catch (e) {
    const msg = String(e?.message || e);
    return json({ ok: false, error: msg }, 500);
  }
}
