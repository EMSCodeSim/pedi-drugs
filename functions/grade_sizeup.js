exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: "Method Not Allowed",
      };
    }

    const { transcript } = JSON.parse(event.body);
    const text = transcript.toLowerCase();

    const checklist = {
      unitId: ["medic", "ambulance", "engine", "rescue", "ems", "squad", "battalion"],
      incidentType: ["mvc", "mva", "motor vehicle", "collision", "crash", "accident"],
      numberOfVehicles: ["2 vehicle", "two vehicle", "multiple vehicle", "car vs", "2-car", "head-on", "rear-end"],
      numberOfPatients: ["1 patient", "2 patient", "multiple patients", "victims", "people in the car"],
      sceneSafety: ["scene is safe", "scene appears safe", "secured the scene", "no hazards", "scene is secure"],
      additionalResources: ["request fire", "request police", "need additional units", "backup requested", "hazmat", "air medical"],
      cspine: ["initiate c-spine", "manual stabilization", "c-spine precautions", "cervical collar"]
    };

    const score = {};
    const feedback = [];

    for (const [category, keywords] of Object.entries(checklist)) {
      const found = keywords.some(keyword => text.includes(keyword));
      score[category] = found;
      if (!found) {
        feedback.push(`🟥 Missing ${category.replace(/([A-Z])/g, ' $1')}: expected mention of something like "${keywords[0]}"`);
      }
    }

    const totalChecks = Object.keys(checklist).length;
    const points = Object.values(score).filter(Boolean).length;
    const percent = Math.round((points / totalChecks) * 100);

    const resultText = `
✅ **Scene Size-Up Grading Complete**
- You included ${points}/${totalChecks} major items (${percent}%)

${feedback.length === 0 ? "🟩 Excellent! All key elements were present." :
  feedback.join("\n")}
`;

    return {
      statusCode: 200,
      body: JSON.stringify({
        score: points,
        outOf: totalChecks,
        percent,
        detailed: score,
        feedback: resultText.trim()
      })
    };

  } catch (err) {
    console.error("Grading error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal grading error: " + err.message }),
    };
  }
};
