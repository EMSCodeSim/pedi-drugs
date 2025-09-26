/* pump-logic.js
   Visual Pump Builder – nozzle catalog & UI wiring (drawer-style builder)

   What this provides:
   - A comprehensive NOZZLES catalog (Smooth Bore + Fog)
   - Left/Right nozzle selectors rendered as buttons
   - Emits 'nozzle:changed' CustomEvent so your existing pump math/UI can react
   - Safe defaults + re-render on selection

   Integration expectations:
   - HTML contains containers with IDs #nozzlesLeft and #nozzlesRight
   - Your code listens to window.addEventListener('nozzle:changed', (e)=>{...})
     to recompute PDP/flows and update the display.

   If your existing code already has similar hooks, you can remove duplicates
   and keep just this single source of truth for nozzle selection.
*/

// ---- Nozzle Catalog --------------------------------------------------------
const NOZZLES = [
  // Smooth-bore (very common handline tips)
  { group: "Smooth Bore", name: "SB 7/8″ @50 psi",   gpm: 160, NP: 50 },
  { group: "Smooth Bore", name: "SB 15/16″ @50 psi", gpm: 185, NP: 50 },
  { group: "Smooth Bore", name: "SB 1″ @50 psi",     gpm: 210, NP: 50 },
  { group: "Smooth Bore", name: "SB 1 1/8″ @50 psi", gpm: 265, NP: 50 },
  { group: "Smooth Bore", name: "SB 1 1/4″ @50 psi", gpm: 325, NP: 50 },

  // Fog (selectable / constant-gallonage examples)
  { group: "Fog", name: "Fog 125 @75",  gpm: 125, NP: 75 },
  { group: "Fog", name: "Fog 150 @75",  gpm: 150, NP: 75 },
  { group: "Fog", name: "Fog 150 @100", gpm: 150, NP: 100 },
  { group: "Fog", name: "Fog 185 @75",  gpm: 185, NP: 75 },
  { group: "Fog", name: "Fog 185 @100", gpm: 185, NP: 100 },
  { group: "Fog", name: "Fog 200 @75",  gpm: 200, NP: 75 },
  { group: "Fog", name: "Fog 200 @100", gpm: 200, NP: 100 },

  // Keep these if you had presets referring to “ChiefXD 185” or similar
  { group: "Fog", name: "ChiefXD 185 @50", gpm: 185, NP: 50 }
];

// ---- State -----------------------------------------------------------------
const PumpState = {
  left:  { nozzleIndex: 1 },  // default to SB 15/16" @50 psi (index 1)
  right: { nozzleIndex: 6 }   // default to Fog 150 @75 (index 6) – pick what you like
};

// ---- Helpers ---------------------------------------------------------------
function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

function getNozzle(side){
  const idx = side === 'left' ? PumpState.left.nozzleIndex : PumpState.right.nozzleIndex;
  return NOZZLES[ clamp(idx, 0, NOZZLES.length - 1) ];
}

function emitNozzleChanged(side){
  const detail = {
    side,
    nozzle: getNozzle(side),     // {group, name, gpm, NP}
    state:  JSON.parse(JSON.stringify(PumpState))
  };
  window.dispatchEvent(new CustomEvent('nozzle:changed', { detail }));
}

// ---- Rendering -------------------------------------------------------------
function nozzleButtonHTML(item, idx, currentIdx){
  const active = (idx === currentIdx) ? ' data-active="1"' : '';
  return `<button class="nozzle-btn"${active} data-idx="${idx}" title="${item.group}">
    <div class="noz-name">${item.name}</div>
    <div class="noz-sub">${item.group} • ${item.NP} psi • ${item.gpm} gpm</div>
  </button>`;
}

function groupedNozzleButtons(currentIdx){
  const groups = {};
  for(const n of NOZZLES){
    groups[n.group] ??= [];
    groups[n.group].push(n);
  }
  let html = '';
  for(const [label, items] of Object.entries(groups)){
    html += `<div class="nozzles-group"><div class="nozzles-group-title">${label}</div>`;
    const base = html.length; // not used, just clarity
    const startIndex = 0;     // we use absolute index; compute from NOZZLES
    html += items.map(item => {
      const idx = NOZZLES.indexOf(item);
      return nozzleButtonHTML(item, idx, currentIdx);
    }).join('');
    html += `</div>`;
  }
  return html;
}

function renderNozzles(side){
  const container = document.getElementById(side === 'left' ? 'nozzlesLeft' : 'nozzlesRight');
  if(!container) return;
  const currentIdx = side === 'left' ? PumpState.left.nozzleIndex : PumpState.right.nozzleIndex;
  container.innerHTML = groupedNozzleButtons(currentIdx);
}

// ---- Selection wiring ------------------------------------------------------
function attachNozzleHandlers(side){
  const container = document.getElementById(side === 'left' ? 'nozzlesLeft' : 'nozzlesRight');
  if(!container) return;

  container.addEventListener('click', (e)=>{
    const btn = e.target.closest('.nozzle-btn');
    if(!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    if(Number.isNaN(idx)) return;

    if(side === 'left') PumpState.left.nozzleIndex = idx;
    else PumpState.right.nozzleIndex = idx;

    renderNozzles(side);
    emitNozzleChanged(side);
  });
}

// ---- Public init -----------------------------------------------------------
function initPumpNozzles(){
  // Ensure indices are valid
  PumpState.left.nozzleIndex  = clamp(PumpState.left.nozzleIndex,  0, NOZZLES.length - 1);
  PumpState.right.nozzleIndex = clamp(PumpState.right.nozzleIndex, 0, NOZZLES.length - 1);

  renderNozzles('left');
  renderNozzles('right');
  attachNozzleHandlers('left');
  attachNozzleHandlers('right');

  // Initial emit so UI can sync labels/displays
  emitNozzlesSync();
}

function emitNozzlesSync(){
  emitNozzleChanged('left');
  emitNozzleChanged('right');
}

// Expose minimal API (optional)
window.PumpNozzles = {
  NOZZLES,
  state: PumpState,
  getNozzle,
  init: initPumpNozzles,
  rerender: ()=>{
    renderNozzles('left'); renderNozzles('right'); emitNozzlesSync();
  }
};

// ---- Styles you can keep or move to your CSS -------------------------------
const style = document.createElement('style');
style.textContent = `
.nozzles-group { margin-bottom: 12px; }
.nozzles-group-title { font-weight: 700; opacity: .8; margin: 8px 0; }
.nozzle-btn {
  width: 100%; text-align: left; padding: 10px 12px; margin: 6px 0;
  background: #151515; color: #eaeaea; border-radius: 12px; border: 1px solid #232323;
  cursor: pointer; transition: transform .06s ease, border-color .06s ease;
}
.nozzle-btn:hover { border-color: #2a2a2a; }
.nozzle-btn[data-active="1"] { border-color: #3b82f6; }
.noz-name { font-weight: 700; font-size: 14px; }
.noz-sub { font-size: 12px; opacity: .8; margin-top: 2px; }
`;
document.head.appendChild(style);

// Auto-init if containers exist
document.addEventListener('DOMContentLoaded', ()=>{
  if (document.getElementById('nozzlesLeft') || document.getElementById('nozzlesRight')) {
    initPumpNozzles();
  }
});
