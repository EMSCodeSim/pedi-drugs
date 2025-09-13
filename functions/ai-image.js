// functions/ai-image.js — Netlify Function (CommonJS)
// Accepts { dataUrl, prompt, strength } (also image/guideURL/url/etc).
// 1) Uploads dataUrl → Firebase Storage (HTTP URL)
// 2) Calls Replicate Predictions API (version from env)
// 3) Polls to completion
// 4) Returns { ok:true, image:{ url:<http> } } so your client can do data.image.url

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-AI-Ping",
  "Access-Control-Max-Age": "86400",
};

function reply200(obj) {
  return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

const ONE_BY_ONE_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";

const REPLICATE_URL = "https://api.replicate.com/v1/predictions";
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || "";
const MODEL_VERSION = process.env.REPLICATE_MODEL_VERSION || ""; // e.g. "...:abcdef1234"
const FB_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "";
const FB_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || "";
const FB_PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const FB_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || ""; // e.g. "dailyquiz-d5279.appspot.com"

let admin; // lazy init firebase-admin

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dataUrlToBuffer(dataUrl) {
  const [, meta, b64] = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/) || [];
  if (!b64) return null;
  return { contentType: meta || "application/octet-stream", buffer: Buffer.from(b64, "base64") };
}

async function ensureFirebase() {
  if (admin) return admin;
  // Only init if creds are present.
  if (!FB_PROJECT_ID || !FB_CLIENT_EMAIL || !FB_PRIVATE_KEY || !FB_BUCKET) {
    throw new Error("Firebase env not set (FIREBASE_*).");
  }
  admin = require("firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        project_id: FB_PROJECT_ID,
        client_email: FB_CLIENT_EMAIL,
        private_key: FB_PRIVATE_KEY,
      }),
      storageBucket: FB_BUCKET,
    });
  }
  return admin;
}

function firebaseDownloadURL(bucketName, path, token) {
  // v0 download URL (works with token set in metadata)
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

async function uploadDataUrlToFirebase(dataUrl) {
  await ensureFirebase();
  const { buffer, contentType } = dataUrlToBuffer(dataUrl) || {};
  if (!buffer) throw new Error("Invalid dataUrl");
  const { v4: uuidv4 } = require("uuid");
  const fname = `uploads/${Date.now()}_${Math.random().toString(36).slice(2)}.${contentType.includes("png") ? "png" : "jpg"}`;
  const token = uuidv4();
  const bucket = admin.storage().bucket();
  const file = bucket.file(fname);
  await file.save(buffer, {
    contentType,
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
    public: false, // rely on tokened URL
    resumable: false,
    validation: false,
  });
  return firebaseDownloadURL(bucket.name, fname, token);
}

async function callReplicate({ imageUrl, prompt, strength }) {
  if (!REPLICATE_TOKEN || !MODEL_VERSION) {
    return {
      ok: false,
      error: "Server missing Replicate config",
      need: { REPLICATE_API_TOKEN: !!REPLICATE_TOKEN, REPLICATE_MODEL_VERSION: !!MODEL_VERSION },
    };
  }

  // clamp 0..1
  strength = Number(strength);
  if (!Number.isFinite(strength)) strength = 0.35;
  if (strength < 0) strength = 0;
  if (strength > 1) strength = 1;

  const payload = {
    version: MODEL_VERSION,
    input: { prompt: String(prompt || ""), image: imageUrl, strength },
  };

  const createRes = await fetch(REPLICATE_URL, {
    method: "POST",
    headers: { Authorization: `Token ${REPLICATE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const createText = await createRes.text();
  let created = {};
  try { created = JSON.parse(createText); } catch {}
  if (!createRes.ok || !created.id) {
    return { ok: false, error: "Replicate create failed", status: createRes.status, details: created || createText };
  }

  const id = created.id;
  let final = created;
  for (let i = 0; i < 120; i++) { // ~2 minutes
    const getRes = await fetch(`${REPLICATE_URL}/${id}`, { headers: { Authorization: `Token ${REPLICATE_TOKEN}` } });
    const getText = await getRes.text();
    try { final = JSON.parse(getText); } catch { final = { status: "unknown" }; }
    if (final.status === "succeeded" || final.status === "failed" || final.status === "canceled") break;
    await sleep(1000);
  }

  let outUrl = null;
  const out = final && final.output;
  if (typeof out === "string" && out.startsWith("http")) outUrl = out;
  else if (Array.isArray(out)) {
    const first = out.find((x) => typeof x === "string" && x.startsWith("http"));
    if (first) outUrl = first;
  }

  if (final.status !== "succeeded" || !outUrl) {
    return { ok: false, error: "Replicate did not return an image URL", status: final.status, id, output: final && final.output };
  }
  return { ok: true, id, url: outUrl };
}

exports.handler = async (event) => {
  try {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS };

    // GET health
    if (event.httpMethod === "GET") {
      try {
        const url = new URL(event.rawUrl || `http://x${event.path}`);
        if (url.searchParams.get("ping")) return reply200({ ok: true, pong: true, method: "GET", t: Date.now() });
      } catch {}
      return reply200({ ok: false, error: "Use POST for AI; GET ?ping=1 for healthcheck" });
    }

    // POST only
    if (event.httpMethod !== "POST") return reply200({ ok: false, error: "Method not allowed (POST expected)" });

    // Body
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}
    const pingHeader = event.headers && (event.headers["x-ai-ping"] || event.headers["X-AI-Ping"]);
    if (pingHeader || body.ping === true) return reply200({ ok: true, pong: true, method: "POST", t: Date.now() });

    // Collect candidate image sources
    const candidates = [
      body.dataUrl, body.dataURL,
      body.image, body.image_url, body.imageURL,
      body.guideURL, body.guideUrl,
      body.input, body.src, body.reference,
      body.url, body.output, body.result, body.link, body.href
    ].filter((v) => typeof v === "string" && v.length > 0);

    let imageUrl = null;

    // Prefer direct HTTP URL if present
    const httpLike = candidates.find((s) => /^https?:\/\//i.test(s));
    if (httpLike) imageUrl = httpLike;

    // Else, upload dataUrl to Firebase to mint an HTTP URL
    if (!imageUrl) {
      const dataUrl = candidates.find((s) => String(s).startsWith("data:image/")) || ONE_BY_ONE_PNG;
      try {
        imageUrl = await uploadDataUrlToFirebase(dataUrl);
      } catch (e) {
        // If Firebase not configured, fall back to tiny data URL (Replicate may reject)
        imageUrl = dataUrl;
      }
    }

    const prompt = typeof body.prompt === "string" ? body.prompt : (body.notes || "");
    const strength = body.strength;

    const r = await callReplicate({ imageUrl, prompt, strength });
    if (r.ok) {
      // Match the demo's expected shape: data.image.url
      return reply200({ ok: true, image: { url: r.url }, provider: "replicate", id: r.id });
    } else {
      // Still 200 so the browser doesn't treat it as a "failed endpoint"
      return reply200({ ok: false, error: r.error || "Unknown error", details: r });
    }
  } catch (e) {
    return reply200({ ok: false, error: e?.message || String(e) });
  }
};
