/* Phone-first visual builder: truck in-SVG, hoses from pump panel upward,
   line buttons under truck, "+" pins at hose ends. */

const VIEW_W = 390;    // SVG viewBox width
const VIEW_H = 260;    // SVG viewBox height
const PX_PER_50FT = 45; // visual scale (200' ≈ 180px upward)

const PUMP_ANCHOR = { x: 0.515, y: 0.74 };  // relative (0..1) mid pump panel
const MAIN_CURVE_PULL = 36;
const BRANCH_CURVE_PULL = 44;
const BRANCH_LIFT = 26;
const PER_LINE_X_SPREAD = 14;

const COEFF = { "1.75":15.5, "2.5":2, "5":0.08 };

const NOZZLES = [
  {name:"Smooth 7/8″ @50 psi", gpm:160, NP:50},
  {name:"Smooth 15/16″ @50 psi", gpm:185, NP:50},
  {name:"Smooth 1″ @50 psi", gpm:210, NP:50},
  {name:"Fog 150 @75", gpm:150, NP:75},
  {name:"Fog 150 @100", gpm:150, NP:100},
  {name:"Fog 185 @75", gpm:185, NP:75},
  {name:"Fog 185 @100", gpm:185, NP:100},
  {name:"SB 1 1/8″ @50 psi", gpm:265, NP:50},
  {name:"SB 1 1/4″ @50 psi", gpm:325, NP:50}
];

function emptyLine(){ return {
  deployed:false, itemsMain:[], hasWye:false, wyeLoss:0,
  itemsLeft:[], itemsRight:[], nozzleLeft:null, nozzleRight:null
};}
const lines = { left:emptyLine(), right:emptyLine(), back:emptyLine() };
let activeKey = 'left';

let elevFt = 0, elevPsiPerFt = 0.434;

const overlay = document.getElementById('overlay');
const hosesG  = document.getElementById('hoses');
const branchesG = document.getElementById('branches');
const lineInfo = document.getElementById('lineinfo');
const lineBtns = [...document.querySelectorAll('.linebtn')];

const drawer = document.getElementById('drawer');
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

/* Fallback stroke in case CSS fails */
const HOSE_FALLBACK = {
  hose5:{stroke:"#ecd464",width:12},
  hose25:{stroke:"#6ecbff",width:9},
  hose175:{stroke:"#ff6b6b",width:6}
};
function applyStrokeFallback(el, cls){
  const fb = HOSE_FALLBACK[cls]; if(!fb) return;
  el.setAttribute("stroke", fb.stroke);
  el.setAttribute("stroke-width", fb.width);
  el.setAttribute("fill", "none");
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
}

/* Defaults (parity with one-file version) */
function ensureDefaults(key){
  const L = lines[key];
  if(L.itemsMain.length) return;
  if(key==='left' || key==='right'){
    L.itemsMain = [{size:"1.75", lengthFt:200}];
    L.nozzleLeft = NOZZLES[1]; L.nozzleRight = NOZZLES[1];
  } else {
    L.itemsMain = [{size:"2.5", lengthFt:200}];
    L.nozzleLeft = NOZZLES[7]; L.nozzleRight = NOZZLES[7];
  }
}

/* Hydraulics */
function calcFL(gpm, size, lengthFt){
  const C = COEFF[size] || 0; const Q = gpm/100;
  return C * (Q*Q) * (lengthFt/100);
}
function sumFL(items, gpm){ return items.reduce((a,h)=>a+calcFL(gpm,h.size,h.lengthFt),0); }
function gpmForLine(L){ return L.hasWye ? (L.nozzleLeft?.gpm||0)+(L.nozzleRight?.gpm||0) : (L.nozzleRight?.gpm||0); }
function clsFor(size){ return size==='5'?'hose5':(size==='2.5'?'hose25':'hose175'); }

/* Paths */
function mainCurve(startX, startY, totalPx, cls, dir){
  const endY = Math.max(10, startY - totalPx);
  const endX = startX + (dir? dir*12 : 0);
  const c1x = startX + (dir? dir*MAIN_CURVE_PULL*0.6 : 0);
  const c1y = startY - totalPx*0.25;
  const c2x = startX + (dir? dir*MAIN_CURVE_PULL : 0);
  const c2y = startY - totalPx*0.75;
  const p = document.createElementNS("http://www.w3.org/2000/svg","path");
  p.setAttribute("d", `M ${startX},${startY} C ${c1x},${c1y} ${c2x},${c2y} ${endX},${endY}`);
  p.setAttribute("class", `hoseMain ${cls}`); applyStrokeFallback(p, cls);
  return {path:p, endX, endY};
}
function branchCurve(x,y,side,totalPx,cls){
  const dir = side==='L'? -1 : 1;
  const rise = Math.max(20, totalPx*0.55);
  const run  = Math.max(28, totalPx*0.45);
  const midY = y - BRANCH_LIFT;
  const endX = x + dir*run;
  const endY = Math.max(8,  y - rise);
  const c1x = x + dir*BRANCH_CURVE_PULL*0.6;
  const c1y = y - rise*0.35;
  const c2x = x + dir*BRANCH_CURVE_PULL;
  const c2y = y - rise*0.75;
  const d = `M ${x},${y} L ${x},${midY} C ${c1x},${c1y} ${c2x},${c2y} ${endX},${endY}`;
  const p = document.createElementNS("http://www.w3.org/2000/svg","path");
  p.setAttribute("d", d);
  p.setAttribute("class", `hoseMain ${cls}`); applyStrokeFallback(p, cls);
  return {path:p, endX, endY};
}

