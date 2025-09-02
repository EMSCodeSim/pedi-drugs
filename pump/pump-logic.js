/* =========================
   Multi-line state + curved upward hoses from pump panel
   ========================= */

const STAGE_W = 390;
const PX_PER_50FT = 80;

/* Where the pump discharge sits on the truck image (tweak if needed) */
const PUMP_X = Math.round(STAGE_W * 0.515); // ~right of center where pump panel is
const PUMP_Y = 460;                          // vertical mid-pump; raise/lower to line up

/* Curve/spacing */
const MAIN_CURVE_PULL = 38;     // how far main hose bows left/right
const BRANCH_CURVE_PULL = 44;   // how far branches bow left/right
const BRANCH_LIFT = 28;         // initial upward lift before curving out
const PER_LINE_X_SPREAD = 16;   // start X spread between Line1/2/3

/* FL coefficients per 100' @ Q^2 */
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

/* Per-line state */
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
const hint = document.getElementById('hint');
const lineInfo = document.getElementById('lineinfo');
const lineBtns = [...document.querySelectorAll('.linebtn')];

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

/* ===== Defaults ===== */
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

/* ===== Math ===== */
function calcFL(gpm, size, lengthFt){
  const C = COEFF[size] || 0;
  const Q = gpm/100;
  return C * (Q*Q) * (lengthFt/100);
}
function sumFL(items, gpm){
  return items.reduce((acc,h)=> acc + calcFL(gpm, h.size, h.lengthFt), 0);
}
function gpmForLine(L){
  if(L.hasWye){ return (L.nozzleLeft?.gpm||0) + (L.nozzleRight?.gpm||0); }
  return L.nozzleRight?.gpm||0;
}
function classFor(size){ return size==='5' ? 'hose5' : (size==='2.5' ? 'hose25' : 'hose175'); }

/* ===== Inline SVG fallback colors (visible even if CSS fails) ===== */
const HOSE_FALLBACK = {
  hose5:   { stroke:"#ecd464", width:12 },
  hose25:  { stroke:"#6ecbff", width:9  },
  hose175: { stroke:"#ff6b6b", width:6  }
};

/* ===== Drawing helpers ===== */
function clearGroup(g){ while(g.firstChild) g.removeChild(g.firstChild); }
function applyStrokeFallback(el, cls){
  const fb = HOSE_FALLBACK[cls]; if(!fb) return;
  el.setAttribute("stroke", fb.stroke);
  el.setAttribute("stroke-width", fb.width);
  el.setAttribute("fill", "none");
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
}

