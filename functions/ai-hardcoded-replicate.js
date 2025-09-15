// functions/ai-hardcoded-replicate.js
// Works with REPLICATE_MODEL (owner/model or owner/model:versionId) OR REPLICATE_MODEL_VERSION.
// Auto-detects image key (image/init_image) and strength knob
// (prompt_strength | strength | image_strength). Always returns 200 JSON.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-AI-Ping",
  "Access-Control-Max-Age": "86400",
};
const reply200 = (obj) => ({ statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) });
const sleep = (ms) => new Promise(r => setTimeout(r, 1000));

const API_BASE = "https://api.replicate.com/v1";
const PREDICTIONS = `${API_BASE}/predictions`;

const TOKEN       = process.env.REPLICATE_API_TOKEN || "";
const MODEL_SPEC  = (process.env.REPLICATE_MODEL || "").trim();          // e.g. "stability-ai/stable-diffusion-img2img"
const VERSION_ENV = (process.env.REPLICATE_MODEL_VERSION || "").trim();  // raw version id (optional)

// 🔒 Hardcoded test image (your Firebase/Google URL)
const HARD_IMAGE_URL =
  "https://ff0c942b9653634369ec8ba5be3d0d8d0fd89992bef1d7b27e4acfc-apidata.googleusercontent.com/download/storage/v1/b/dailyquiz-d5279.firebasestorage.app/o/scenarios%2F-OZH6KD_krWW-FODi4A_%2F1756945542530.jpg?jk=AXbWWmk2QRyT2___ioAUJm7lFLOg2k3d8RF9kKlujhGpYAyXGw8sZ5PpfaPDfyENGh40vIRXWsRLOyM1pTugfBmgDDew3fvCbPpQgqVRD_I6R4yDjGQdGwJuJiOp_XRXuXcnNZuYiaVRzmiOicIk-wv1OZjydVSJgqxMm2lYhf2MsWEIJm2xy7mKfiY1WQMNeDQPr-WyPAA2sdckBxjRK10_8VN5rKAzLNJYfiyB8Qxab23nhQiXDSsdgtJ3LcrgvsSPr2bEzzNJ0RVBXPJvzPWwbTMIAKy06hjOex0rqfCOIVk7-pJiDwToJM3MlrTpDOFRC21Be0G47kFJ2wSkcX28pdjg4bJFcOhW8b6czLk2q84aNjpT1MKrlK6vKR35FaQx1tWwxBSFcF5XEwxys9OmMD4-2UnxdzS_Wtf4NQmmILZ5w30WoN0PQmgkqb_P3yANQNMeJP6Y6eSyV9aOsLK4gtrsfxKM5lUI4a23HvKxw7kIGpbAlvZfGO00qQCESi9UBohN41AK9B2qh1eddEFaDQ4EiwMNc7qG2P2gbcFzfF_iCsPUa29VA5ExV9Mnb5OLR-Pop9aC6TGCRUowvcHX5brGSbcLEucjm9x4QAoYnGE02y-jP-7icjzP1CaDe0Xp4sw9PRBlwu_UtdB-BYG1MHnCh_i9MKvaNKNTKsYFnLJGzy0m_uwi3QEBUwHrrygma_GArZ58hWuMqj4BLb-1IveK6ppVVJ2qQQ2HCupojUXSaNICF_2PFgiMTDF_i0twMcn7CbhCOtgJpmKHTDx1EiM5smexxKed9jEeje9TXpkQHgDc3vy-XsQrMOLvXXy_QEjQv2yCEW5pxSEQowrFr4k_zwBC1yFrxlgabPcVjzayzIxGtTU9oP6qw3ghGvb_6XmE2_DigShOYFRLQ0vvtC4Gq0h-YEwSJfHHEMVmDhz3NHhu4CrF1GZU78_SdscOq69J1VInLhxV6pYa3vtRM4E8FLVd010QAkp5wq01ivAHvQyEVBvENGgZ6hBxEh_lhSacOg8A2nIt2WKGwaQbu6WQhVsEMkB-GVR05839dlldSpaiL34LEYIjE4USdcjKJo8YagdT6t8KEqWc5tCp1cBgMC1bqqy6AR6PAQd0vNu4Wqb83tgTRI4NGSaI3pY9-gYCctaF09a1NILpgzVI-wmacJiaWIB6EmIYK6gnuF8T2ahbcRzBPy9-Sz7iHMsdfSSV5qCe9cl2ZQiseQnOVoWkIQ&isca=1";

