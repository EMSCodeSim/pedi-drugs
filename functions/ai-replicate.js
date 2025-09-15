// netlify/functions/ai-replicate.js
// Runs img2img on Replicate (SDXL) using either a public image URL or a base64 data URL.
// - Accepts JSON POST { imageUrl?, dataUrl?, prompt?, negativePrompt?, imageStrength? }
// - Fetches/decodes the image server-side, uploads it to Replicate file storage,
//   creates a prediction, polls until done, then returns the output URL.

const Replicate = require("replicate");
const fs = require("fs/promises");

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

// You can override this in Netlify env with REPLICATE_MODEL_VERSION
const MODEL_VERSION =
  process.env.REPLICATE_MODEL_VERSION || "stability-ai/sdxl:7762fd07";

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
  // Example: "data:image/png;base64,AAAA..."
  const [head, b64] = dataUrl.split(",");
  const mime = head.replace(/^data:/, "").replace(/;base64$/, "");
  const buf = Buffer.from(b64, "base64");
  return { buf, ext: extFromMime(mime) };
}

async function fetchToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let text = "";
    try {
      text = await res.text();
    } catch {}
    throw new Error(
      `Failed to fetch input image (${res.status}). ${text.slice(0, 200)}`
    );
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
        body: JSON.stringify({
          ok: false,
          error: "Missing REPLICATE_API_TOKEN env var.",
        }),
      };
    }

    const body = JSON.parse(event.body || "{}");
    const { imageUrl, dataUrl, prompt, negativePrompt, imageStrength } = body;

    if (!imageUrl && !dataUrl) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          ok: false,
          error:
            "Provide either imageUrl (public URL) or dataUrl (base64 data:image/*).",
        }),
      };
    }

    // 1) Get image bytes (handles private storage by fetching server-side)
    let buf, ext;
    if (isDataUrl(dataUrl)) {
      const res = dataUrlToBufferAndExt(dataUrl);
      buf = res.buf;
      ext = res.ext;
    } else if (imageUrl) {
      buf = await fetchToBuffer(imageUrl);
      ext = "png"; // default if URL doesn't reveal mime; Replicate only needs the bytes
    } else {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ ok: false, error: "No valid image provided." }),
      };
    }

    // 2) Save to /tmp and upload to Replicate file storage
    const tmpPath = `/tmp/replicate-input-${Date.now()}.${ext}`;
    await fs.writeFile(tmpPath, buf);

    const replicate = new Replicate({ auth: REPLICATE_API_TOKEN });
    const uploaded = await replicate.files.upload(tmpPath); // pass this directly as the `image` input

    // 3) Create prediction using SDXL (img2img). Correct key: image_strength (0..1).
    const strength =
      typeof imageStrength === "number"
        ? Math.max(0, Math.min(1, imageStrength))
        : 0.6;

    let prediction = await replicate.predictions.create({
      version: MODEL_VERSION,
      input: {
        image: uploaded,
        prompt:
          prompt ||
          "make this look like a realistic emergency fire scene; blend overlays naturally; photorealistic",
        negative_prompt:
          negativePrompt || "blurry, low quality, artifacts, text, watermark",
        image_strength: strength,
      },
    });

    // 4) Poll until finished
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

    // SDXL returns an array of image URLs
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
      body: JSON.stringify({
        ok: false,
        error: String(err?.message || err),
      }),
    };
  }
};
