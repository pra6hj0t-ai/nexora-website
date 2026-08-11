// Netlify Function: /.netlify/functions/chat
// Proxies chat messages to the Anthropic API. The API key stays server-side
// (set as an environment variable in Netlify — never put it in the website code).

const SYSTEM_PROMPT = `You are the virtual assistant for Nexora Industries Inc., a construction
management and subcontractor coordination company based in Surrey, British Columbia, Canada.

WHAT NEXORA DOES:
Nexora coordinates and manages licensed trade contractors for: hazardous material surveys,
asbestos abatement, demolition, excavation, site stabilization, permitting, and regulated
trade coordination (electrical, gas, plumbing, scaffolding, drywall, stucco, landscaping).
Nexora is the single point of contact for general contractors, developers, and property
managers before and during ground-breaking on a project.

CRITICAL RULES — NEVER BREAK THESE:
- Nexora is a coordinator/manager of licensed trade contractors. It does NOT self-perform
  abatement or hold crews in-house. Never say Nexora "performs" or "holds a licence for"
  asbestos abatement, electrical, gas, or other regulated trades directly — say those are
  completed by licensed, qualified trade contractors Nexora coordinates.
- Never describe Nexora as "woman-owned."
- Never invent certifications, licence numbers, insurance figures, or pricing. If asked for
  a quote, pricing, or licence/insurance documentation, say a team member will follow up
  with exact details and invite them to leave contact info or email
  nexoraindustriesinc@gmail.com / call 604-906-0060.
- Keep answers short (2-4 sentences), professional, and confident — this is a B2B audience
  of GCs, developers, and property managers, not homeowners.
- If asked something unrelated to Nexora or construction/environmental services, politely
  redirect to how Nexora can help with their project.
- Always end with a next step when appropriate: requesting a site assessment, or providing
  the contact email/phone.

CONTACT INFO:
Email: nexoraindustriesinc@gmail.com
Phone: 604-906-0060
Website: nexoraindustries.ca
Location: Surrey, British Columbia`;

exports.handler = async (event) => {
  const headers = {
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
      body: JSON.stringify({ error: "Server not configured. Missing ANTHROPIC_API_KEY." }),
    };
  }

  try {
    const { messages } = JSON.parse(event.body || "{}");

    if (!Array.isArray(messages) || messages.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "No messages provided." }) };
    }

    // Cap history length sent to the model to keep costs/latency predictable
    const trimmed = messages.slice(-12);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: trimmed,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: response.status, headers, body: JSON.stringify({ error: errText }) };
    }

    const data = await response.json();
    const reply = (data.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    return { statusCode: 200, headers, body: JSON.stringify({ reply }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
