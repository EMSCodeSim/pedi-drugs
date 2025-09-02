  /* =========================
     Calculator + drawing
     ========================= */

  const STAGE_W = 390;
  const PX_PER_50FT = 80;
  const HOSE_X_RATIO = 0.49;
  const ROOF_RATIO   = 0.71;
  const HOSE_TOUCH_OFFSET = -6;
  const BRANCH_OFFSET = 34;

  const HOSE_WIDTH = { "5": 12, "2.5": 9, "1.75": 6 };
  const HOSE_COLOR = { "5": "var(--hose5)", "2.5": "var(--hose25)", "1.75": "var(--hose175)" };
  const COEFF = { "1.75":15.5, "2.5":2, "5":0.08 };

  // Nozzles (a representative selection; same as 1-file version)
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

  let itemsMain = [];
  let hasWye = false;
  let wyeLoss = 10;
  let itemsLeft = [];
  let itemsRight = [];

  let nozzleLeft = NOZZLES[2];
  let nozzleRight = NOZZLES[2];

  let elevFt = 0, elevPsiPerFt = 0.434;

  const engineImg = document.getElementById('engine');
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

  // Current active discharge (left/right/back correspond to line 1/2/3)
  let activeDischarge = null; // 'left' | 'right' | 'back'
  let deployed = { left:false, right:false, back:false };

  // Build nozzle buttons
  function buildNozzleButtons(){
    nozRowLeft.innerHTML = '';
    nozRowRight.innerHTML = '';
    NOZZLES.forEach((n,i)=>{
      const bL = document.createElement('button');
      bL.textContent = n.name;
      bL.onclick = ()=>{ nozzleLeft = n; update(); };
      nozRowLeft.appendChild(bL);

      const bR = document.createElement('button');
      bR.textContent = n.name;
      bR.onclick = ()=>{ nozzleRight = n; update(); };
      nozRowRight.appendChild(bR);
    });
  }
  buildNozzleButtons();

  // Drawer handling
  const openHose = document.getElementById('openHose');
  const openAcc = document.getElementById('openAcc');
  const openNoz = document.getElementById('openNoz');

  function openDrawer(section){
    drawer.classList.add('open');
    hoseButtonsMain.style.display = 'none';
    hoseButtonsSplit.style.display = 'none';
    accButtons.style.display = 'none';
    nozButtons.style.display = 'none';

    if(section==='hose'){
      drawerTitle.textContent = 'Hose';
      hoseButtonsMain.style.display = 'flex';
      if(hasWye) hoseButtonsSplit.style.display = 'flex';
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
    if(drawer.classList.contains('open') && !drawer.contains(e.target) && !e.target.classList.contains('fab')){
      drawer.classList.remove('open');
    }
  });

  // Discharge picker (under-truck)
  const dischPicker = document.getElementById('dischargePicker');
  const dischTitle = document.getElementById('dischTitle');
  const dischRow = document.getElementById('dischRow');

  const DISCHARGES = [
    {key:'left', label:'Line 1'},
    {key:'right', label:'Line 2'},
    {key:'back', label:'Line 3'}
  ];

  function openDischargePicker(){
    dischRow.innerHTML = '';
    DISCHARGES.forEach(d=>{
      const b=document.createElement('button');
      b.textContent = d.label;
      b.onclick=()=>{ selectDischarge(d.key); dischPicker.classList.remove('open'); };
      dischRow.appendChild(b);
    });
    dischPicker.classList.add('open');
  }

  function selectDischarge(key){
    // Toggle deploy/remove for that discharge
    deployed[key] = !deployed[key];
    activeDischarge = key;
    lineBtns.forEach(btn=>{
      btn.classList.toggle('active', btn.dataset.line===key && deployed[key]);
    });
    update();
  }

  lineBtns.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const key = btn.dataset.line;
      activeDischarge = key;
      // If not deployed, deploy it; if already deployed, remove
      deployed[key] = !deployed[key];
      btn.classList.toggle('active', deployed[key]);
      update();
    });
  });

  // Picker buttons (Hose / Acc)
  hoseButtonsMain.addEventListener('click', (e)=>{
    const btn = e.target.closest('button');
    if(!btn) return;
    const act = btn.dataset.act;
    if(act==='clearHose'){ itemsMain = []; update(); return; }
    const hose = btn.dataset.hose && JSON.parse(btn.dataset.hose);
    if(hose){ itemsMain.push(hose); update(); }
  });

  hoseButtonsSplit.addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const act = btn.dataset.act;
    if(act==='clearSplit'){ itemsLeft = []; itemsRight = []; update(); return; }
    const side = btn.dataset.side;
    const hose = JSON.parse(btn.dataset.hose);
    if(side==='L'){ itemsLeft.push(hose); } else { itemsRight.push(hose); }
    update();
  });

  accButtons.addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const act = btn.dataset.act;
    if(act==='clearAcc'){ hasWye=false; wyeLoss=0; update(); return; }
    const acc = btn.dataset.acc && JSON.parse(btn.dataset.acc);
    if(!acc) return;
    if(acc.name==='Wye'){ hasWye = true; wyeLoss = acc.loss || 10; }
    update();
  });

  // Inputs
  elevFtEl.addEventListener('input', ()=>{ elevFt = Number(elevFtEl.value||0); update(); });
  elevPsiEl.addEventListener('input', ()=>{ elevPsiPerFt = Number(elevPsiEl.value||0.434); update(); });

  // Draw helpers
  function clearGroup(g){ while(g.firstChild) g.removeChild(g.firstChild); }

  function hosePath(startX, startY, totalPx, widthClass){
    // Main hose: horizontal then up the house face/roof
    const endX = Math.min(startX + totalPx, STAGE_W-12);
    const p = document.createElementNS("http://www.w3.org/2000/svg","path");
    p.setAttribute("d", `M ${startX},${startY} L ${endX},${startY}`);
    p.setAttribute("class", `hoseMain ${widthClass}`);
    return {path:p, endX, endY:startY};
  }

  function branchPath(x, y, side, totalPx, widthClass){
    // Branch: diverge up/over then vertical towards roof eave; side L goes up/left, R up/right
    const dir = side==='L' ? -1 : 1;
    const turnX = x + dir*BRANCH_OFFSET;
    const endX = Math.max(12, Math.min(STAGE_W-12, turnX + dir*totalPx));
    const p = document.createElementNS("http://www.w3.org/2000/svg","path");
    p.setAttribute("d", `M ${x},${y} L ${turnX},${y-24} L ${endX},${y-24}`);
    p.setAttribute("class", `hoseMain ${widthClass}`);
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

  function calcFL(gpm, size, lengthFt){
    // Formula: FL = C * (Q^2) * (L/100)
    const C = COEFF[size] || 0;
    const Q = gpm/100;
    return C * (Q*Q) * (lengthFt/100);
  }

  function sumFL(items, gpm){
    return items.reduce((acc,h)=> acc + calcFL(gpm, h.size, h.lengthFt), 0);
  }

  function gpmForNozzles(){
    if(hasWye){
      // If split, both branches run at their nozzle GPMs; total flow is sum
      return (nozzleLeft?.gpm||0) + (nozzleRight?.gpm||0);
    }
    return nozzleRight?.gpm||0;
  }

  function update(){
    clearGroup(hosesG); clearGroup(branchesG);
    [...document.querySelectorAll('.bubble')].forEach(b=>b.remove());

    // UI state
    hint.style.display = (deployed.left || deployed.right || deployed.back) ? 'none' : '';
    const gpm = gpmForNozzles();

    // Draw main line if any line is active (Lines 1/2/3 are just "where it exits")
    const startY = 660;                   // hose exits near pump panel area
    const startX = Math.round(STAGE_W * HOSE_X_RATIO);
    const mainLengthPx = (itemsMain.reduce((s,h)=>s+h.lengthFt,0)/50) * PX_PER_50FT;
    const mainClass = (itemsMain[0]?.size==='5' ? 'hose5' : (itemsMain[0]?.size==='2.5' ? 'hose25' : 'hose175'));

    if(deployed.left || deployed.right || deployed.back){
      if(itemsMain.length){
        const mainSeg = hosePath(startX, startY, mainLengthPx, mainClass||'hose175');
        hosesG.appendChild(mainSeg.path);

        // Bubble for main info
        const mainText = `${itemsMain.map(h=>`${h.size}″×${h.lengthFt}′`).join(' + ')} | FL ${sumFL(itemsMain, gpm).toFixed(1)} psi`;
        addBubble(mainText, mainSeg.endX, mainSeg.endY);

        // Accessories (wye appliance)
        let accLoss = 0;
        if(hasWye){
          accLoss += wyeLoss;
        }

        // Branches if wye
        let flLeft=0, flRight=0;
        if(hasWye){
          // Left
          const leftLenPx = (itemsLeft.reduce((s,h)=>s+h.lengthFt,0)/50)*PX_PER_50FT;
          if(itemsLeft.length){
            const bL = branchPath(mainSeg.endX, mainSeg.endY, 'L', leftLenPx, (itemsLeft[0]?.size==='2.5'?'hose25':'hose175'));
            branchesG.appendChild(bL.path);
            const gL = nozzleLeft?.gpm||0;
            flLeft = sumFL(itemsLeft, gL);
            addBubble(`${itemsLeft.map(h=>`${h.size}″×${h.lengthFt}′`).join(' + ')} | FL ${flLeft.toFixed(1)} psi | Noz ${nozzleLeft?.NP||0} psi @ ${gL} gpm`, bL.endX, bL.endY);
          }
          // Right
          const rightLenPx = (itemsRight.reduce((s,h)=>s+h.lengthFt,0)/50)*PX_PER_50FT;
          if(itemsRight.length){
            const bR = branchPath(mainSeg.endX, mainSeg.endY, 'R', rightLenPx, (itemsRight[0]?.size==='2.5'?'hose25':'hose175'));
            branchesG.appendChild(bR.path);
            const gR = nozzleRight?.gpm||0;
            flRight = sumFL(itemsRight, gR);
            addBubble(`${itemsRight.map(h=>`${h.size}″×${h.lengthFt}′`).join(' + ')} | FL ${flRight.toFixed(1)} psi | Noz ${nozzleRight?.NP||0} psi @ ${gR} gpm`, bR.endX, bR.endY);
          }
        }

        // KPI calculations
        const mainFL = sumFL(itemsMain, gpm);
        const accLoss = (hasWye ? wyeLoss : 0);
        const elev = elevFt * elevPsiPerFt;
        const leftNeed = (hasWye ? (sumFL(itemsLeft, nozzleLeft?.gpm||0) + (nozzleLeft?.NP||0)) : 0);
        const rightNeed = (hasWye ? (sumFL(itemsRight, nozzleRight?.gpm||0) + (nozzleRight?.NP||0)) : (nozzleRight?.NP||0));

        const branchMax = hasWye ? Math.max(leftNeed, rightNeed) : rightNeed;
        const PDP = branchMax + mainFL + accLoss + elev;

        FLmainEl.textContent = `${mainFL.toFixed(1)} psi`;
        FLleftEl.textContent = `${(hasWye?leftNeed:0).toFixed(1)} psi`;
        FLrightEl.textContent = `${rightNeed.toFixed(1)} psi`;
        ACCEl.textContent = `${accLoss.toFixed(0)} psi`;
        NPEl.textContent = `${(hasWye?(nozzleLeft?.NP||0)+'/'+(nozzleRight?.NP||0):(nozzleRight?.NP||0))} psi`;
        GMPEl.textContent = `${gpm} gpm`;
        PDPEl.textContent = `${PDP.toFixed(1)} psi`;

        breakdownEl.textContent = hasWye
          ? `Branch (max of L/R) ${branchMax.toFixed(1)} + Main FL ${mainFL.toFixed(1)} + Acc ${accLoss.toFixed(0)} ${elev>=0?'+':'-'} Elev ${Math.abs(elev).toFixed(1)}`
          : `Nozzle ${rightNeed.toFixed(1)} + Main FL ${mainFL.toFixed(1)} + Acc ${accLoss.toFixed(0)} ${elev>=0?'+':'-'} Elev ${Math.abs(elev).toFixed(1)}`;
      } else {
        // No main hose: clear KPIs but keep deployment state
        FLmainEl.textContent='— psi'; FLleftEl.textContent='— psi'; FLrightEl.textContent='— psi';
        ACCEl.textContent='— psi'; NPEl.textContent='— psi'; GMPEl.textContent='— gpm'; PDPEl.textContent='— psi'; breakdownEl.textContent='';
      }
    } else {
      // Nothing deployed
      FLmainEl.textContent='— psi'; FLleftEl.textContent='— psi'; FLrightEl.textContent='— psi';
      ACCEl.textContent='— psi'; NPEl.textContent='— psi'; GMPEl.textContent='— gpm'; PDPEl.textContent='— psi'; breakdownEl.textContent='';
    }

    // Top right info about active discharge & selected items
    const activeName = activeDischarge ? ({left:'Line 1',right:'Line 2',back:'Line 3'}[activeDischarge]||'Line') : '';
    const hoseStr = itemsMain.length ? itemsMain.map(h=>`${h.size}″×${h.lengthFt}′`).join(' + ') : '—';
    const splitStr = hasWye
      ? `L:${itemsLeft.map(h=>`${h.size}″×${h.lengthFt}′`).join('+')||'—'} | R:${itemsRight.map(h=>`${h.size}″×${h.lengthFt}′`).join('+')||'—'}`
      : 'Single';
    lineInfo.innerHTML = `<b>${activeName||'Select a line'}</b><div>Hose: ${hoseStr}</div><div>After Wye: ${splitStr}</div>`;
  }

  // Initialize nozzle rows once
  update();

  // Bind elevation inputs initial values
  elevFt = Number(elevFtEl.value||0);
  elevPsiPerFt = Number(elevPsiEl.value||0.434);

  // Discharge picker (not used currently; under-truck buttons toggle directly)
  // document.getElementById('chooseDischarge').onclick = openDischargePicker;

  // Ensure the 2½" line is blue via CSS var (already set in CSS)