/* Utilities */
function clearGroup(g){ while(g.firstChild) g.removeChild(g.firstChild); }
function placePin(x, y, key, where){
  // remove any existing pin for same spot
  document.querySelectorAll(`.pin[data-line="${key}"][data-where="${where}"]`).forEach(p=>p.remove());
  const pin = document.createElement('button');
  pin.className='pin'; pin.textContent='+';
  pin.dataset.line = key; pin.dataset.where = where;
  // convert from SVG coords → percentages to stay aligned responsively
  pin.style.left = (x / VIEW_W * 100) + '%';
  pin.style.top  = (y / VIEW_H * 100) + '%';
  document.getElementById('stage').appendChild(pin);
}

/* Info */
function setInfoForActive(){
  const L = lines[activeKey];
  const hoseStr = L.itemsMain.length ? L.itemsMain.map(h=>`${h.size}″×${h.lengthFt}′`).join(' + ') : '—';
  const splitStr = L.hasWye ? `L:${L.itemsLeft.map(h=>`${h.size}″×${h.lengthFt}′`).join('+')||'—'} | R:${L.itemsRight.map(h=>`${h.size}″×${h.lengthFt}′`).join('+')||'—'}` : 'Single';
  const label = activeKey==='left'?'Line 1':activeKey==='right'?'Line 2':'Line 3';
  document.getElementById('lineinfo').innerHTML = `<b>${label}${L.deployed?' (active)':''}</b><div>Hose: ${hoseStr}</div><div>After Wye: ${splitStr}</div>`;
}

/* Draw one line */
function drawLine(key){
  const L = lines[key];
  if(!L.deployed || !L.itemsMain.length) return;

  const startX = VIEW_W * PUMP_ANCHOR.x + (key==='left'?-PER_LINE_X_SPREAD: key==='right'?PER_LINE_X_SPREAD:0);
  const startY = VIEW_H * PUMP_ANCHOR.y;
  const dir     = key==='left' ? -1 : (key==='right' ? 1 : 0);

  const gpm = gpmForLine(L);
  const mainFt = L.itemsMain.reduce((s,h)=>s+h.lengthFt,0);
  const mainPx = (mainFt/50) * PX_PER_50FT;
  const cls = clsFor(L.itemsMain[0]?.size||'1.75');

  const main = mainCurve(startX, startY, mainPx, cls, dir);
  hosesG.appendChild(main.path);
  placePin(main.endX, main.endY, key, 'main');

  if(L.hasWye){
    if(L.itemsLeft.length){
      const ft = L.itemsLeft.reduce((s,h)=>s+h.lengthFt,0);
      const seg = branchCurve(main.endX, main.endY, 'L', (ft/50)*PX_PER_50FT, clsFor(L.itemsLeft[0]?.size||'1.75'));
      branchesG.appendChild(seg.path); placePin(seg.endX, seg.endY, key, 'L');
    } else { placePin(main.endX-18, main.endY-18, key, 'L'); }
    if(L.itemsRight.length){
      const ft = L.itemsRight.reduce((s,h)=>s+h.lengthFt,0);
      const seg = branchCurve(main.endX, main.endY, 'R', (ft/50)*PX_PER_50FT, clsFor(L.itemsRight[0]?.size||'1.75'));
      branchesG.appendChild(seg.path); placePin(seg.endX, seg.endY, key, 'R');
    } else { placePin(main.endX+18, main.endY-18, key, 'R'); }
  }
}

