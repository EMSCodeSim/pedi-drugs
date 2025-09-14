// functions/ai-hardcoded-replicate.js
// Hardcoded Replicate test with diagnostics.
// - Uses your fixed image URL
// - Calls Replicate (needs REPLICATE_API_TOKEN; version from env or DEFAULT_VERSION or ?version=...)
// - Returns 200 JSON always, with detailed diagnostics + model info
//
// Quick browser tests after deploy:
//   • Health: /.netlify/functions/ai-hardcoded-replicate?ping=1
//   • Run:    /.netlify/functions/ai-hardcoded-replicate?run=1
//   • Override version: add &version=<YOUR_VERSION_ID>
//   • Some models want init_image: add &input_key=init_image
//   • Adjust strength: &strength=0.45
//
// IMPORTANT: Put your real Replicate version ID in DEFAULT_VERSION below.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-AI-Ping",
  "Access-Control-Max-Age": "86400",
};
const reply200 = (obj) => ({ statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const REPLICATE_URL = "https://api.replicate.com/v1/predictions";
const TOKEN = process.env.REPLICATE_API_TOKEN || "";
const VERSION_ENV = (process.env.REPLICATE_MODEL_VERSION || "").trim();

// ⛓️‍💥 HARD-CODED DEFAULT VERSION (REPLACE THIS WITH YOUR REAL VERSION ID)
const DEFAULT_VERSION = "REPLACE_WITH_YOUR_VERSION_ID"; // e.g. "a1b2c3d4e5f6..."

// 🔒 Your hardcoded image URL (from Firebase/Google download)
const HARD_IMAGE_URL =
  "https://ff0c942b9653634369ec8ba5be3d0d8d0fd89992bef1d7b27e4acfc-apidata.googleusercontent.com/download/storage/v1/b/dailyquiz-d5279.firebasestorage.app/o/scenarios%2F-OZH6KD_krWW-FODi4A_%2F1756945542530.jpg?jk=AXbWWmk2QRyT2___ioAUJm7lFLOg2k3d8RF9kKlujhGpYAyXGw8sZ5PpfaPDfyENGh40vIRXWsRLOyM1pTugfBmgDDew3fvCbPpQgqVRD_I6R4yDjGQdGwJuJiOp_XRXuXcnNZuYiaVRzmiOicIk-wv1OZjydVSJgqxMm2lYhf2MsWEIJm2xy7mKfiY1WQMNeDQPr-WyPAA2sdckBxjRK10_8VN5rKAzLNJYfiyB8Qxab23nhQiXDSsdgtJ3LcrgvsSPr2bEzzNJ0RVBXPJvzPWwbTMIAKy06hjOex0rqfCOIVk7-pJiDwToJM3MlrTpDOFRC21Be0G47kFJ2wSkcX28pdjg4bJFcOhW8b6czLk2q84aNjpT1MKrlK6vKR35FaQx1tWwxBSFcF5XEwxys9OmMD4-2UnxdzS_Wtf4NQmmILZ5w30WoN0PQmgkqb_P3yANQNMeJP6Y6eSyV9aOsLK4gtrsfxKM5lUI4a23HvKxw7kIGpbAlvZfGO00qQCESi9UBohN41AK9B2qh1eddEFaDQ4EiwMNc7qG2P2gbcFzfF_iCsPUa29VA5ExV9Mnb5OLR-Pop9aC6TGCRUowvcHX5brGSbcLEucjm9x4QAoYnGE02y-jP-7icjzP1CaDe0Xp4sw9PRBlwu_UtdB-BYG1MHnCh_i9MKvaNKNTKsYFnLJGzy0m_uwi3QEBUwHrrygma_GArZ58hWuMqj4BLb-1IveK6ppVVJ2qQQ2HCupojUXSaNICF_2PFgiMTDF_i0twMcn7CbhCOtgJpmKHTDx1EiM5smexxKed9jEeje9TXpkQHgDc3vy-XsQrMOLvXXy_QEjQv2yCEW5pxSEQowrFr4k_zwBC1yFrxlgabPcVjzayzIxGtTU9oP6qw3ghGvb_6XmE2_DigShOYFRLQ0vvtC4Gq0h-YEwSJfHHEMVmDhz3NHhu4CrF1GZU78_SdscOq69J1VInLhxV6pYa3vtRM4E8FLVd010QAkp5wq01ivAHvQyEVBvENGgZ6hBxEh_lhSacOg8A2nIt2WKGwaQbu6WQhVsEMkB-GVR05839dlldSpaiL34LEYIjE4USdcjKJo8YagdT6t8KEqWc5tCp1cBgMC1bqqy6AR6PAQd0vNu4Wqb83tgTRI4NGSaI3pY9-gYCctaF09a1NILpgzVI-wmacJiaWIB6EmIYK6gnuF8T2ahbcRzBPy9-Sz7iHMsdfSSV5qCe9cl2ZQiseQnOVoWkIQ&isca=1";

const DEFAULT_PROMPT =
  "Make the scene look like it is on fire: realistic flames, smoke, embers, heat haze; keep main structure recognizable.";
const DEFAULT_STRENGTH = 0.45;

function numberInRange(v, min, max, dflt) {
  let n = parseFloat(v);
  if (!Number.isFinite(n)) n = dflt;
  return Math.min(max, Math.max(min, n));
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS };

  // Healthcheck
  if (event.httpMethod === "GET" && (event.queryStringParameters || {}).ping === "1") {
    return reply200({ ok: true, pong: true, method: "GET", t: Date.now() });
  }

  const qs = event.queryStringParameters || {};
  let body = {};
  try { if (event.httpMethod === "POST" && event.body) body = JSON.parse(event.body); } catch {}
  const get = (k, d) => (qs[k] != null ? qs[k] : (body[k] != null ? body[k] : d));

  // Choose version in this order: ?version → env → DEFAULT_VERSION
  const version = String(get("version", VERSION_ENV || DEFAULT_VERSION)).trim();
  const inputKey = String(get("input_key", "image")).trim(); // "image" or "init_image"
  const strength = numberInRange(get("strength", DEFAULT_STRENGTH), 0, 1, DEFAULT_STRENGTH);
  const prompt = String(get("prompt", DEFAULT_PROMPT));

  const diagnostics = {
    provider: null,
    trace: [],
    hasToken: !!TOKEN,
    hasVersionEnv: !!VERSION_ENV,
    defaultVersionPresent: DEFAULT_VERSION !== "REPLACE_WITH_YOUR_VERSION_ID",
    usedVersion: version || null,
    inputKey,
    model: { type: "img2img", version: version || null }
  };

  // If not asked to run, show quick instructions
  if (event.httpMethod === "GET" && qs.run !== "1") {
    return reply200({
      ok: true,
      info: "Append ?run=1 to execute the Replicate call. You can also add &version=<modelVersionId>&input_key=image|init_image&strength=0.45",
      hardcodedImage: HARD_IMAGE_URL,
      model: diagnostics.model,
      env: { hasToken: diagnostics.hasToken, hasVersionEnv: diagnostics.hasVersionEnv, defaultVersionPresent: diagnostics.defaultVersionPresent }
    });
  }

  // Validate token
  if (!TOKEN) {
    diagnostics.provider = "echo";
    diagnostics.trace.push("Missing REPLICATE_API_TOKEN — echoing input image.");
    return reply200({ ok: true, provider: "echo", image: { url: HARD_IMAGE_URL }, diagnostics });
  }

  // Validate version (must not be placeholder)
  if (!version || /REPLACE_WITH_YOUR_VERSION_ID/i.test(version)) {
    diagnostics.provider = "echo";
    diagnostics.trace.push("Missing/placeholder model version — echoing input image. Provide ?version=... or set REPLICATE_MODEL_VERSION or fill DEFAULT_VERSION.");
    return reply200({ ok: true, provider: "echo", image: { url: HARD_IMAGE_URL }, diagnostics });
  }

  // Build payload (generic img2img)
  const input = { prompt, strength };
  input[inputKey] = HARD_IMAGE_URL; // "image" or "init_image", depending on model
  const payload = { version, input };

  try {
    diagnostics.provider = "replicate";
    diagnostics.trace.push("Creating prediction…");

    const createRes = await fetch(REPLICATE_URL, {
      method: "POST",
      headers: { "Authorization": `Token ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const createTxt = await createRes.text();
    let created = {};
    try { created = JSON.parse(createTxt); } catch {}
    diagnostics.trace.push(`Create status: ${createRes.status} id: ${created && created.id}`);

    if (!createRes.ok || !created.id) {
      diagnostics.trace.push(`Create failed: ${createTxt.slice(0,200)}`);
      return reply200({ ok: false, error: "Replicate create failed", status: createRes.status, details: created || createTxt, diagnostics });
    }

    // Poll
    const id = created.id;
    let final = created;
    for (let i = 0; i < 120; i++) { // ~2min
      const getRes = await fetch(`${REPLICATE_URL}/${id}`, {
        method: "GET",
        headers: { "Authorization": `Token ${TOKEN}` }
      });
      const getTxt = await getRes.text();
      try { final = JSON.parse(getTxt); } catch { final = { status: "unknown" }; }
      if (i % 5 === 0) diagnostics.trace.push(`Poll ${i}s → ${final.status}`);
      if (final.status === "succeeded" || final.status === "failed" || final.status === "canceled") break;
      await sleep(1000);
    }

    // First URL from output
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
    return reply200({
      ok: true,
      provider: "replicate",
      image: { url: outUrl },
      model: diagnostics.model,
      id,
      diagnostics
    });

  } catch (e) {
    diagnostics.trace.push(`Exception: ${e && (e.message || String(e))}`);
    return reply200({ ok: false, error: e && (e.message || String(e)), diagnostics });
  }
};
