/* =========================
   Visual Pump Builder — curved hoses from pump panel,
   per-hose "+" pins, and phone-friendly drawer actions
   ========================= */

/* SVG canvas matches viewBox 390 x 800 */
const STAGE_W = 390;
const PX_PER_50FT = 80;

/* Position of mid pump panel (tweak to match your truck image) */
const PUMP_X = Math.round(STAGE_W * 0.515); // horizontal pump location
const PUMP_Y = 600;                          // vertical mid-pump (higher = closer to bottom)

/* Curves & spacing */
const MAIN_CURVE_PULL = 38;
const BRANCH_CURVE_PULL = 44;
const BRANCH_LIFT = 28;
const PER_LINE_X_SPREAD = 16;

const COEFF = { "1.75":15.5, "2.5":2, "5":0.08 };

const NOZZLES = [
  {name:"Smooth 7/8″ @50 psi", gpm:160, NP:50},
  {name:"Smooth 15/16″ @50 psi", gpm:185, NP:50},   // default for 1¾
  {name:"Smooth 1″ @50 psi", gpm:210, NP:50},
  {name:"Fog 150 @75", gpm:150, NP:75},
  {name:"Fog 150 @100", gpm:150, NP:100},
  {name:"Fog 185 @75", gpm:185, NP:75},
  {name:"Fog 185 @100", gpm:185, NP:100},
  {name:"SB 1 1/8″ @50 psi", gpm:265, NP:50},       // default for 2½
  {name:"SB 1 1/4″ @50 psi", gpm:325, NP:50}
];

/* State per line */
function makeEmptyLine(){
  return {
    deployed:false,
    itemsMain:[],
    hasWye:false,
    wyeLoss:0,
    itemsLeft:[],
    itemsRight:[],
    nozzleLeft:null,
    nozzleRight:null,
  };
}
const lines = { left: makeEmptyLine(), right: makeEmptyLine(), back: makeEmptyLine() };
let activeKey = 'left';

/* Elevation */
let elevFt = 0, elevPsiPerFt = 0.434;

/* DOM refs */
const overlay = document.getElementById('overlay');
const hosesG = document.getElementById('hoses');
const branchesG = document.getElementById('branches');
const lineInfo = document.getElementById('lineinfo');
const lineBtns = [...document.querySelectorAll('.linebtn')];

const drawer = document.getElementById('drawer');
const drawerTitle = document.getElementById('drawerTitle');
const tabs = document.getElementById('drawerTabs');
const hoseButtonsMain = document.getElementById('hoseButtonsMain');
const hoseButtonsSplit = document.getElementById('hoseButtonsSplit');
const accButtons = document.getElementById('accButtons');
const nozRowLeft = document.getElementById('nozRowLeft');
const nozRowRight = document.getElementById('nozRowRight');

const elevFtEl = document.getElementById('elevFt');
const elevPsiEl = document.getElementById('elevPsiPerFt');

const FLmainEl = document.getElementById('FLmain');
const FLleftEl = document.getElementById('FLleft');
const FLrightEl = document.getElementById('FLright');
const ACCEl = document.getElementById('ACC');
const NPEl = document.getElementById('NP');
const GMPEl = document.getElementById('GPM');
const PDPEl = document.getElementById('PDP');
const breakdownEl = document.getElementById('breakdown');

/* Inline stroke fallback (renders hoses even if CSS fails) */
const HOSE_FALLBACK = {
  hose5:   { stroke:"#ecd464", width:12 },
  hose25:  { stroke:"#6ecbff", width:9  },
  hose175: { stroke:"#ff6b6b", width:6  }
};
function applyStrokeFallback(el, cls){
  const fb = HOSE_FALLBACK[cls]; if(!fb) return;
  el.setAttribute("stroke", fb.stroke);
  el.setAttribute("stroke-width", fb.width);
  el.setAttribute("fill", "none");
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
}

/* ===== Defaults (match one-file version) ===== */
function ensureDefaults(key){
  const L = lines[key];
  if(L.itemsMain.length) return;
  if(key === 'left' || key === 'right'){
    L.itemsMain = [{size:"1.75", lengthFt:200}];
    L.nozzleLeft = NOZZLES[1];
    L.nozzleRight = NOZZLES[1];
  } else {
    L.itemsMain = [{size:"2.5", lengthFt:200}];
    L.nozzleLeft = NOZZLES[7];
    L.nozzleRight = NOZZLES[7];
  }
}

/* ===== Hydraulics ===== */
function calcFL(gpm, size, lengthFt){
  const C = COEFF[size] || 0;
  const Q = gpm/100;
  return C * (Q*Q) * (lengthFt/100);
}
function sumFL(items, gpm){ return items.reduce((acc,h)=> acc + calcFL(gpm, h.size, h.lengthFt), 0); }
function gpmForLine(L){ return L.hasWye ? (L.nozzleLeft?.gpm||0) + (L.nozzleRight?.gpm||0) : (L.nozzleRight?.gpm||0); }
function classFor(size){ return size==='5' ? 'hose5' : (size==='2.5' ? 'hose25' : 'hose175'); }

