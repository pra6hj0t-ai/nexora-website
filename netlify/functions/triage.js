// Netlify Function: /.netlify/functions/triage
// Returns structured compliance-triage guidance for the Nexora client portal.
// The API key stays server-side (Netlify env var ANTHROPIC_API_KEY).
//
// SECURITY NOTE: this endpoint accepts ONLY known enum values plus one short
// free-text field. It cannot be driven as a general-purpose chatbot, which is
// what keeps it from being abused as free AI on your dime.

const ALLOWED = {
  situation: [
    "planning-demolition",
    "planning-renovation",
    "survey-positive",
    "material-disturbed",
    "due-diligence",
  ],
  buildingAge: ["pre-1990", "1990-2000", "post-2000", "unknown"],
  surveyStatus: ["complete", "partial", "none", "unknown"],
  workStarted: ["not-started", "in-progress", "disturbance-occurred"],
  propertyType: [
    "single-family",
    "multi-family",
    "commercial",
    "industrial",
    "institutional",
  ],
};

const SYSTEM_PROMPT = `You produce structured compliance-triage guidance for clients of
Nexora Industries Inc., a construction management and contractor coordination company in
Surrey, British Columbia. The audience is general contractors, developers, and property
owners — a B2B audience, not homeowners.

YOUR ROLE: orient the client on where they are in the process and what generally applies.
You are NOT a regulatory authority and you are NOT giving compliance advice.

ABSOLUTE RULES — NEVER BREAK THESE:
- NEVER cite specific regulation numbers, section numbers, or clause references.
- NEVER state specific notification periods, deadlines, fees, fines, or dollar figures.
- NEVER state that something IS or IS NOT legally required. Use "generally", "typically",
  "in most cases", and always pair it with confirming against WorkSafeBC.
- NEVER invent certifications, licence numbers, or insurance details.
- Nexora COORDINATES and MANAGES licensed trade contractors. It does NOT self-perform
  asbestos abatement, electrical, gas, or other regulated trades. Never say Nexora performs
  or is licensed for those. Say the work is completed by licensed, qualified trade
  contractors that Nexora engages and manages.
- Never describe Nexora as "woman-owned."
- If the client reports that material was disturbed unexpectedly, treat it as urgent: the
  first guidance must be to stop work in the affected area and get a qualified person
  involved before anyone continues.

OUTPUT FORMAT — return ONLY valid JSON, no markdown fences, no preamble:
{
  "stage": "one short sentence naming where this project actually is",
  "urgency": "routine" | "attention" | "urgent",
  "whatApplies": ["3-5 short plain-English points about what generally happens at this stage"],
  "confirmWith": ["2-4 specific things they should confirm with WorkSafeBC or their municipality"],
  "nexoraHandles": ["2-4 things Nexora would take on, phrased as coordination"],
  "nextStep": "one sentence naming the single most useful next action"
}

Keep every array item under 30 words. Plain English before jargon.`;

function bad(headers, msg) {
  return { statusCode: 400, headers, body: JSON.stringify({ error: msg }) };
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Server not configured. ANTHROPIC_API_KEY is not set in Netlify.",
      }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return bad(headers, "Invalid request body.");
  }

  // Strict validation — anything not on the allow-list is rejected outright.
  for (const field of Object.keys(ALLOWED)) {
    if (!ALLOWED[field].includes(payload[field])) {
      return bad(headers, "Unrecognised value for " + field + ".");
    }
  }

  const notes =
    typeof payload.notes === "string" ? payload.notes.trim().slice(0, 300) : "";

  const userMessage = [
    "Situation: " + payload.situation,
    "Building age: " + payload.buildingAge,
    "Hazardous materials survey: " + payload.surveyStatus,
    "Work status: " + payload.workStarted,
    "Property type: " + payload.propertyType,
    notes ? "Client notes: " + notes : "Client notes: none",
  ].join("\n");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 900,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: response.status, headers, body: JSON.stringify({ error: errText }) };
    }

    const data = await response.json();
    const raw = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "Could not read the assessment. Please try again." }),
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ result: parsed }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