/* Full update */
function update(){
  clearGroup(hosesG); clearGroup(branchesG);
  document.querySelectorAll('.pin').forEach(p=>p.remove());

  ['left','right','back'].forEach(k=>{ if(lines[k].deployed) drawLine(k); });

  lineBtns.forEach(b=>{
    const k = b.dataset.line; b.classList.toggle('active', lines[k].deployed && k===activeKey);
  });

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

/* Drawer controls */
function openDrawer(tab){
  drawer.classList.add('open'); drawer.setAttribute('aria-hidden','false');
  document.querySelectorAll('#drawerTabs .tab').forEach(t=>t.classList.remove('active'));
  document.querySelector(`#drawerTabs .tab[data-tab="${tab}"]`)?.classList.add('active');
  hoseButtonsMain.style.display = (tab==='hose') ? 'flex' : 'none';
  hoseButtonsSplit.style.display = (tab==='split') ? 'flex' : 'none';
  accButtons.style.display = (tab==='acc') ? 'flex' : 'none';
  document.getElementById('nozButtons').style.display = (tab==='noz') ? 'block' : 'none';
}
document.getElementById('openHose').onclick = ()=>openDrawer('hose');
document.getElementById('openAcc').onclick  = ()=>openDrawer('acc');
document.getElementById('openNoz').onclick  = ()=>openDrawer('noz');
tabs.addEventListener('click', e=>{
  const b = e.target.closest('.tab'); if(!b) return; openDrawer(b.dataset.tab);
});
document.addEventListener('click',(e)=>{
  if(!drawer.classList.contains('open')) return;
  const inDrawer = drawer.contains(e.target);
  const isFAB = e.target.classList && e.target.classList.contains('fab');
  const isPin = e.target.classList && e.target.classList.contains('pin');
  if(!inDrawer && !isFAB && !isPin){ drawer.classList.remove('open'); drawer.setAttribute('aria-hidden','true'); }
});

/* Nozzle buttons */
function buildNozzles(){
  nozRowLeft.innerHTML=''; nozRowRight.innerHTML='';
  NOZZLES.forEach(n=>{
    const bL=document.createElement('button'); bL.textContent=n.name;
    bL.onclick=()=>{ lines[activeKey].nozzleLeft=n; update(); };
    nozRowLeft.appendChild(bL);
    const bR=document.createElement('button'); bR.textContent=n.name;
    bR.onclick=()=>{ lines[activeKey].nozzleRight=n; update(); };
    nozRowRight.appendChild(bR);
  });
}
buildNozzles();

/* Pins: remember where to add hose */
let plusContext = { where:'main' };
document.addEventListener('click',(e)=>{
  const pin = e.target.closest('.pin'); if(!pin) return;
  activeKey = pin.dataset.line; plusContext.where = pin.dataset.where;
  const L = lines[activeKey];
  openDrawer( (pin.dataset.where==='main' && !L.hasWye) ? 'hose' : (pin.dataset.where==='main' ? 'acc' : 'split') );
});

/* Drawer actions */
hoseButtonsMain.addEventListener('click', (e)=>{
  const btn=e.target.closest('button'); if(!btn) return;
  const act=btn.dataset.act; const L=lines[activeKey];
  if(act==='clearHose'){ L.itemsMain=[]; update(); return; }
  const hose = btn.dataset.hose && JSON.parse(btn.dataset.hose);
  if(!hose) return;
  if(plusContext.where==='L'){ L.itemsLeft.push(hose); }
  else if(plusContext.where==='R'){ L.itemsRight.push(hose); }
  else { L.itemsMain.push(hose); }
  update();
});
hoseButtonsSplit.addEventListener('click', (e)=>{
  const btn=e.target.closest('button'); if(!btn) return;
  const act=btn.dataset.act; const L=lines[activeKey];
  if(act==='clearSplit'){ L.itemsLeft=[]; L.itemsRight=[]; update(); return; }
  const side=btn.dataset.side; const hose=JSON.parse(btn.dataset.hose);
  if(side==='L'){ L.itemsLeft.push(hose); } else { L.itemsRight.push(hose); }
  update();
});
accButtons.addEventListener('click', (e)=>{
  const btn=e.target.closest('button'); if(!btn) return;
  const act=btn.dataset.act; const L=lines[activeKey];
  if(act==='clearAcc'){ L.hasWye=false; L.wyeLoss=0; update(); return; }
  const acc=btn.dataset.acc && JSON.parse(btn.dataset.acc);
  if(acc && acc.name==='Wye'){ L.hasWye=true; L.wyeLoss=acc.loss||10; openDrawer('split'); }
  update();
});

/* Line buttons toggle deploy */
lineBtns.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const key=btn.dataset.line; activeKey=key;
    const L=lines[key]; if(!L.deployed){ ensureDefaults(key); L.deployed=true; } else { L.deployed=false; }
    update();
  });
});

/* Inputs */
elevFtEl.addEventListener('input', ()=>{ elevFt=Number(elevFtEl.value||0); update(); });
elevPsiEl.addEventListener('input', ()=>{ elevPsiPerFt=Number(elevPsiEl.value||0.434); update(); });

/* Init */
function init(){
  elevFt=Number(elevFtEl.value||0);
  elevPsiPerFt=Number(elevPsiEl.value||0.434);
  update();
}
init();
