/* =========================
   Multi-line state + drawing
   (with inline SVG fallbacks so hoses show even if CSS fails)
   ========================= */

const STAGE_W = 390;
const PX_PER_50FT = 80;
const HOSE_X_RATIO = 0.49;
const BRANCH_OFFSET = 34;

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
const lines = {
  left: makeEmptyLine(),   // Line 1
  right: makeEmptyLine(),  // Line 2
  back: makeEmptyLine()    // Line 3
};
let activeKey = 'left';     // which line is being edited

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
    // Lines 1 & 2 default: 1¾″ × 200′, 185 gpm @ 50 psi
    L.itemsMain = [{size:"1.75", lengthFt:200}];
    L.nozzleLeft = NOZZLES[1];
    L.nozzleRight = NOZZLES[1];
  } else {
    // Line 3 default: 2½″ × 200′, 265 gpm @ 50 psi
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
  if(L.hasWye){
    return (L.nozzleLeft?.gpm||0) + (L.nozzleRight?.gpm||0);
  }
  return L.nozzleRight?.gpm||0;
}
function classFor(size){
  return size==='5' ? 'hose5' : (size==='2.5' ? 'hose25' : 'hose175');
}

/* ===== Inline SVG fallback colors (works even if CSS fails) ===== */
const HOSE_FALLBACK = {
  hose5:   { stroke:"#ecd464", width:12 },
  hose25:  { stroke:"#6ecbff", width:9  },
  hose175: { stroke:"#ff6b6b", width:6  }
};

/* ===== Drawing helpers ===== */
function clearGroup(g){ while(g.firstChild) g.removeChild(g.firstChild); }
function applyStrokeFallback(el, cls){
  const fb = HOSE_FALLBACK[cls];
  if(!fb) return;
  el.setAttribute("stroke", fb.stroke);
  el.setAttribute("stroke-width", fb.width);
  el.setAttribute("fill", "none");
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
}
function hosePath(startX, startY, totalPx, widthClass){
  const endX = Math.min(startX + totalPx, STAGE_W-12);
  const p = document.createElementNS("http://www.w3.org/2000/svg","path");
  p.setAttribute("d", `M ${startX},${startY} L ${endX},${startY}`);
  p.setAttribute("class", `hoseMain ${widthClass}`);
  applyStrokeFallback(p, widthClass);   // ensure visible without CSS
  return {path:p, endX, endY:startY};
}
function branchPath(x, y, side, totalPx, widthClass){
  const dir = side==='L' ? -1 : 1;
  const turnX = x + dir*BRANCH_OFFSET;
  const endX = Math.max(12, Math.min(STAGE_W-12, turnX + dir*totalPx));
  const p = document.createElementNS("http://www.w3.org/2000/svg","path");
  p.setAttribute("d", `M ${x},${y} L ${turnX},${y-24} L ${endX},${y-24}`);
  p.setAttribute("class", `hoseMain ${widthClass}`);
  applyStrokeFallback(p, widthClass);
  return {path:p, endX, endY:y-24};
}
function addBubble(text, x,y){
  const div = document.createElement('div');
  div.className='bubble';
  div.style.left = `${x+8}px`;
  div.style.top = `${y-18}px`;
  div.textContent = text;
  overlay.parentElement.appendChild(div);
  return div;
}

/* ===== Draw one line ===== */
function drawLine(key, yOffset){
  const L = lines[key];
  if(!L.deployed || !L.itemsMain.length) return;

  const startY = 660 + yOffset;
  const startX = Math.round(STAGE_W * HOSE_X_RATIO);

  const gpm = gpmForLine(L);
  const mainLenFt = L.itemsMain.reduce((s,h)=>s+h.lengthFt,0);
  const mainPx = (mainLenFt/50) * PX_PER_50FT;
  const firstSize = L.itemsMain[0]?.size || '1.75';
  const hClass = classFor(firstSize);

  const mainSeg = hosePath(startX, startY, mainPx, hClass);
  hosesG.appendChild(mainSeg.path);
  const mainFL = sumFL(L.itemsMain, gpm);
  addBubble(`${L.itemsMain.map(h=>`${h.size}″×${h.lengthFt}′`).join(' + ')} | FL ${mainFL.toFixed(1)} psi`, mainSeg.endX, mainSeg.endY);

  let leftNeed=0, rightNeed=0;
  if(L.hasWye){
    const leftFt = L.itemsLeft.reduce((s,h)=>s+h.lengthFt,0);
    if(L.itemsLeft.length){
      const bL = branchPath(mainSeg.endX, mainSeg.endY, 'L', (leftFt/50)*PX_PER_50FT, classFor(L.itemsLeft[0]?.size||'1.75'));
      branchesG.appendChild(bL.path);
      const gL = L.nozzleLeft?.gpm||0;
      const flLeft = sumFL(L.itemsLeft, gL);
      leftNeed = flLeft + (L.nozzleLeft?.NP||0);
      addBubble(`${L.itemsLeft.map(h=>`${h.size}″×${h.lengthFt}′`).join(' + ')} | FL ${flLeft.toFixed(1)} psi | Noz ${(L.nozzleLeft?.NP||0)} psi @ ${gL} gpm`, bL.endX, bL.endY);
    }
    const rightFt = L.itemsRight.reduce((s,h)=>s+h.lengthFt,0);
    if(L.itemsRight.length){
      const bR = branchPath(mainSeg.endX, mainSeg.endY, 'R', (rightFt/50)*PX_PER_50FT, classFor(L.itemsRight[0]?.size||'1.75'));
      branchesG.appendChild(bR.path);
      const gR = L.nozzleRight?.gpm||0;
      const flRight = sumFL(L.itemsRight, gR);
      rightNeed = flRight + (L.nozzleRight?.NP||0);
      addBubble(`${L.itemsRight.map(h=>`${h.size}″×${h.lengthFt}′`).join(' + ')} | FL ${flRight.toFixed(1)} psi | Noz ${(L.nozzleRight?.NP||0)} psi @ ${gR} gpm`, bR.endX, bR.endY);
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

  const offsets = { left: 0, right: 14, back: 28 };
  let anyDeployed = false;
  let activeMetrics = null;

  Object.keys(lines).forEach(k=>{
    if(lines[k].deployed){
      anyDeployed = true;
      const m = drawLine(k, offsets[k]);
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
    if(!L.deployed){
      ensureDefaults(key);
      L.deployed = true;
    } else {
      L.deployed = false;
    }
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
  const btn = e.target.closest('button');
  if(!btn) return;
  const act = btn.dataset.act;
  const L = lines[activeKey];
  if(act==='clearHose'){ L.itemsMain = []; update(); return; }
  const hose = btn.dataset.hose && JSON.parse(btn.dataset.hose);
  if(hose){ L.itemsMain.push(hose); update(); }
});
hoseButtonsSplit.addEventListener('click', (e)=>{
  const btn = e.target.closest('button'); if(!btn) return;
  const act = btn.dataset.act;
  const L = lines[activeKey];
  if(act==='clearSplit'){ L.itemsLeft = []; L.itemsRight = []; update(); return; }
  const side = btn.dataset.side;
  const hose = JSON.parse(btn.dataset.hose);
  if(side==='L'){ L.itemsLeft.push(hose); } else { L.itemsRight.push(hose); }
  update();
});
accButtons.addEventListener('click', (e)=>{
  const btn = e.target.closest('button'); if(!btn) return;
  const act = btn.dataset.act;
  const L = lines[activeKey];
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
