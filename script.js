let allMeds = {};

document.getElementById("ageValue").addEventListener("input", updateEstimate);
document.getElementById("ageUnit").addEventListener("change", updateEstimate);
document.getElementById("findBtn").addEventListener("click", loadMedications);
document.getElementById("allBtn").addEventListener("click", loadAllMedications);

function updateEstimate() {
  const age = parseFloat(document.getElementById("ageValue").value);
  const unit = document.getElementById("ageUnit").value;
  if (isNaN(age)) return;
  const ageY = unit === "months" ? age / 12 : unit === "days" ? age / 365 : age;

  const weightBox = document.getElementById("weightValue");
  const broselowBox = document.getElementById("broselowColor");
  broselowBox.innerHTML = "";

  if (ageY > 0 && ageY < 12) {
    const estWeight = 2 * ageY + 8;
    weightBox.value = estWeight.toFixed(1);
    document.getElementById("weightUnit").value = "kg";

    const broselowMap = {
      "Gray": 3, "Pink": 5, "Red": 8, "Purple": 10, "Yellow": 12,
      "White": 14, "Blue": 18, "Orange": 22, "Green": 26, "Lt Green": 30
    };
    for (let color in broselowMap) {
      const option = document.createElement("option");
      option.value = broselowMap[color];
      option.textContent = `${color} (${broselowMap[color]} kg)`;
      if (Math.abs(estWeight - broselowMap[color]) < 2) option.selected = true;
      broselowBox.appendChild(option);
    }
    broselowBox.style.display = "inline-block";
  } else {
    broselowBox.style.display = "none";
  }
}

function getAgeInYears() {
  const val = parseFloat(document.getElementById("ageValue").value);
  const unit = document.getElementById("ageUnit").value;
  if (unit === "months") return val / 12;
  if (unit === "days") return val / 365;
  return val;
}

function getWeightInKg() {
  const weight = parseFloat(document.getElementById("weightValue").value);
  const unit = document.getElementById("weightUnit").value;
  return unit === "lb" ? weight / 2.2046 : weight;
}

function isMedInAgeRange(med, ageY) {
  const range = (med["Age Range"] || "").toLowerCase().replace(/\s+/g, "");
  if (range === "all") return true;
  if (range === "adult") return ageY >= 12;
  if (range === "pediatric") return ageY < 12;
  if (/^\d+\+\s*(years)?$/.test(range)) {
    const min = parseFloat(range);
    return ageY >= min;
  }
  if (range.includes("months")) {
    let [min, max] = range.replace("months", "").split("-");
    min = parseFloat(min); max = parseFloat(max);
    const userMonths = getUserMonths();
    return userMonths >= min && userMonths <= max;
  }
  if (range.includes("years")) {
    let [min, max] = range.replace("years", "").split("-");
    min = parseFloat(min); max = parseFloat(max);
    return ageY >= min && ageY <= max;
  }
  if (range.includes("-")) {
    const [min, max] = range.split("-").map(Number);
    return ageY >= min && ageY <= max;
  }
  return false;
}

function getUserMonths() {
  const val = parseFloat(document.getElementById("ageValue").value);
  const unit = document.getElementById("ageUnit").value;
  if (unit === "years") return val * 12;
  if (unit === "days") return val / 30.44;
  return val;
}

function parseDosePerKg(doseStr) {
  // Match e.g., "1-2 mcg/kg" or "0.1 mg/kg"
  const match = doseStr.match(/([\d\.\-]+)\s*(mcg|mg)\/kg/i);
  if (match) {
    let [val, unit] = [match[1], match[2]];
    if (val.includes('-')) {
      let [low, high] = val.split('-').map(Number);
      val = (low + high) / 2;
    }
    return { val: parseFloat(val), unit: unit };
  }
  return null;
}

function parseConcentration(concStr) {
  // Match e.g., "50 mcg/mL", "1 mg/mL"
  const match = concStr.match(/([\d\.]+)\s*(mcg|mg)\/?m?L?/i);
  if (match) {
    return { val: parseFloat(match[1]), unit: match[2].toLowerCase() };
  }
  return null;
}

function convertDoseToConcUnits(dose, doseUnit, concUnit) {
  if (doseUnit === concUnit) return dose;
  if (doseUnit === "mg" && concUnit === "mcg") return dose * 1000;
  if (doseUnit === "mcg" && concUnit === "mg") return dose / 1000;
  return dose;
}

function displayMedications(meds, ageY, weightInKg) {
  const medList = document.getElementById("medList");
  medList.innerHTML = "";
  meds.forEach((med, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "dropdown";
    const header = document.createElement("div");
    header.className = "dropdown-header";
    header.textContent = `${med.Medication || "Medication"}${med.Route ? " (" + med.Route + ")" : ""}`;

    const body = document.createElement("div");
    body.className = "dropdown-body";

    let allFields = '';
    Object.entries(med).forEach(([key, value]) => {
      allFields += `<div><strong>${key.replace(/_/g, " ")}:</strong> ${value}</div>`;
    });

    let calcHtml = '';
    if (med.Dose && med.Concentration && /\/kg/i.test(med.Dose) && weightInKg > 0) {
      let doseInfo = parseDosePerKg(med.Dose);
      let concInfo = parseConcentration(med.Concentration);
      if (doseInfo && concInfo) {
        let { val: dosePerKg, unit: doseUnit } = doseInfo;
        let { val: concVal, unit: concUnit } = concInfo;
        let doseTotal = dosePerKg * weightInKg;
        let doseInConcUnits = convertDoseToConcUnits(doseTotal, doseUnit, concUnit);
        const concId = `concInput_${index}`;
        const mlAnsId = `mlAns_${index}`;
        calcHtml += `
          <div style="margin-top:10px;">
            <strong>Calculation:</strong>
            <div>
              Dose = <span class="highlight">${dosePerKg} ${doseUnit}/kg × ${weightInKg.toFixed(1)} kg = 
                <span class="highlight">${doseTotal.toFixed(2)} ${doseUnit}</span>
              </span>
            </div>
            <div>
              Volume = <span class="highlight">
                ${doseInConcUnits.toFixed(2)} ${concUnit} ÷ 
                <input type="number" step="any" value="${concVal}" id="${concId}" style="width:65px;"> ${concUnit}/mL = 
                <span id="${mlAnsId}" class="highlight">${(doseInConcUnits / concVal).toFixed(2)} mL</span>
              </span>
            </div>
            <button style="margin-top:6px;" onclick="
              document.getElementById('${mlAnsId}').innerText = 
                ((${doseInConcUnits.toFixed(5)}) / parseFloat(document.getElementById('${concId}').value || 1)).toFixed(2)
              ">Update mL</button>
            <div class="warning">Confirm all calculations before giving medication.</div>
          </div>
        `;
      }
    }

    body.innerHTML = allFields + calcHtml;

    header.onclick = () => {
      body.style.display = body.style.display === "block" ? "none" : "block";
    };
    wrapper.appendChild(header);
    wrapper.appendChild(body);
    medList.appendChild(wrapper);
  });
}

// USE THE CORRECT FETCH PATH HERE based on your file placement:
fetch("./medications_by_complaint.json")
// fetch("./data/medications_by_complaint.json")
  .then(res => res.json())
  .then(data => {
    allMeds = data;
    const select = document.getElementById("complaintSelect");
    select.innerHTML = `<option value="">-- Select Complaint --</option>`;
    Object.keys(data).forEach(k => {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = k.replace(/_/g, " ");
      select.appendChild(opt);
    });
  })
  .catch(err => {
    document.getElementById("complaintSelect").innerHTML = `<option value="">No Data</option>`;
  });
