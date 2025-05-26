let allMeds = {};
const broselowMap = {
  "Gray": 3, "Pink": 5, "Red": 8, "Purple": 10, "Yellow": 12,
  "White": 14, "Blue": 18, "Orange": 22, "Green": 26, "Lt Green": 30
};

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

  if (ageY > 0 && ageY <= 12) {
    const estWeight = 2 * ageY + 8;
    weightBox.value = estWeight.toFixed(1);
    document.getElementById("weightUnit").value = "kg";

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

function getVitalsByAge(ageY) {
  if (ageY <= 1) return { hr: "100–160", rr: "30–60", sbp: "70–100" };
  if (ageY <= 3) return { hr: "90–150", rr: "24–40", sbp: "80–110" };
  if (ageY <= 5) return { hr: "80–140", rr: "22–34", sbp: "80–110" };
  if (ageY <= 8) return { hr: "70–120", rr: "18–30", sbp: "85–115" };
  if (ageY <= 12) return { hr: "60–100", rr: "18–24", sbp: "90–120" };
  return null;
}

function getAgeInYears() {
  const val = parseFloat(document.getElementById("ageValue").value);
  const unit = document.getElementById("ageUnit").value;
  return unit === "months" ? val / 12 : unit === "days" ? val / 365 : val;
}

function getWeightInKg() {
  const weight = parseFloat(document.getElementById("weightValue").value);
  const unit = document.getElementById("weightUnit").value;
  return unit === "lb" ? weight / 2.2046 : weight;
}

function isMedInAgeRange(med, ageY) {
  const range = (med["Age Range"] || "").toLowerCase();

  if (range.includes("all")) return true;
  if (range.includes("adult")) return ageY >= 12;
  if (range.includes("pediatric")) return ageY < 12;

  if (range.includes("-")) {
    const [min, max] = range.split("-").map(Number);
    return ageY >= min && ageY <= max;
  }
  if (range.includes("+")) {
    const min = parseFloat(range);
    return ageY >= min;
  }

  return false;
}

function loadMedications() {
  const ageY = getAgeInYears();
  const weightInKg = getWeightInKg();
  const complaint = document.getElementById("complaintSelect").value;
  if (!complaint || !allMeds[complaint]) return;
  const meds = allMeds[complaint].filter(med => isMedInAgeRange(med, ageY));
  displayMedications(meds, ageY, weightInKg);
}

function loadAllMedications() {
  const ageY = getAgeInYears();
  const weightInKg = getWeightInKg();
  const allMatches = [];
  for (let section in allMeds) {
    allMatches.push(...allMeds[section].filter(med => isMedInAgeRange(med, ageY)));
  }
  displayMedications(allMatches, ageY, weightInKg);
}

function displayMedications(meds, ageY, weightInKg) {
  const medList = document.getElementById("medList");
  medList.innerHTML = "";
  meds.forEach((med, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "dropdown";
    const header = document.createElement("div");
    header.className = "dropdown-header";
    header.textContent = `${med.Medication} (${med.Route})`;
    const body = document.createElement("div");
    body.className = "dropdown-body";

    // Show all fields in the order present in JSON
    let allFields = "";
    for (let key in med) {
      allFields += `<strong>${key.replace(/_/g, " ")}:</strong> ${med[key]}<br>`;
    }

    // Weight-based calculation
    let concentration = med.Concentration;
    let calcHtml = "";

    // Check if the dose is weight-based (mg/kg or mcg/kg)
    let doseMatch = med.Dose && med.Dose.match(/([\d\.\-]+)\s*(mg|mcg)\/kg/i);
    let concMatch = concentration && concentration.match(/([\d\.]+)\s*(mg|mcg)\/?m?L?/i);

    const concInputId = `concInput_${index}`;
    const mlAnsId = `mlAns_${index}`;

    if (doseMatch && concMatch && weightInKg > 0) {
      let dosePerKg = doseMatch[1].includes('-') ? 
          (doseMatch[1].split('-').map(Number).reduce((a,b)=>a+b,0)/2) : 
          parseFloat(doseMatch[1]);
      let doseUnit = doseMatch[2].toLowerCase();
      let concVal = parseFloat(concMatch[1]);
      let concUnit = concMatch[2].toLowerCase();

      let totalDose = dosePerKg * weightInKg;
      let totalDoseDisplay = totalDose.toFixed(2) + " " + doseUnit;

      let doseForMl = totalDose;
      // Convert dose unit to match conc unit for mL calculation
      if (doseUnit !== concUnit) {
        if (doseUnit === "mg" && concUnit === "mcg") doseForMl = totalDose * 1000;
        if (doseUnit === "mcg" && concUnit === "mg") doseForMl = totalDose / 1000;
      }

      let volume = concVal > 0 ? doseForMl / concVal : 0;
      let volumeDisplay = isNaN(volume) ? "?" : volume.toFixed(2);

      calcHtml = `
        <br><strong>Calculation:</strong><br>
        Dose = <span class="highlight">${dosePerKg} ${doseUnit}/kg × ${weightInKg.toFixed(1)} kg = <span class="highlight">${totalDoseDisplay}</span></span><br>
        Volume = <span class="highlight">
          ${doseForMl.toFixed(2)} ${concUnit} ÷ 
          <input type="number" min="0" step="any" id="${concInputId}" value="${concVal}" style="width:65px;"> ${concUnit}/mL =
          <span id="${mlAnsId}" class="highlight">${volumeDisplay} mL</span>
        </span><br>
        <div class="warning">⚠️ Confirm all calculations before administering medications.</div>
      `;
    }

    body.innerHTML = allFields + calcHtml;

    header.onclick = () => {
      body.style.display = body.style.display === "block" ? "none" : "block";
    };
    wrapper.appendChild(header);
    wrapper.appendChild(body);
    medList.appendChild(wrapper);

    // Attach live update handler for concentration field
    if (doseMatch && concMatch && weightInKg > 0) {
      setTimeout(() => {
        const input = document.getElementById(concInputId);
        if (input) {
          input.addEventListener("input", function () {
            let dosePerKg = doseMatch[1].includes('-') ? 
              (doseMatch[1].split('-').map(Number).reduce((a,b)=>a+b,0)/2) : 
              parseFloat(doseMatch[1]);
            let doseUnit = doseMatch[2].toLowerCase();
            let concUnit = concMatch[2].toLowerCase();
            let totalDose = dosePerKg * weightInKg;
            let doseForMl = totalDose;
            if (doseUnit !== concUnit) {
              if (doseUnit === "mg" && concUnit === "mcg") doseForMl = totalDose * 1000;
              if (doseUnit === "mcg" && concUnit === "mg") doseForMl = totalDose / 1000;
            }
            let concValNew = parseFloat(input.value);
            let volume = concValNew > 0 ? doseForMl / concValNew : 0;
            document.getElementById(mlAnsId).textContent = isNaN(volume) ? "?" : volume.toFixed(2) + " mL";
          });
        }
      }, 50);
    }
  });
}

// Make sure path is correct for your setup!
fetch("./medications_by_complaint.json")
  .then(res => res.json())
  .then(data => {
    allMeds = data;
    const select = document.getElementById("complaintSelect");
    select.innerHTML = ""; // clear previous
    Object.keys(data).forEach(k => {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = k;
      select.appendChild(opt);
    });
  });
