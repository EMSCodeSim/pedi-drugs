<!-- photo-storage.js -->
<script>
/**
 * FireOpsSim Storage module (compat SDK).
 * - Auth + Storage on the SAME named app ("fireops")
 * - Explicit bucket bind via gs://fireopssim.appspot.com
 * - Short retry windows (surface CSP/network quickly)
 *
 * API (attached to window.FireOpsStorage):
 *   await init()
 *   const {url, fullPath, gsUri} = await upload(scenarioId, file)
 *   const entries = await list(scenarioId)      // [{ref, url}]
 *   const urlLatest = await latest(scenarioId)
 *   const diagUrl = await diag(scenarioId)      // 1x1 png test write
 */
(function(){
  const cfgFO = {
    apiKey: "AIzaSyBzwc75u8pG73OKcHN8ti2ADbucjKMHme8",
    authDomain: "fireopssim.firebaseapp.com",
    projectId: "fireopssim",
    storageBucket: "fireopssim.appspot.com"
  };

  let appFO=null, authFO=null, storage=null;

  function ensureApp(){
    appFO = firebase.apps?.find(a => a.name === "fireops") || firebase.initializeApp(cfgFO, "fireops");
    authFO = firebase.auth(appFO);
    // CRITICAL: pin to the bucket by gs:// (matches your working test-edit)
    storage = firebase.storage(appFO, "gs://fireopssim.appspot.com");
    storage.setMaxOperationRetryTime(15000);
    storage.setMaxUploadRetryTime(30000);
  }

  async function init(){
    ensureApp();
    if (!authFO.currentUser){
      const cred = await authFO.signInAnonymously();
      console.log("[FO AUTH] uid=", cred.user?.uid);
    } else {
      console.log("[FO AUTH] existing uid=", authFO.currentUser.uid);
    }
  }

  function safeName(s){ return (s||"file").replace(/[^\w.\-]+/g,"_"); }

  async function upload(sid, file){
    if (!sid)  throw new Error("upload: scenarioId required");
    if (!file) throw new Error("upload: file required");
    if (!authFO.currentUser) await init();

    // DIRECT put (no preflight) — same as your working test-edit page
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
    const newest = entries.sort((a,b)=>(b.ref.name||"").localeCompare(a.ref.name||""))[0];
    return newest.url || newest.ref.getDownloadURL();
  }

  // Tiny 1x1 PNG write for explicit diagnostics (rules-friendly: image/*)
  async function diag(sid){
    if (!sid) throw new Error("diag: scenarioId required");
    if (!authFO.currentUser) await init();
    const onePxPNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
    const ref = storage.ref().child(`scenarios/${sid}/_diag_${Date.now()}.png`);
    await ref.putString(onePxPNG, "data_url", { contentType: "image/png", cacheControl:"public,max-age=60" });
    return ref.getDownloadURL();
  }

  window.FireOpsStorage = { init, upload, list, latest, diag };
})();
</script>
