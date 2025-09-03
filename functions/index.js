// Moves inline base64 photos under /scenarios/*/stops[*].imageData
// to Cloud Storage and writes back {imageURL, storagePath, gsUri},
// then removes imageData. Triggers whenever a scenario changes.

const { onValueWritten } = require('firebase-functions/v2/database');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const crypto = require('crypto');

const DEFAULT_BUCKET = 'dailyquiz-d5279.appspot.com';

try {
  admin.initializeApp({ storageBucket: DEFAULT_BUCKET });
} catch (_) {}

function tokenURL(bucketName, path, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

async function uploadBase64ToStorage(bucket, scenarioId, idx, imageData) {
  const fmt = (imageData.format || 'jpeg').toLowerCase();
  const contentType = fmt === 'png' ? 'image/png' : 'image/jpeg';
  const ext = fmt === 'png' ? 'png' : 'jpg';

  const path = `scenarios/${scenarioId}/${Date.now()}-${idx}.${ext}`;
  const file = bucket.file(path);

  const buffer = Buffer.from(imageData.data, 'base64');
  const token = crypto.randomUUID();

  await file.save(buffer, {
    contentType,
    resumable: false,
    public: false,
    metadata: {
      cacheControl: 'public,max-age=31536000,immutable',
      metadata: { firebaseStorageDownloadTokens: token }
    }
  });

  return {
    path,
    gsUri: `gs://${bucket.name}/${path}`,
    url: tokenURL(bucket.name, path, token)
  };
}

// Triggers on any change to a scenario.
exports.flushInlinePhotos = onValueWritten(
  { ref: '/scenarios/{scenarioId}', region: 'us-central1', timeoutSeconds: 120, memory: '256MiB' },
  async (event) => {
    const scenarioId = event.params.scenarioId;
    const after = event.data.after.val() || {};

    const stops = Array.isArray(after.stops) ? after.stops : [];
    if (!stops.length) return;

    const bucket = admin.storage().bucket();
    const updates = {};
    let migrated = 0;

    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      if (!s || !s.imageData || s.storagePath || s.gsUri || s.imageURL) continue;

      try {
        const res = await uploadBase64ToStorage(bucket, scenarioId, i, s.imageData);
        updates[`stops/${i}/imageURL`] = res.url;
        updates[`stops/${i}/storagePath`] = res.path;
        updates[`stops/${i}/gsUri`] = res.gsUri;
        updates[`stops/${i}/imageData`] = null; // drop inline payload after migration
        migrated++;
      } catch (err) {
        // Keep inline data so we can retry on the next write.
        logger.error(`Failed migrating stop ${i} for ${scenarioId}:`, err);
      }
    }

    if (Object.keys(updates).length) {
      await event.data.after.ref.update(updates);
      logger.info(`Migrated ${migrated} inline photo(s) for scenario ${scenarioId}`);
    }
  }
);