const DEFAULT_PROMPT =
  "Make the scene look like it is on fire: realistic flames, smoke, embers, heat haze; keep main structure recognizable.";

const clamp01 = (v, dflt) => {
  let n = parseFloat(v); if (!Number.isFinite(n)) n = dflt;
  return Math.max(0, Math.min(1, n));
};

const parseModelSpec = (spec) => {
  if (!spec) return { slug: null, versionFromSpec: null };
  const i = spec.lastIndexOf(":");
  if (i > -1) return { slug: spec.slice(0, i), versionFromSpec: spec.slice(i + 1) };
  return { slug: spec, versionFromSpec: null };
};

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { Authorization: `Token ${TOKEN}` } });
  const t = await r.text(); let j={}; try { j = JSON.parse(t); } catch {}
  return { ok: r.ok, status: r.status, json: j, text: t };
}

async function resolveVersion({ versionOverride, diagnostics }) {
  if (versionOverride) return { versionId: versionOverride, slug: parseModelSpec(MODEL_SPEC).slug };
  if (VERSION_ENV) return { versionId: VERSION_ENV, slug: parseModelSpec(MODEL_SPEC).slug };

  const { slug, versionFromSpec } = parseModelSpec(MODEL_SPEC);
  diagnostics.modelSlug = slug || null;
  if (versionFromSpec) return { versionId: versionFromSpec, slug };

  if (slug) {
    diagnostics.trace.push(`Fetching latest version for ${slug}…`);
    const { ok, json } = await fetchJSON(`${API_BASE}/models/${slug}`);
    if (ok && json.latest_version && json.latest_version.id) {
      return { versionId: json.latest_version.id, slug };
    }
    diagnostics.trace.push("Failed to fetch model info; cannot resolve version.");
  }
  return { versionId: null, slug: null };
}

