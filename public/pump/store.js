// Shared state, constants, helpers

export const COEFF = { "1.75":15.5, "2.5":2, "5":0.08 };
export const PSI_PER_FT = 0.434;

export const NOZ = {
  sb7_8:{id:'sb7_8',grp:'Smooth Bore',name:'SB 7/8″ (160@50)',gpm:160,NP:50},
  sb15_16:{id:'sb15_16',grp:'Smooth Bore',name:'SB 15/16″ (185@50)',gpm:185,NP:50},
  sb1_1_8:{id:'sb1_1_8',grp:'Smooth Bore',name:'SB 1 1/8″ (265@50)',gpm:265,NP:50},
  fog125_75:{id:'fog125_75',grp:'Fog',name:'Fog 125@75',gpm:125,NP:75},
  fog150_75:{id:'fog150_75',grp:'Fog',name:'Fog 150@75',gpm:150,NP:75},
  fog185_75:{id:'fog185_75',grp:'Fog',name:'Fog 185@75',gpm:185,NP:75},
  fog200_75:{id:'fog200_75',grp:'Fog',name:'Fog 200@75',gpm:200,NP:75},
  chiefXD:{id:'chiefXD',grp:'Fog',name:'ChiefXD 185@50',gpm:185,NP:50},
  chiefXD265:{id:'chiefXD265',grp:'Fog',name:'ChiefXD 265@50',gpm:265,NP:50}
};
export const NOZ_LIST = Object.values(NOZ);

const defaultPresets = {
  // Lines 1 & 2: 200' 1¾" ChiefXD 185@50; Line 3: 250' 2½" ChiefXD 265@50
  left:  {len:200, size:'1.75', noz:'chiefXD'},
  back:  {len:200, size:'1.75', noz:'chiefXD'},
  right: {len:250, size:'2.5',  noz:'chiefXD265'},
};

export function loadPresets(){
  try { const s = JSON.parse(localStorage.getItem('fireops_presets')); if(s) return s; } catch{}
  return structuredClone(defaultPresets);
}
export function savePresets(p){ localStorage.setItem('fireops_presets', JSON.stringify(p)); }

export function FL(gpm,size,ft){ const C=COEFF[size]||0, Q=gpm/100; return C*(Q*Q)*(ft/100); }
export function FL_total(gpm,segments){ return (segments||[]).reduce((a,seg)=>a+FL(gpm,seg.size,seg.lengthFt||0),0); }
export function sumFt(items){ return (items||[]).reduce((s,h)=>s+(h.lengthFt||0),0); }
export function splitIntoSections(segments){ const out=[];(segments||[]).forEach(seg=>{let r=seg.lengthFt||0; while(r>0){ const t=Math.min(100,r); out.push({size:seg.size,lengthFt:t}); r-=t; }}); return out; }

function newLine(label){
  return { label, itemsMain:[], hasWye:false, wyeLoss:10,
    itemsLeft:[], itemsRight:[],
    nozLeft:NOZ.chiefXD, nozRight:NOZ.chiefXD,
    elevFt:0, visible:false
  };
}

export const state = {
  lines: {
    left: newLine('Line 1'),
    back: newLine('Line 2'),
    right: newLine('Line 3'),
  },
  supply: 'none',
  presets: loadPresets(),
  showMath: false,          // hidden until "Why?"
  lastMaxKey: null
};

export const COLORS = {"1.75":"#ff6b6b","2.5":"#6ecbff","5":"#ecd464"};

export function sizeLabel(sz){ return sz==='2.5'?'2½″':(sz==='1.75'?'1¾″':sz+'"'); }
export function round(n){ return Math.round(n); }

export function seedDefaultsForKey(key){
  const L = state.lines[key];
  if(L.itemsMain.length) return L;
  const p = state.presets[key];
  L.itemsMain=[{size:p.size, lengthFt:p.len}];
  L.nozRight = NOZ[p.noz] || NOZ.chiefXD;
  return L;
}

// wye helpers
export function hasLeft(L){ return sumFt(L.itemsLeft)>0 && (L.nozLeft?.gpm||0)>0; }
export function hasRight(L){ return sumFt(L.itemsRight)>0 && (L.nozRight?.gpm||0)>0; }
export function isSingleWye(L){ return L.hasWye && (hasLeft(L) ^ hasRight(L)); }
export function activeSide(L){ if(!L.hasWye) return null; return hasLeft(L) && !hasRight(L) ? 'L' : (!hasLeft(L) && hasRight(L) ? 'R' : null); }
export function activeNozzle(L){ const side = activeSide(L); if(!L.hasWye) return L.nozRight; if(side==='L') return L.nozLeft; if(side==='R') return L.nozRight; return null; }
