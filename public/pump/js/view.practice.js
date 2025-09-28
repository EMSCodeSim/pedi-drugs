import { FL, FL_total, PSI_PER_FT } from './store.js';

export async function render(container){
  container.innerHTML = `
    <section class="stack">
      <section class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div><b>Practice Mode</b><div class="sub">We’ll build a random scenario. Find the correct PP.</div></div>
          <div class="row">
            <button class="btn" id="newScenarioBtn">New Scenario</button>
            <button class="btn" id="revealBtn">Reveal</button>
          </div>
        </div>
        <div class="row" style="margin-top:8px">
          <div class="field" style="max-width:180px">
            <label>Your PP guess (psi)</label>
            <input type="number" id="ppGuess" placeholder="e.g., 145">
          </div>
          <div class="field" style="max-width:180px">
            <label>Tolerance (± psi)</label>
            <input type="number" id="ppTol" value="10">
          </div>
          <div class="field" style="align-self:flex-end;max-width:160px">
            <button class="btn primary" id="checkBtn" style="width:100%">Check</button>
          </div>
        </div>
        <div id="practiceStatus" class="status">Tap <b>New Scenario</b> to start.</div>
      </section>

      <section class="wrapper card">
        <div class="stage">
          <svg id="overlayPractice" viewBox="0 0 390 260" preserveAspectRatio="xMidYMax meet" aria-label="Visual stage (practice)">
            <image href="https://fireopssim.com/pump/engine181.png" x="0" y="0" width="390" height="260"></image>
            <g id="hosesP"></g><g id="branchesP"></g><g id="labelsP"></g>
          </svg>
          <div class="info" id="practiceInfo">Scenario not generated</div>
        </div>
      </section>
    </section>
  `;

  const G_hosesP = container.querySelector('#hosesP');
  const G_branchesP = container.querySelector('#branchesP');
  const G_labelsP = container.querySelector('#labelsP');
  const practiceInfo = container.querySelector('#practiceInfo');

  function clearPractice(){ while(G_hosesP.firstChild) G_hosesP.removeChild(G_hosesP.firstChild); while(G_branchesP.firstChild) G_branchesP.removeChild(G_branchesP.firstChild); while(G_labelsP.firstChild) G_labelsP.removeChild(G_labelsP.firstChild); }

  let practiceAnswer = null;
  function randomPick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

  function makePractice(){
    clearPractice();
    const sizeMain = Math.random()<0.4 ? '2.5' : '1.75';
    const lenMain = [150,200,250,300][Math.floor(Math.random()*4)];
    const wye = Math.random()<0.35;
    const elev = [0,10,20,30,40][Math.floor(Math.random()*5)];
    const nozChoices = [
      {gpm:185, NP:50, label:'ChiefXD 185@50'},
      {gpm:150, NP:75, label:'Fog 150@75'},
      {gpm:185, NP:75, label:'Fog 185@75'},
      {gpm:265, NP:50, label:'SB 1 1/8 265@50'}
    ];
    const noz = randomPick(nozChoices);

    // main hose path
    const ns = 'http://www.w3.org/2000/svg';
    const totalPx = (lenMain/50)*45;
    const sx=200, sy=220; const ex=200, ey=Math.max(18, sy-totalPx);
    const pathData = `M ${sx},${sy} Q 200 ${sy-totalPx*0.6} ${ex},${ey}`;
    const base=document.createElementNS(ns,'path'); base.setAttribute('d', pathData); G_hosesP.appendChild(base);
    const p1=document.createElementNS(ns,'path'); p1.setAttribute('class','hoseBase shadow'); p1.setAttribute('d', pathData); G_hosesP.appendChild(p1);
    const p2=document.createElementNS(ns,'path'); p2.setAttribute('class',`hoseBase ${sizeMain==='2.5'?'hose25':'hose175'}`); p2.setAttribute('d', pathData); p2.setAttribute('stroke-dasharray', `${base.getTotalLength()} ${base.getTotalLength()}`); p2.setAttribute('stroke-dashoffset','0'); G_hosesP.appendChild(p2);

    // branch
    let branchLen=0, branchGpm=0, branchNP=0, wyeLoss=10;
    if(wye){
      branchLen = [50,100,150][Math.floor(Math.random()*3)];
      branchGpm = randomPick([150,185]); branchNP = randomPick([50,75]);
      const bx = ex+20, by = ey-10, by2 = Math.max(8, by - (branchLen/50)*45);
      const bpath = `M ${ex},${ey} L ${ex},${by} L ${bx},${by} L ${bx},${by2}`;
      const bShadow=document.createElementNS(ns,'path'); bShadow.setAttribute('class','hoseBase shadow'); bShadow.setAttribute('d',bpath); G_branchesP.appendChild(bShadow);
      const bVis=document.createElementNS(ns,'path'); bVis.setAttribute('class','hoseBase hose175'); bVis.setAttribute('d',bpath); G_branchesP.appendChild(bVis);
    }

    // compute PP
    const flow = wye ? (branchGpm + noz.gpm) : noz.gpm;
    const mainFL = FL_total(flow, [{size:sizeMain, lengthFt:lenMain}]);
    let PDP=0;
    if(wye){
      const bnFL = FL_total(branchGpm, [{size:'1.75', lengthFt:branchLen}]);
      const needA = branchNP + bnFL;
      const needB = noz.NP;
      PDP = Math.max(needA, needB) + mainFL + wyeLoss + elev*PSI_PER_FT;
    } else {
      PDP = noz.NP + mainFL + elev*PSI_PER_FT;
    }
    practiceAnswer = Math.round(PDP);

    const npLabel = wye ? 'via Wye' : `Nozzle ${noz.NP} psi`;
    const lbl = `${lenMain}′ @ ${wye? (noz.gpm + branchGpm) : noz.gpm} gpm — ${npLabel}${elev?` — Elev ${elev}′`:''}`;
    const text=document.createElementNS(ns,'text'); text.setAttribute('x', ex); text.setAttribute('y', ey-10); text.setAttribute('text-anchor','middle'); text.setAttribute('fill','#eaf2ff'); text.setAttribute('font-size','12'); text.textContent = lbl; G_labelsP.appendChild(text);

    practiceInfo.textContent = 'Scenario ready — enter your PP guess.';
    container.querySelector('#practiceStatus').textContent = `Hint: PP thresholds — >200 orange, >250 red.`;
  }

  container.querySelector('#newScenarioBtn').addEventListener('click', makePractice);
  container.querySelector('#checkBtn').addEventListener('click', ()=>{
    const guess = +(container.querySelector('#ppGuess').value||0), tol = Math.max(0,+(container.querySelector('#ppTol').value||10));
    if(practiceAnswer==null){ container.querySelector('#practiceStatus').textContent = 'Generate a scenario first.'; return; }
    const diff = Math.abs(guess - practiceAnswer);
    const status = container.querySelector('#practiceStatus');
    if(diff<=tol){ status.innerHTML = `<span class="ok">✅ Correct!</span> (Answer ${practiceAnswer} psi; Δ ${diff})`; }
    else if(diff<=tol*2){ status.innerHTML = `<span class="warn">⚠️ Close.</span> (Answer ${practiceAnswer} psi; Δ ${diff})`; }
    else{ status.innerHTML = `<span class="alert">❌ Not quite.</span> (Answer ${practiceAnswer} psi; Δ ${diff})`; }
  });
  container.querySelector('#revealBtn').addEventListener('click', ()=>{ if(practiceAnswer!=null) container.querySelector('#practiceStatus').innerHTML = `<b>Answer:</b> ${practiceAnswer} psi`; });

  return { dispose(){} };
}

export default { render };
