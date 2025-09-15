// netlify/functions/ai-replicate.js
// Accepts POST JSON:
// { storagePath?, imageUrl?, dataUrl?, prompt?, negativePrompt?, imageStrength? }
// - storagePath: Firebase Storage object path (private OK), e.g. "scenarios/abc/123.jpg"
// - imageUrl: public URL (NOT the googleusercontent download/storage/v1 form)
// - dataUrl: base64 "data:image/png;base64,..."
// Returns: { ok, image_url?, id?, error?, diagnostics? }

const Replicate = require("replicate");
const fs = require("fs/promises");

// ---------- Replicate config ----------
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const MODEL_VERSION =
  process.env.REPLICATE_MODEL_VERSION || "stability-ai/sdxl:7762fd07";

// ---------- Firebase Admin (optional; only if storagePath is used) ----------
let adminApp = null;
function initFirebaseAdmin() {
  if (adminApp) return adminApp;

  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON; // full JSON string
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;   // e.g. "dailyquiz-d5279.appspot.com"

  if (!saJson || !bucketName) return null;

  const admin = require("firebase-admin");
  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(saJson)),
      storageBucket: bucketName,
    });
  }
  adminApp = admin;
  return adminApp;
}

async function downloadFromFirebase(storagePath) {
  const admin = initFirebaseAdmin();
  if (!admin) {
    throw new Error("Firebase Admin not configured (set FIREBASE_SERVICE_ACCOUNT_JSON and FIREBASE_STORAGE_BUCKET).");
  }
  const [buf] = await admin.storage().bucket().file(storagePath).download();
  const ext = (storagePath.split(".").pop() || "png").toLowerCase();
  return { buf, ext };
}

// ---------- Utilities ----------
const JSON_HEADERS = { "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isDataUrl(str) {
  return typeof str === "string" && str.startsWith("data:image/");
}

function extFromMime(mime) {
  if (!mime) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("png")) return "png";
  return "png";
}

function dataUrlToBufferAndExt(dataUrl) {
  const [head, b64] = dataUrl.split(",");
  const mime = head.replace(/^data:/, "").replace(/;base64$/, "");
  const buf = Buffer.from(b64, "base64");
  return { buf, ext: extFromMime(mime) };
}

async function fetchToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let text = "";
    try { text = await res.text(); } catch {}
    throw new Error(`Failed to fetch input image (${res.status}). ${text.slice(0, 200)}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: JSON_HEADERS, body: '"Use POST"' };
    }

    if (!REPLICATE_API_TOKEN) {
      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify({ ok: false, error: "Missing REPLICATE_API_TOKEN env var." }),
      };
    }

    const body = JSON.parse(event.body || "{}");
    const {
      storagePath,   // Firebase Storage path
      imageUrl,      // public URL
      dataUrl,       // base64
      prompt,
      negativePrompt,
      imageStrength
    } = body;

    if (!storagePath && !imageUrl && !dataUrl) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          ok: false,
          error: "Provide one of: storagePath, imageUrl (public), or dataUrl (base64)."
        }),
      };
    }

    // 1) Obtain bytes
    let buf, ext = "png";
    if (storagePath) {
      ({ buf, ext } = await downloadFromFirebase(storagePath));
    } else if (isDataUrl(dataUrl)) {
      ({ buf, ext } = dataUrlToBufferAndExt(dataUrl));
    } else if (imageUrl) {
      // Warn on the unsupported googleusercontent download/storage/v1 form
      const badHost =
        /googleusercontent\.com$/.test(new URL(imageUrl).hostname) ||
        /appspot\.com$/.test(new URL(imageUrl).hostname);
      if (badHost && !/firebasestorage\.googleapis\.com\/v0\//.test(imageUrl)) {
        throw new Error(
          "imageUrl looks like a 'download/storage/v1' link that requires Google auth. " +
          "Use getDownloadURL(...) (v0 form with ?alt=media&token=...) or pass storagePath instead."
        );
      }
      buf = await fetchToBuffer(imageUrl);
      // try to infer ext from URL
      const m = imageUrl.match(/\.(png|jpg|jpeg|webp)(\?|$)/i);
      if (m) ext = m[1].toLowerCase();
    }

    // 2) Save to /tmp and upload to Replicate file storage
    const tmpPath = `/tmp/replicate-input-${Date.now()}.${ext}`;
    await fs.writeFile(tmpPath, buf);

    const replicate = new Replicate({ auth: REPLICATE_API_TOKEN });
    const uploaded = await replicate.files.upload(tmpPath);

    // 3) Prediction (SDXL img2img) — correct key: image_strength (0..1)
    const strength =
      typeof imageStrength === "number" ? Math.max(0, Math.min(1, imageStrength)) : 0.6;

    let prediction = await replicate.predictions.create({
      version: MODEL_VERSION,
      input: {
        image: uploaded,
        prompt: prompt || "make this look like a realistic emergency fire scene; blend overlays naturally; photorealistic",
        negative_prompt: negativePrompt || "blurry, low quality, artifacts, text, watermark",
        image_strength: strength,
      },
    });

    // 4) Poll
    const trace = [`Create status: ${prediction.status}`];
    let tries = 0;
    while (["starting", "processing", "queued"].includes(prediction.status)) {
      tries++;
      trace.push(`Poll ${tries * 2}s → ${prediction.status}`);
      await sleep(2000);
      prediction = await replicate.predictions.get(prediction.id);
    }

    if (prediction.status !== "succeeded") {
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          ok: false,
          status: prediction.status,
          id: prediction.id,
          error: prediction.error || "Replicate failed; no output URL.",
          diagnostics: { provider: "replicate", mode: "img2img", trace },
        }),
      };
    }

    const output =
      Array.isArray(prediction.output) && prediction.output.length
        ? prediction.output[0]
        : prediction.output;

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: true,
        id: prediction.id,
        image_url: output,
        diagnostics: { provider: "replicate", mode: "img2img", trace },
      }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: String(err?.message || err) }),
    };
  }
};
