const canvas = document.getElementById('canvas');

const lines = {
  line1: false,
  line2: false,
  line3: false
};

function toggleLine(lineId, className) {
  if (lines[lineId]) {
    // Remove line if already deployed
    document.getElementById(lineId).remove();
    lines[lineId] = false;
  } else {
    // Add new hose line
    const hose = document.createElement('div');
    hose.id = lineId;
    hose.className = `hose ${className}`;
    hose.innerHTML = `${lineId.toUpperCase()} <button class="addWye">+ Wye</button>`;
    canvas.appendChild(hose);

    // Add Wye event
    hose.querySelector('.addWye').onclick = () => addWye(lineId);
    lines[lineId] = true;
  }
}

function addWye(lineId) {
  const parent = document.getElementById(lineId);

  // Prevent duplicate Wyes
  if (parent.querySelector('.wye')) return;

  const wye = document.createElement('div');
  wye.className = 'wye';
  wye.innerHTML = `
    <strong>Wye</strong><br>
    <button class="leftHose">+ Left Hose</button>
    <button class="rightHose">+ Right Hose</button>
  `;

  parent.appendChild(wye);

  wye.querySelector('.leftHose').onclick = () => addBranch(lineId, 'Left');
  wye.querySelector('.rightHose').onclick = () => addBranch(lineId, 'Right');
}

function addBranch(lineId, side) {
  const parent = document.getElementById(lineId);
  const branch = document.createElement('div');
  branch.className = 'hose hose-175';
  branch.textContent = `${side} Branch [+]`;
  parent.appendChild(branch);
}

document.getElementById('line1Btn').onclick = () => toggleLine('line1','hose-175');
document.getElementById('line2Btn').onclick = () => toggleLine('line2','hose-175');
document.getElementById('line3Btn').onclick = () => toggleLine('line3','hose-25');