/* ===== Curved paths (upward) ===== */
function mainCurvePath(startX, startY, totalPx, widthClass, dir){
  const endY = Math.max(36, startY - totalPx);   // go upward
  const endX = startX + (dir ? dir*14 : 0);
  const c1x = startX + (dir ? dir*MAIN_CURVE_PULL*0.6 : 0);
  const c1y = startY - totalPx*0.25;
  const c2x = startX + (dir ? dir*MAIN_CURVE_PULL : 0);
  const c2y = startY - totalPx*0.75;

  const p = document.createElementNS("http://www.w3.org/2000/svg","path");
  p.setAttribute("d", `M ${startX},${startY} C ${c1x},${c1y} ${c2x},${c2y} ${endX},${endY}`);
  p.setAttribute("class", `hoseMain ${widthClass}`);
  applyStrokeFallback(p, widthClass);
  return {path:p, endX, endY};
}
function branchCurvePath(x, y, side, totalPx, widthClass){
  const dir = side==='L' ? -1 : 1;
  const rise = Math.max(20, totalPx*0.55);
  const run  = Math.max(28, totalPx*0.45);
  const midY = y - BRANCH_LIFT;
  const endX = x + dir * run;
  const endY = Math.max(24, y - rise);

  const c1x = x + dir*BRANCH_CURVE_PULL*0.6;
  const c1y = y - rise*0.35;
  const c2x = x + dir*BRANCH_CURVE_PULL;
  const c2y = y - rise*0.75;

  const d = [
    `M ${x},${y}`,
    `L ${x},${midY}`,
    `C ${c1x},${c1y} ${c2x},${c2y} ${endX},${endY}`
  ].join(' ');

  const p = document.createElementNS("http://www.w3.org/2000/svg","path");
  p.setAttribute("d", d);
  p.setAttribute("class", `hoseMain ${widthClass}`);
  applyStrokeFallback(p, widthClass);
  return {path:p, endX, endY};
}

/* Utility */
function clearGroup(g){ while(g.firstChild) g.removeChild(g.firstChild); }

/* Place a + pin at a stage (viewBox) coordinate */
function placePlus(x, y, key, where){
  // remove existing pin for same spot (avoid duplicates on update)
  const old = document.querySelector(`.pin[data-line="${key}"][data-where="${where}"]`);
  if(old && old.parentElement) old.parentElement.removeChild(old);

  const pin = document.createElement('button');
  pin.className = 'pin';
  pin.textContent = '+';
  pin.dataset.line = key;
  pin.dataset.where = where;
  // convert viewBox coords to CSS absolute: the stage is the positioning context
  const stage = document.getElementById('stage');
  pin.style.left = `${x}px`;
  pin.style.top = `${y}px`;
  stage.appendChild(pin);
}

/* Remove all pins */
function clearPins(){ document.querySelectorAll('.pin').forEach(p=>p.remove()); }

/* Bubbles (top-right info) */
function setInfoForActive(){
  const L = lines[activeKey];
  const hoseStr = L.itemsMain.length ? L.itemsMain.map(h=>`${h.size}″×${h.lengthFt}′`).join(' + ') : '—';
  const splitStr = L.hasWye
    ? `L:${L.itemsLeft.map(h=>`${h.size}″×${h.lengthFt}′`).join('+')||'—'} | R:${L.itemsRight.map(h=>`${h.size}″×${h.lengthFt}′`).join('+')||'—'}`
    : 'Single';
  const label = activeKey==='left'?'Line 1':activeKey==='right'?'Line 2':'Line 3';
  lineInfo.innerHTML = `<b>${label}${L.deployed?' (active)':''}</b><div>Hose: ${hoseStr}</div><div>After Wye: ${splitStr}</div>`;
}

