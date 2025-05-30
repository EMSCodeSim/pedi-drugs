// gradeSceneSizeup.js

export function gradeSceneSizeup(transcript) {
  const lowerText = transcript.toLowerCase();

  const gradingRubric = [
    {
      category: "Identification & Command",
      keywordMatch: ["on scene", "assuming command", "has command"],
      tip: "Start your report by identifying your unit and assuming command."
    },
    {
      category: "Structure Description",
      keywordMatch: ["residential", "commercial", "story", "apartment", "single family"],
      tip: "Include number of stories, construction type, and occupancy."
    },
    {
      category: "Smoke/Fire Conditions",
      keywordMatch: ["smoke", "flames", "fire showing", "heavy", "light"],
      tip: "Clearly describe smoke/fire location and severity."
    },
    {
      category: "Action Plan",
      keywordMatch: ["offensive", "defensive", "interior attack", "alpha side", "stretching a line"],
      tip: "State your initial strategy and entry point."
    },
    {
      category: "Additional Resources",
      keywordMatch: ["request", "additional", "second alarm", "ladder", "ems"],
      tip: "Request more units if needed — engines, ladders, EMS, etc."
    },
    {
      category: "Life Hazards/Victims",
      keywordMatch: ["trapped", "rescued", "occupant", "search", "victim"],
      tip: "Always note the presence or absence of known victims."
    },
    {
      category: "Water Supply",
      keywordMatch: ["hydrant", "water supply", "tanker", "relay"],
      tip: "Describe how you're getting water to the scene."
    },
    {
      category: "Radio Communications",
      keywordMatch: ["ops channel", "operations channel", "command channel", "tactical channel"],
      tip: "State that you’ve switched or requested an operations channel."
    },
    {
      category: "Exposures and Hazards",
      keywordMatch: ["power lines", "propane", "collapse", "hazard", "exposure"],
      tip: "Mention major hazards like power lines or nearby exposures."
    },
    {
      category: "Incident Naming",
      keywordMatch: ["command", "oak street", "main street command", "naming"],
      tip: "Assign a name to the incident for communication clarity."
    }
  ];

  let score = 0;
  const missedItems = [];
  const tips = [];
  const breakdown = [];

  gradingRubric.forEach(item => {
    const found = item.keywordMatch.some(keyword => lowerText.includes(keyword));
    if (found) {
      score += 1;
      breakdown.push({ category: item.category, status: "pass" });
    } else {
      missedItems.push(item.category);
      tips.push(item.tip);
      breakdown.push({ category: item.category, status: "fail" });
    }
  });

  return {
    score,
    maxScore: gradingRubric.length,
    missedItems,
    tips,
    breakdown
  };
}
