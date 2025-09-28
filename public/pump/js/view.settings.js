import { state, NOZ_LIST, savePresets, loadPresets } from './store.js';

export async function render(container){
  container.innerHTML = `
    <section class="stack">
      <section class="card">
        <h3 style="margin:4px 0 8px">Customize Presets</h3>
        <div class="row">
          <div class="field"><label>Line 1 length (ft)</label><input id="s_len1" type="number"></div>
          <div class="field"><label>Line 1 size</label>
            <select id="s_sz1"><option value="1.75">1¾″</option><option value="2.5">2½″</option></select>
          </div>
          <div class="field"><label>Line 1 nozzle</label><select id="s_noz1"></select></div>
        </div>
        <div class="row">
          <div class="field"><label>Line 2 length (ft)</label><input id="s_len2" type="number"></div>
          <div class="field"><label>Line 2 size</label>
            <select id="s_sz2"><option value="1.75">1¾″</option><option value="2.5">2½″</option></select>
          </div>
          <div class="field"><label>Line 2 nozzle</label><select id="s_noz2"></select></div>
        </div>
        <div class="row">
          <div class="field"><label>Line 3 length (ft)</label><input id="s_len3" type="number"></div>
          <div class="field"><label>Line 3 size</label>
            <select id="s_sz3"><option value="1.75">1¾″</option><option value="2.5">2½″</option></select>
          </div>
          <div class="field"><label>Line 3 nozzle</label><select id="s_noz3"></select></div>
        </div>
        <div class="te-actions">
          <button class="btn" id="settingsReset">Reset Defaults</button>
          <button class="btn primary" id="settingsSave">Save Presets</button>
        </div>
        <div id="settingsMsg" class="status"></div>
      </section>
    </section>
  `;

  const $ = s=>container.querySelector(s);
  function fillNoz(sel){ sel.innerHTML = NOZ_LIST.map(n=>`<option value="${n.id}">${n.name}</option>`).join(''); }

  fillNoz($('#s_noz1')); fillNoz($('#s_noz2')); fillNoz($('#s_noz3'));

  function loadIntoForm(){
    const p = state.presets || loadPresets();
    $('#s_len1').value = p.left.len; $('#s_sz1').value = p.left.size; $('#s_noz1').value = p.left.noz;
    $('#s_len2').value = p.back.len; $('#s_sz2').value = p.back.size; $('#s_noz2').value = p.back.noz;
    $('#s_len3').value = p.right.len; $('#s_sz3').value = p.right.size; $('#s_noz3').value = p.right.noz;
  }
  loadIntoForm();

  $('#settingsReset').addEventListener('click', ()=>{
    localStorage.removeItem('fireops_presets');
    state.presets = loadPresets();
    loadIntoForm();
    $('#settingsMsg').textContent = 'Defaults restored (not yet saved).';
  });

  $('#settingsSave').addEventListener('click', ()=>{
    state.presets = {
      left:  {len:+$('#s_len1').value||200, size:$('#s_sz1').value, noz:$('#s_noz1').value},
      back:  {len:+$('#s_len2').value||200, size:$('#s_sz2').value, noz:$('#s_noz2').value},
      right: {len:+$('#s_len3').value||250, size:$('#s_sz3').value, noz:$('#s_noz3').value}
    };
    savePresets(state.presets);
    $('#settingsMsg').textContent = 'Saved! New presets apply when you deploy/edit lines.';
  });

  return { dispose(){} };
}

export default { render };