/* ===== Draw one line (curved + pins) ===== */
function drawLine(key){
  const L = lines[key];
  if(!L.deployed || !L.itemsMain.length) return;

  const dir = key==='left' ? -1 : (key==='right' ? 1 : 0);
  const startX = PUMP_X + (dir * PER_LINE_X_SPREAD);
  const startY = PUMP_Y;

  const gpm = gpmForLine(L);
  const mainLenFt = L.itemsMain.reduce((s,h)=>s+h.lengthFt,0);
  const mainPx = (mainLenFt/50) * PX_PER_50FT;
  const firstSize = L.itemsMain[0]?.size || '1.75';
  const hClass = classFor(firstSize);

  const mainSeg = mainCurvePath(startX, startY, mainPx, hClass, dir);
  hosesG.appendChild(mainSeg.path);
  placePlus(mainSeg.endX, mainSeg.endY, key, 'main');

  // branch pins + draw
  if(L.hasWye){
    if(L.itemsLeft.length){
      const leftFt = L.itemsLeft.reduce((s,h)=>s+h.lengthFt,0);
      const bL = branchCurvePath(mainSeg.endX, mainSeg.endY, 'L', (leftFt/50)*PX_PER_50FT, classFor(L.itemsLeft[0]?.size||'1.75'));
      branchesG.appendChild(bL.path);
      placePlus(bL.endX, bL.endY, key, 'L');
    } else {
      // if split but no left hose, still show a pin to start left
      placePlus(mainSeg.endX - 22, mainSeg.endY - 22, key, 'L');
    }
    if(L.itemsRight.length){
      const rightFt = L.itemsRight.reduce((s,h)=>s+h.lengthFt,0);
      const bR = branchCurvePath(mainSeg.endX, mainSeg.endY, 'R', (rightFt/50)*PX_PER_50FT, classFor(L.itemsRight[0]?.size||'1.75'));
      branchesG.appendChild(bR.path);
      placePlus(bR.endX, bR.endY, key, 'R');
    } else {
      placePlus(mainSeg.endX + 22, mainSeg.endY - 22, key, 'R');
    }
  }
}

/* ===== Update full scene ===== */
function update(){
  clearGroup(hosesG); clearGroup(branchesG); clearPins();

  let anyDeployed = false;
  ['left','right','back'].forEach(k=>{
    if(lines[k].deployed){ anyDeployed = true; drawLine(k); }
  });

  // button styling
  lineBtns.forEach(b=>{
    const k = b.dataset.line;
    b.classList.toggle('active', lines[k].deployed && k===activeKey);
  });

  // metrics for active line
  const L = lines[activeKey];
  if(L && L.deployed){
    const gpm = gpmForLine(L);
    const mainFL = sumFL(L.itemsMain, gpm);
    const needL = L.hasWye ? sumFL(L.itemsLeft, L.nozzleLeft?.gpm||0) + (L.nozzleLeft?.NP||0) : 0;
    const needR = (L.hasWye ? sumFL(L.itemsRight, L.nozzleRight?.gpm||0) : 0) + (L.nozzleRight?.NP||0);
    const accLoss = L.hasWye ? (L.wyeLoss||10) : 0;
    const elev = Number(elevFt) * Number(elevPsiPerFt);
    const branchMax = L.hasWye ? Math.max(needL, needR) : needR;
    const PDP = branchMax + mainFL + accLoss + elev;

    FLmainEl.textContent = `${mainFL.toFixed(1)} psi`;
    FLleftEl.textContent = `${(L.hasWye?needL:0).toFixed(1)} psi`;
    FLrightEl.textContent = `${needR.toFixed(1)} psi`;
    ACCEl.textContent = `${accLoss.toFixed(0)} psi`;
    const NPdisp = L.hasWye ? `${L.nozzleLeft?.NP||0}/${L.nozzleRight?.NP||0}` : `${L.nozzleRight?.NP||0}`;
    NPEl.textContent = `${NPdisp} psi`;
    GMPEl.textContent = `${gpm} gpm`;
    PDPEl.textContent = `${PDP.toFixed(1)} psi`;
    breakdownEl.textContent = L.hasWye
      ? `Branch (max L/R) ${branchMax.toFixed(1)} + Main FL ${mainFL.toFixed(1)} + Acc ${accLoss.toFixed(0)} ${Number(elevFt)>=0?'+':'-'} Elev ${Math.abs(Number(elevFt)*Number(elevPsiPerFt)).toFixed(1)}`
      : `Nozzle ${needR.toFixed(1)} + Main FL ${mainFL.toFixed(1)} + Acc ${accLoss.toFixed(0)} ${Number(elevFt)>=0?'+':'-'} Elev ${Math.abs(Number(elevFt)*Number(elevPsiPerFt)).toFixed(1)}`;
  } else {
    FLmainEl.textContent='— psi'; FLleftEl.textContent='— psi'; FLrightEl.textContent='— psi';
    ACCEl.textContent='— psi'; NPEl.textContent='— psi'; GMPEl.textContent='— gpm'; PDPEl.textContent='— psi'; breakdownEl.textContent='';
  }

  setInfoForActive();
}

