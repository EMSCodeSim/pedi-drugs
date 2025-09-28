// Tiny router + lazy loading
const app = document.getElementById('app');
const buttons = Array.from(document.querySelectorAll('.navbtn'));
let currentView = null; // { name, dispose?() }

const loaders = {
  calc:      () => import('./view.calc.js'),
  practice:  () => import('./view.practice.js'),
  charts:    () => import('./view.charts.js'),
  settings:  () => import('./view.settings.js'),
};

async function setView(name){
  try{
    if(currentView?.dispose) { currentView.dispose(); }
    app.innerHTML = '<div style="opacity:.7;padding:12px">Loading…</div>';
    const mod = await loaders[name]();
    const view = await mod.render(app);
    currentView = { name, dispose: view?.dispose };
    buttons.forEach(b=>b.classList.toggle('active', b.dataset.view===name));
  }catch(err){
    app.innerHTML = `<div class="card">Failed to load view: ${String(err)}</div>`;
  }
}

buttons.forEach(b => b.addEventListener('click', ()=> setView(b.dataset.view)));
setView('calc'); // initial
