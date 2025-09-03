// Cloud Function: uploadScenarioImage
// Accepts {scenarioId, fileName?, dataURL? or base64?, contentType?}
// Writes to default bucket at scenarios/{scenarioId}/{fileName}
// Returns {ok, url, path, gsUri}

const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const crypto = require('crypto');
const cors = require('cors')({ origin: true });

const STORAGE_BUCKET =
  process.env.STORAGE_BUCKET || 'dailyquiz-d5279.appspot.com';

try {
  admin.initializeApp({ storageBucket: STORAGE_BUCKET });
} catch (e) {
  // ignore double init
}

function parseBody(req) {
  const { scenarioId, fileName, dataURL, base64, contentType } = req.body || {};
  if (!scenarioId) throw new Error('Missing scenarioId');

  let b64 = base64;
  let ctype = contentType || 'image/jpeg';

  if (!b64 && dataURL) {
    const parts = String(dataURL).split(',');
    if (parts.length < 2) throw new Error('Bad dataURL');
    const head = parts[0];
    b64 = parts[1];
    const m = /data:(.*?);base64/.exec(head);
    if (m && m[1]) ctype = m[1];
  }
  if (!b64) throw new Error('Missing image data');

  const name = fileName || `${Date.now()}.jpg`;
  return { scenarioId, name, b64, ctype };
}

exports.uploadScenarioImage = onRequest(
  {
    region: 'us-central1',
    cors: true, // still handling with cors() to set headers explicitly
    maxInstances: 5,
    timeoutSeconds: 60,
  },
  async (req, res) => {
    // CORS + preflight
    return cors(req, res, async () => {
      if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, X-Requested-With'
        );
        res.set('Access-Control-Max-Age', '3600');
        return res.status(204).send('');
      }
      if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: 'Use POST' });
      }

      try {
        const { scenarioId, name, b64, ctype } = parseBody(req);

        const buffer = Buffer.from(b64, 'base64');
        const bucket = admin.storage().bucket(); // default bucket
        const path = `scenarios/${scenarioId}/${name}`;
        const file = bucket.file(path);

        // Provide public download token so the URL works anonymously
        const token = crypto.randomUUID();

        await file.save(buffer, {
          contentType: ctype,
          resumable: false,
          public: false,
          metadata: {
            cacheControl: 'public,max-age=31536000,immutable',
            metadata: { firebaseStorageDownloadTokens: token },
          },
        });

        const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
          path
        )}?alt=media&token=${token}`;

        logger.info('Uploaded', { path, bytes: buffer.length });
        return res.json({
          ok: true,
          url,
          path,
          gsUri: `gs://${bucket.name}/${path}`,
        });
      } catch (err) {
        logger.error('Upload failed', err);
        return res
          .status(400)
          .json({ ok: false, error: err.message || String(err) });
      }
    });
  }
);