/* ===== Drawer behavior (tabs + open helpers) ===== */
function openDrawer(tab){
  drawer.classList.add('open'); drawer.setAttribute('aria-hidden','false');
  tabs.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  tabs.querySelector(`.tab[data-tab="${tab}"]`)?.classList.add('active');

  hoseButtonsMain.style.display = (tab==='hose') ? 'flex' : 'none';
  hoseButtonsSplit.style.display = (tab==='split') ? 'flex' : 'none';
  accButtons.style.display = (tab==='acc') ? 'flex' : 'none';
  document.getElementById('nozButtons').style.display = (tab==='noz') ? 'block' : 'none';
}
document.getElementById('openHose').onclick = ()=>openDrawer('hose');
document.getElementById('openAcc').onclick  = ()=>openDrawer('acc');
document.getElementById('openNoz').onclick  = ()=>openDrawer('noz');

tabs.addEventListener('click', e=>{
  const b = e.target.closest('.tab'); if(!b) return;
  openDrawer(b.dataset.tab);
});

document.addEventListener('click', (e)=>{
  if(!drawer.classList.contains('open')) return;
  const inDrawer = drawer.contains(e.target);
  const isFAB = e.target.classList && e.target.classList.contains('fab');
  const isPin = e.target.classList && e.target.classList.contains('pin');
  if(!inDrawer && !isFAB && !isPin){ drawer.classList.remove('open'); drawer.setAttribute('aria-hidden','true'); }
});

/* ===== Nozzle list ===== */
function buildNozzleButtons(){
  nozRowLeft.innerHTML = '';
  nozRowRight.innerHTML = '';
  NOZZLES.forEach(n=>{
    const bL = document.createElement('button');
    bL.textContent = n.name;
    bL.onclick = ()=>{ lines[activeKey].nozzleLeft = n; update(); };
    nozRowLeft.appendChild(bL);

    const bR = document.createElement('button');
    bR.textContent = n.name;
    bR.onclick = ()=>{ lines[activeKey].nozzleRight = n; update(); };
    nozRowRight.appendChild(bR);
  });
}
buildNozzleButtons();

/* ===== Actions from drawer ===== */
let plusContext = { where:'main' }; // default target for hose appends
hoseButtonsMain.addEventListener('click', (e)=>{
  const btn = e.target.closest('button'); if(!btn) return;
  const act = btn.dataset.act;
  const L = lines[activeKey];
  if(act==='clearHose'){ L.itemsMain = []; update(); return; }
  const hose = btn.dataset.hose && JSON.parse(btn.dataset.hose);
  if(hose){
    // append to the chosen segment
    if(plusContext.where === 'L'){ L.itemsLeft.push(hose); }
    else if(plusContext.where === 'R'){ L.itemsRight.push(hose); }
    else { L.itemsMain.push(hose); }
    update();
  }
});
hoseButtonsSplit.addEventListener('click', (e)=>{
  const btn = e.target.closest('button'); if(!btn) return;
  const act = btn.dataset.act; const L = lines[activeKey];
  if(act==='clearSplit'){ L.itemsLeft=[]; L.itemsRight=[]; update(); return; }
  const side = btn.dataset.side; const hose = JSON.parse(btn.dataset.hose);
  if(side==='L'){ L.itemsLeft.push(hose); } else { L.itemsRight.push(hose); }
  update();
});
accButtons.addEventListener('click', (e)=>{
  const btn = e.target.closest('button'); if(!btn) return;
  const act = btn.dataset.act; const L = lines[activeKey];
  if(act==='clearAcc'){ L.hasWye=false; L.wyeLoss=0; update(); return; }
  const acc = btn.dataset.acc && JSON.parse(btn.dataset.acc);
  if(!acc) return;
  if(acc.name==='Wye'){ L.hasWye = true; L.wyeLoss = acc.loss || 10; openDrawer('split'); }
  update();
});

/* ===== Pins: choose where "+" acts ===== */
document.addEventListener('click', (e)=>{
  const pin = e.target.closest('.pin'); if(!pin) return;
  activeKey = pin.dataset.line;
  plusContext.where = pin.dataset.where; // 'main' | 'L' | 'R'
  // If there's a split and pin is L/R → open split; else open hose
  const L = lines[activeKey];
  openDrawer( (pin.dataset.where==='main' && !L.hasWye) ? 'hose' : (pin.dataset.where==='main' ? 'acc' : 'split') );
});

/* ===== Line button handlers ===== */
lineBtns.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const key = btn.dataset.line;
    activeKey = key;
    const L = lines[key];
    if(!L.deployed){ ensureDefaults(key); L.deployed = true; }
    else { L.deployed = false; }
    update();
  });
});

/* ===== Inputs ===== */
elevFtEl.addEventListener('input', ()=>{ elevFt = Number(elevFtEl.value||0); update(); });
elevPsiEl.addEventListener('input', ()=>{ elevPsiPerFt = Number(elevPsiEl.value||0.434); update(); });

/* ===== Init ===== */
function init(){
  elevFt = Number(elevFtEl.value||0);
  elevPsiPerFt = Number(elevPsiEl.value||0.434);
  update();
}
init();
