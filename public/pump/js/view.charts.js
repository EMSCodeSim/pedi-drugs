export async function render(container){
  container.innerHTML = `
    <section class="stack">
      <section class="card">
        <h3 style="margin:4px 0 8px">Reference Charts</h3>
        <div class="grid">
          <div class="card">
            <caption>Friction Loss per 100′</caption>
            <table>
              <thead><tr><th>Hose</th><th>Formula</th><th>Example @ 150 gpm</th></tr></thead>
              <tbody>
                <tr><td>1¾″</td><td>15.5 × (Q²) (Q = gpm/100)</td><td>15.5 × (1.5²) = 34.9 psi</td></tr>
                <tr><td>2½″</td><td>2 × (Q²)</td><td>2 × (1.5²) = 4.5 psi</td></tr>
                <tr><td>5″</td><td>0.08 × (Q²)</td><td>0.08 × (1.5²) = 0.18 psi</td></tr>
              </tbody>
            </table>
          </div>
          <div class="card">
            <caption>Smooth Bore Tip GPM @ 50 psi NP</caption>
            <table>
              <thead><tr><th>Tip</th><th>GPM</th></tr></thead>
              <tbody>
                <tr><td>7/8″</td><td>~160 gpm</td></tr>
                <tr><td>15/16″</td><td>~185 gpm</td></tr>
                <tr><td>1 1/8″</td><td>~265 gpm</td></tr>
              </tbody>
            </table>
          </div>
          <div class="card">
            <caption>Rules of Thumb</caption>
            <ul style="margin:6px 0 0 18px">
              <li>Elevation: ~0.434 psi per foot</li>
              <li>Standpipe: start around 150 psi (check policy)</li>
              <li>Sprinkler on hydrant: often 100–150 psi to FDC (verify system)</li>
              <li>Wye/appliance loss: ~10 psi (if two flowing branches)</li>
              <li>Keep intake ≥ 20 psi residual</li>
            </ul>
          </div>
        </div>
      </section>
    </section>
  `;
  return { dispose(){} };
}

export default { render };
