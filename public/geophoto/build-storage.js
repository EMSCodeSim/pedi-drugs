<!-- build-storage.js -->
<script>
/**
 * FireOps Storage module (compat SDK).
 * Project: fireopssim
 * Bucket : gs://fireopssim.appspot.com
 *
 * Exposes window.FireOpsStorage with:
 *   init(): Promise<void>
 *   preflight(scenarioId): Promise<void>
 *   upload(scenarioId, File): Promise<{url, fullPath, gsUri}>
 *   list(scenarioId): Promise<Array<{ref, url}>>
 *   latest(scenarioId): Promise<string> // URL
 */

(function(){
  // ---- FireOpsSim config (PHOTOS) ----
  const cfgFO = {
    apiKey: "AIzaSyBzwc75u8pG73OKcHN8ti2ADbucjKMHme8",
    authDomain: "fireopssim.firebaseapp.com",
    projectId: "fireopssim",
    storageBucket: "fireopssim.appspot.com"
  };

  // Reuse existing named app if already created (in case file is included twice)
  let appFO = null, authFO = null, storage = null, userFO = null;

  function ensureApp(){
    appFO = firebase.apps?.find(a => a.name === "fireops") || firebase.initializeApp(cfgFO, "fireops");
    authFO = firebase.auth(appFO);
    storage = firebase.storage(appFO, "gs://fireopssim.appspot.com"); // pin bucket!
    // Keep retries short so failures surface quickly
    storage.setMaxOperationRetryTime(15000);
    storage.setMaxUploadRetryTime(30000);
  }

  async function init(){
    ensureApp();
    if (!authFO.currentUser){
      const cred = await authFO.signInAnonymously();
      userFO = cred && cred.user;
      console.log("[FO AUTH] uid=", userFO && userFO.uid);
    } else {
      userFO = authFO.currentUser;
    }
  }

  function safeName(s){ return (s||'file').replace(/[^\w.\-]+/g,'_'); }

  async function preflight(sid){
    if (!sid) throw new Error("preflight: scenarioId required");
    const ref = storage.ref().child(`scenarios/${sid}/_ping_${Date.now()}.txt`);
    const put = ref.putString("ok","raw",{contentType:"text/plain",cacheControl:"public,max-age=60"});
    const timeout = new Promise((_,rej)=> setTimeout(()=>rej(new Error("storage-preflight-timeout")), 12000));
    await Promise.race([put, timeout]);
    // optional: await ref.getDownloadURL().catch(()=>null);
  }

  async function upload(sid, file){
    if (!sid) throw new Error("upload: scenarioId required");
    if (!file) throw new Error("upload: file required");
    if (!authFO.currentUser) await init();

    // Fail fast if Storage blocked
    await preflight(sid);

    const path = `scenarios/${sid}/${Date.now()}_${safeName(file.name)}`;
    const ref  = storage.ref().child(path);
    const meta = { contentType: file.type || "image/jpeg", cacheControl: "public,max-age=31536000,immutable" };
    await ref.put(file, meta);
    const url = await ref.getDownloadURL();
    return { url, fullPath: ref.fullPath, gsUri: `gs://fireopssim.appspot.com/${ref.fullPath}` };
  }

  async function list(sid){
    if (!sid) throw new Error("list: scenarioId required");
    if (!authFO.currentUser) await init();
    const folder = storage.ref().child(`scenarios/${sid}`);
    const { items } = await folder.listAll();
    const urls = await Promise.all(items.map(it => it.getDownloadURL().catch(()=>null)));
    return items.map((it,i)=>({ ref: it, url: urls[i] }));
  }

  async function latest(sid){
    const entries = await list(sid);
    if (!entries.length) throw new Error("No files in this scenario");
    const newest = entries.sort((a,b)=>(b.ref.name||'').localeCompare(a.ref.name||''))[0];
    if (!newest.url) return newest.ref.getDownloadURL();
    return newest.url;
  }

  window.FireOpsStorage = { init, preflight, upload, list, latest };
})();
</script>