async function discoverInputs({ slug, versionId }) {
  if (!slug || !versionId) return { keys: null, imgKey: null, strengthKey: null };
  const { ok, json } = await fetchJSON(`${API_BASE}/models/${slug}/versions/${versionId}`);
  const keys = [];
  if (ok && json && json.openapi_schema) {
    const props =
      json.openapi_schema.components?.schemas?.Input?.properties ||
      json.openapi_schema.components?.schemas?.input?.properties || {};
    for (const k of Object.keys(props)) keys.push(k);
  }
  const imgKey = keys.includes("image") ? "image" : (keys.includes("init_image") ? "init_image" : null);

  // Prefer model-specific strength knobs in this order:
  const strengthKey =
    (keys.includes("prompt_strength") && "prompt_strength") ||
    (keys.includes("strength") && "strength") ||
    (keys.includes("image_strength") && "image_strength") ||
    null;

  return { keys, imgKey, strengthKey };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS };

  if (event.httpMethod === "GET" && (event.queryStringParameters || {}).ping === "1") {
    return reply200({ ok: true, pong: true, method: "GET", t: Date.now() });
  }

  const qs = event.queryStringParameters || {};
  let body = {}; try { if (event.httpMethod === "POST" && event.body) body = JSON.parse(event.body); } catch {}
  const get = (k, d) => (qs[k] != null ? qs[k] : (body[k] != null ? body[k] : d));

  const run = String(get("run", "1")) === "1";
  const prompt = String(get("prompt", DEFAULT_PROMPT));
  // You can pass ?prompt_strength=0.35 explicitly. If not provided, we map from &strength or default.
  const promptStrengthParam = get("prompt_strength", null);
  const strengthParam = get("strength", null);

  const diagnostics = {
    provider: null,
    mode: null,
    trace: [],
    hasToken: !!TOKEN,
    env: { REPLICATE_MODEL: !!MODEL_SPEC, REPLICATE_MODEL_VERSION: !!VERSION_ENV },
    usedVersion: null,
    modelSlug: null,
    schemaInputs: null,
    chosenKeys: { imgKey: null, strengthKey: null }
  };

  if (!run && event.httpMethod === "GET") {
    return reply200({ ok: true, info: "Append ?run=1 to execute.", hardcodedImage: HARD_IMAGE_URL, env: diagnostics.env });
  }

  if (!TOKEN) {
    diagnostics.provider = "echo";
    diagnostics.trace.push("Missing REPLICATE_API_TOKEN — echoing input image.");
    return reply200({ ok: true, provider: "echo", image: { url: HARD_IMAGE_URL }, diagnostics });
  }

  const { versionId, slug } = await resolveVersion({ versionOverride: String(get("version", "")).trim(), diagnostics });
  diagnostics.usedVersion = versionId; diagnostics.modelSlug = slug;
  if (!versionId) {
    diagnostics.provider = "echo";
    diagnostics.trace.push("No version id (set REPLICATE_MODEL or REPLICATE_MODEL_VERSION). Echoing input.");
    return reply200({ ok: true, provider: "echo", image: { url: HARD_IMAGE_URL }, diagnostics });
  }

  const { keys, imgKey, strengthKey } = await discoverInputs({ slug, versionId });
  diagnostics.schemaInputs = keys;
  diagnostics.chosenKeys = { imgKey, strengthKey };
  diagnostics.mode = imgKey ? "img2img" : "text2img";

  // Build inputs respecting schema
  const input = {};
  // prompt is almost always allowed
  if (!keys || keys.includes("prompt")) input.prompt = prompt; else input["prompt"] = prompt;

  if (imgKey) {
    input[imgKey] = HARD_IMAGE_URL;

    // Figure the strength value to send
    let strengthVal = 0.35; // conservative default
    if (promptStrengthParam != null) strengthVal = clamp01(promptStrengthParam, 0.35);
    else if (strengthParam != null) strengthVal = clamp01(strengthParam, 0.35);

    if (strengthKey) input[strengthKey] = strengthVal;
  }

  const payload = { version: versionId, input };

  try {
    diagnostics.provider = "replicate";
    diagnostics.trace.push(`Creating prediction (mode=${diagnostics.mode}, imgKey=${imgKey || "none"}, strengthKey=${strengthKey || "none"})…`);

    const createRes = await fetch(PREDICTIONS, {
      method: "POST",
      headers: { Authorization: `Token ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const createTxt = await createRes.text();
    let created = {}; try { created = JSON.parse(createTxt); } catch {}
    diagnostics.trace.push(`Create status: ${createRes.status} id: ${created && created.id}`);

    if (!createRes.ok || !created.id) {
      diagnostics.trace.push(`Create failed: ${createTxt.slice(0,300)}`);
      return reply200({ ok: false, error: "Replicate create failed", status: createRes.status, details: created || createTxt, diagnostics });
    }

    const id = created.id; let final = created;
    for (let i = 0; i < 120; i++) {
      const r = await fetch(`${PREDICTIONS}/${id}`, { headers: { Authorization: `Token ${TOKEN}` } });
      const t = await r.text(); try { final = JSON.parse(t); } catch { final = { status: "unknown" }; }
      if (i % 5 === 0) diagnostics.trace.push(`Poll ${i}s → ${final.status}`);
      if (final.status === "succeeded" || final.status === "failed" || final.status === "canceled") break;
      await sleep(1000);
    }

    // Extract URL
    let outUrl = null;
    const out = final && final.output;
    if (typeof out === "string" && /^https?:\/\//i.test(out)) outUrl = out;
    else if (Array.isArray(out)) {
      const first = out.find(u => typeof u === "string" && /^https?:\/\//i.test(u));
      if (first) outUrl = first;
    }

    if (final.status !== "succeeded" || !outUrl) {
      diagnostics.trace.push(`Final status: ${final.status}; no output URL.`);
      return reply200({ ok: false, error: "Replicate did not return an image URL", status: final.status, id, output: final && final.output, diagnostics });
    }

    diagnostics.trace.push("Succeeded ✓");
    return reply200({ ok: true, provider: "replicate", mode: diagnostics.mode, image: { url: outUrl }, id, diagnostics });

  } catch (e) {
    diagnostics.trace.push(`Exception: ${e && (e.message || String(e))}`);
    return reply200({ ok: false, error: e && (e.message || String(e)), diagnostics });
  }
};
