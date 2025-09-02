/* =========================
   Multi-line state + drawing
   ========================= */

const STAGE_W = 390;
const PX_PER_50FT = 80;
const HOSE_X_RATIO = 0.49;
const BRANCH_OFFSET = 34;

const COEFF = { "1.75":15.5, "2.5":2, "5":0.08 };

const NOZZLES = [
  {name:"Smooth 7/8″ @50 psi", gpm:160, NP:50},
  {name:"Smooth 15/16″ @50 psi", gpm:185, NP:50},   // used for 1¾ default
  {name:"Smooth 1″ @50 psi", gpm:210, NP:50},
  {name:"Fog 150 @75", gpm:150, NP:75},
  {name:"Fog 150 @100", gpm:150, NP:100},
  {name:"Fog 185 @75", gpm:185, NP:75},
  {name:"Fog 185 @100", gpm:185, NP:100},
  {name:"SB 1 1/8″ @50 psi", gpm:265, NP:50},       // used for 2½ default
  {name:"SB 1 1/4″ @50 psi", gpm:325, NP:50}
];

/* Per-line state */
function makeEmptyLine(){
  return {
    deployed:false,
    itemsMain:[],     // [{size:"1.75"|"2.5"|"5", lengthFt:Number}]
    hasWye:false,
    wyeLoss:0,
    itemsLeft:[],
    itemsRight:[],
    nozzleLeft:NOZZLES[1],   // defaults will be overwritten on init
    nozzleRight:NOZZLES[1],
  };
}
const lines = {
  left: makeEmptyLine(),   // Line 1
  right: makeEmptyLine(),  // Line 2
  back: makeEmptyLine()    // Line 3
};
let activeKey = 'left';     // which line's KPIs + drawer we’re editing

/* Elevation */
let elevFt = 0, elevPsiPerFt = 0.434;

/* DOM */
const overlay = document.getElementById('overlay');
const hosesG = document.getElementById('hoses');
const branchesG = document.getElementById('branches');
const hint = document.getElementById('hint');
const lineInfo = document.getElementById('lineinfo');

const linebar = document.getElementById('linebar');
const lineBtns = [...linebar.querySelectorAll('.linebtn')];

const drawer = document.getElementById('drawer');
const drawerTitle = document.getElementById('drawerTitle');
const hoseButtonsMain = document.getElementById('hoseButtonsMain');
const hoseButtonsSplit = document.getElementById('hoseButtonsSplit');
const accButtons = document.getElementById('accButtons');
const nozButtons = document.getElementById('nozButtons');
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

/* ===== Helpers ===== */
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
function ensureDefaults(key){
  const L = lines[key];
  if(L.itemsMain.length) return;

  if(key === 'left' || key === 'right'){
    // 1¾″ × 200′, 185 @ 50
    L.itemsMain = [{size:"1.75", lengthFt:200}];
    L.nozzleLeft = NOZZLES[1];
    L.nozzleRight = NOZZLES[1];
  } else {
    // back: 2½″ × 200′, 265 @ 50
    L.itemsMain = [{size:"2.5", lengthFt:200}];
    L.nozzleLeft = NOZZLES[7];
    L.nozzleRight = NOZZLES[7];
  }
}

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

const openHose = document.getElementById('openHose');
const openAcc = document.getElementById('openAcc');
const openNoz = document.getElementById('openNoz');

function openDrawer(section){
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden','false');

  hoseButtonsMain.style.display = 'none';
  hoseButtonsSplit.style.display = 'none';
  accButtons.style.display = 'none';
  nozButtons.style.display = 'none';

  if(section==='hose'){
    drawerTitle.textContent = 'Hose';
    hoseButtonsMain.style.display = 'flex';
    if(lines[activeKey].hasWye) hoseButtonsSplit.style.display = 'flex';
  }else if(section==='acc'){
    drawerTitle.textContent = 'Accessories';
    accButtons.style.display = 'flex';
  }else if(section==='noz'){
    drawerTitle.textContent = 'Nozzles';
    nozButtons.style.display = 'block';
  }
}
openHose.onclick = ()=>openDrawer('hose');
openAcc.onclick = ()=>openDrawer('acc');
openNoz.onclick = ()=>openDrawer('noz');

document.addEventListener('click', (e)=>{
  const clickInDrawer = drawer.contains(e.target);
  const clickFAB = e.target.classList && e.target.classList.contains('fab');
  if(drawer.classList.contains('open') && !clickInDrawer && !clickFAB){
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden','true');
  }
});

/* ===== Line buttons (deploy/toggle + select) ===== */
lineBtns.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const key = btn.dataset.line;
    activeK