/* Curved main hose that goes UP from the pump and bows left/right */
function mainCurvePath(startX, startY, totalPx, widthClass, dir){
  const endY = Math.max(36, startY - totalPx);                 // go upward
  const endX = startX + (dir ? dir*14 : 0);                    // small lateral shift
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

/* Branch that lifts then curves outward/up */
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

function addBubble(text, x,y){
  const div = document.createElement('div');
  div.className='bubble';
  div.style.left = `${Math.min(Math.max(x+8, 8), STAGE_W-160)}px`;
  div.style.top = `${Math.max(y-18, 6)}px`;
  div.textContent = text;
  overlay.parentElement.appendChild(div);
  return div;
}

/* ===== Draw one line (with curved main + curved branches) ===== */
function drawLine(key){
  const L = lines[key];
  if(!L.deployed || !L.itemsMain.length) return;

  // curve direction & starting X per line for spacing
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
  const mainFL = sumFL(L.itemsMain, gpm);
  addBubble(`${L.itemsMain.map(h=>`${h.size}″×${h.lengthFt}′`).join(' + ')} | FL ${mainFL.toFixed(1)} psi`, mainSeg.endX, mainSeg.endY);

  let leftNeed=0, rightNeed=0;
  if(L.hasWye){
    const leftFt = L.itemsLeft.reduce((s,h)=>s+h.lengthFt,0);
    if(L.itemsLeft.length){
      const bL = branchCurvePath(mainSeg.endX, mainSeg.endY, 'L', (leftFt/50)*PX_PER_50FT, classFor(L.itemsLeft[0]?.size||'1.75'));
      branchesG.appendChild(bL.path);
      const gL = L.nozzleLeft?.gpm||0;
      const flLeft = sumFL(L.itemsLeft, gL);
      leftNeed = flLeft + (L.nozzleLeft?.NP||0);
      addBubble(`L: ${leftFt}′ | FL ${flLeft.toFixed(1)} + Noz ${(L.nozzleLeft?.NP||0)} psi`, bL.endX, bL.endY);
    }
    const rightFt = L.itemsRight.reduce((s,h)=>s+h.lengthFt,0);
    if(L.itemsRight.length){
      const bR = branchCurvePath(mainSeg.endX, mainSeg.endY, 'R', (rightFt/50)*PX_PER_50FT, classFor(L.itemsRight[0]?.size||'1.75'));
      branchesG.appendChild(bR.path);
      const gR = L.nozzleRight?.gpm||0;
      const flRight = sumFL(L.itemsRight, gR);
      rightNeed = flRight + (L.nozzleRight?.NP||0);
      addBubble(`R: ${rightFt}′ | FL ${flRight.toFixed(1)} + Noz ${(L.nozzleRight?.NP||0)} psi`, bR.endX, bR.endY);
    }
  } else {
    rightNeed = (L.nozzleRight?.NP||0);
  }

  const accLoss = L.hasWye ? (L.wyeLoss||10) : 0;
  const elev = Number(elevFt) * Number(elevPsiPerFt);
  const branchMax = L.hasWye ? Math.max(leftNeed, rightNeed) : rightNeed;
  const PDP = branchMax + mainFL + accLoss + elev;

  return {gpm, mainFL, leftNeed, rightNeed, accLoss, PDP, branchMax};
}

/* ===== Update ===== */
function update(){
  clearGroup(hosesG); clearGroup(branchesG);
  [...document.querySelectorAll('.bubble')].forEach(b=>b.remove());

  let anyDeployed = false;
  let activeMetrics = null;

  ['left','right','back'].forEach(k=>{
    if(lines[k].deployed){
      anyDeployed = true;
      const m = drawLine(k);
      if(k === activeKey && m) activeMetrics = m;
    }
  });
  hint.style.display = anyDeployed ? 'none' : '';

  lineBtns.forEach(b=>{
    const k = b.dataset.line;
    b.classList.toggle('active', lines[k].deployed && k===activeKey);
  });

  if(activeMetrics){
    FLmainEl.textContent = `${activeMetrics.mainFL.toFixed(1)} psi`;
    FLleftEl.textContent = `${(lines[activeKey].hasWye?activeMetrics.leftNeed:0).toFixed(1)} psi`;
    FLrightEl.textContent = `${activeMetrics.rightNeed.toFixed(1)} psi`;
    ACCEl.textContent = `${activeMetrics.accLoss.toFixed(0)} psi`;
    const NPdisp = lines[activeKey].hasWye
      ? `${lines[activeKey].nozzleLeft?.NP||0}/${lines[activeKey].nozzleRight?.NP||0}`
      : `${lines[activeKey].nozzleRight?.NP||0}`;
    NPEl.textContent = `${NPdisp} psi`;
    GMPEl.textContent = `${activeMetrics.gpm} gpm`;
    PDPEl.textContent = `${activeMetrics.PDP.toFixed(1)} psi`;
    breakdownEl.textContent = lines[activeKey].hasWye
      ? `Branch (max L/R) ${activeMetrics.branchMax.toFixed(1)} + Main FL ${activeMetrics.mainFL.toFixed(1)} + Acc ${activeMetrics.accLoss.toFixed(0)} ${Number(elevFt)>=0?'+':'-'} Elev ${Math.abs(Number(elevFt)*Number(elevPsiPerFt)).toFixed(1)}`
      : `Nozzle ${activeMetrics.rightNeed.toFixed(1)} + Main FL ${activeMetrics.mainFL.toFixed(1)} + Acc ${activeMetrics.accLoss.toFixed(0)} ${Number(elevFt)>=0?'+':'-'} Elev ${Math.abs(Number(elevFt)*Number(elevPsiPerFt)).toFixed(1)}`;
  } else {
    FLmainEl.textContent='— psi'; FLleftEl.textContent='— psi'; FLrightEl.textContent='— psi';
    ACCEl.textContent='— psi'; NPEl.textContent='— psi'; GMPEl.textContent='— gpm'; PDPEl.textContent='— psi'; breakdownEl.textContent='';
  }

  const L = lines[activeKey];
  const hoseStr = L.itemsMain.length ? L.itemsMain.map(h=>`${h.size}″×${h.lengthFt}′`).join(' + ') : '—';
  const splitStr = L.hasWye
    ? `L:${L.itemsLeft.map(h=>`${h.size}″×${h.lengthFt}′`).join('+')||'—'} | R:${L.itemsRight.map(h=>`${h.size}″×${h.lengthFt}′`).join('+')||'—'}`
    : 'Single';
  const label = activeKey==='left'?'Line 1':activeKey==='right'?'Line 2':'Line 3';
  lineInfo.innerHTML = `<b>${label}${L.deployed?' (active)':''}</b><div>Hose: ${hoseStr}</div><div>After Wye: ${splitStr}</div>`;
}

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

/* ===== Drawer (edits ACTIVE line) ===== */
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

document.getElementById('openHose').onclick = ()=>openDrawer('hose');
document.getElementById('openAcc').onclick = ()=>openDrawer('acc');
document.getElementById('openNoz').onclick = ()=>openDrawer('noz');

const drawer = document.getElementById('drawer');
const drawerTitle = document.getElementById('drawerTitle');
function openDrawer(section){
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden','false');

  document.getElementById('hoseButtonsMain').style.display = 'none';
  document.getElementById('hoseButtonsSplit').style.display = 'none';
  document.getElementById('accButtons').style.display = 'none';
  document.getElementById('nozButtons').style.display = 'none';

  if(section==='hose'){
    drawerTitle.textContent = 'Hose';
    document.getElementById('hoseButtonsMain').style.display = 'flex';
    if(lines[activeKey].hasWye) document.getElementById('hoseButtonsSplit').style.display = 'flex';
  }else if(section==='acc'){
    drawerTitle.textContent = 'Accessories';
    document.getElementById('accButtons').style.display = 'flex';
  }else if(section==='noz'){
    drawerTitle.textContent = 'Nozzles';
    document.getElementById('nozButtons').style.display = 'block';
  }
}
document.addEventListener('click', (e)=>{
  const clickInDrawer = drawer.contains(e.target);
  const clickFAB = e.target.classList && e.target.classList.contains('fab');
  if(drawer.classList.contains('open') && !clickInDrawer && !clickFAB){
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden','true');
  }
});

/* ===== Drawer button actions ===== */
hoseButtonsMain.addEventListener('click', (e)=>{
  const btn = e.target.closest('button'); if(!btn) return;
  const act = btn.dataset.act; const L = lines[activeKey];
  if(act==='clearHose'){ L.itemsMain = []; update(); return; }
  const hose = btn.dataset.hose && JSON.parse(btn.dataset.hose);
  if(hose){ L.itemsMain.push(hose); update(); }
});
hoseButtonsSplit.addEventListener('click', (e)=>{
  const btn = e.target.closest('button'); if(!btn) return;
  const act = btn.dataset.act; const L = lines[activeKey];
  if(act==='clearSplit'){ L.itemsLeft = []; L.itemsRight = []; update(); return; }
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
  if(acc.name==='Wye'){ L.hasWye = true; L.wyeLoss = acc.loss || 10; }
  update();
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
