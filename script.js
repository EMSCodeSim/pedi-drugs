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

  if (ageY > 0 && ageY <= 12) {
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
  // Adult = 12+ years (user definition)
  const range = (med["Age Range"] || "").toLowerCase().replace(/\s+/g, "");
  if (range === "all") return true;
  if (range === "adult") return ageY >= 12;
  if (range === "pediatric") return ageY < 12;
  if (/^\d+\+\s*(years)?$/.test(range)) {
    const min = parseFloat(range);
    return ageY >= min;
  }
  // Accept 0-11, 1-12, 0-3months, etc
  if (range.includes("months")) {
    // e.g. "0-3months"
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
    header.textContent = `${med.Medication || "Medication"}${med.Route ? " (" + med.Route + ")" : ""}`;

    const body = document.createElement("div");
    body.className = "dropdown-body";

    // Display all fields
    let allFields = '';
    Object.entries(med).forEach(([key, value]) => {
      allFields += `<div><strong>${key.replace(/_/g, " ")}:</strong> ${value}</div>`;
    });
    body.innerHTML = allFields;

    header.onclick = () => {
      body.style.display = body.style.display === "block" ? "none" : "block";
    };
    wrapper.appendChild(header);
    wrapper.appendChild(body);
    medList.appendChild(wrapper);
  });
}

// Load JSON file
fetch("./medications_by_complaint.json")
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
