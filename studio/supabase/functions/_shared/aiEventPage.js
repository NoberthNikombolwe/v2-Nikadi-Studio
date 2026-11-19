// The Studio's "AI Design assistant" for event pages — shared by the ai-event-page Edge Function
// and the Vite dev server (vite.config.js). Plain JS with no browser/Node/Deno APIs (HTTP is passed in).

export const PAGE_LIMITS = Object.freeze({ messageChars: 8_000, totalChars: 40_000, turns: 20, bodyBytes: 100_000 });

export const PAGE_SYSTEM_PROMPT = `You are a design assistant for Nikadi Studio, an event management platform used by event planners in Tanzania. Your job is to suggest beautiful, modern, and culturally fitting designs for event web pages (weddings, birthday parties, corporate events, concerts, etc.).

When the user shares event details, respond with:
1. Two or three friendly, specific sentences explaining your design choices.
2. A JSON block at the very end of your message (always present, every reply):

\`\`\`json
{
  "suggestions": {
    "primary_color": "#hex",
    "accent_color": "#hex",
    "bg_color": "#hex",
    "text_color": "#hex",
    "tagline": "Short, evocative tagline for the event",
    "schedule": [{ "time": "10:00", "title": "Mapokezi", "description": "" }],
    "dress_code_text": "Description of the dress code (e.g. Black tie — formal attire required)"
  }
}
\`\`\`

Rules:
- Include only the fields you are confident about for this specific event.
- Omit "schedule" unless the user explicitly asks for one or shares a programme.
- Use only hex color values (e.g. "#1A237E", not "navy").
- bg_color is usually very dark (#0A0F1E style); text_color is almost always #FFFFFF.
- For weddings: elegant, gold/champagne/blush palettes; for birthdays: vibrant; for corporate: professional blues/greys.
- Always end with the JSON block even on follow-up questions; include only fields you are updating.
- Do NOT answer questions unrelated to event design. If asked something else, say in one sentence that you are only here to help with event page design.`;

// Build the Gemini request body from chat messages.
function buildGeminiBody(messages, model) {
  const systemInstruction = { parts: [{ text: PAGE_SYSTEM_PROMPT }] };
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.text || "").slice(0, PAGE_LIMITS.messageChars) }],
  }));
  return JSON.stringify({ system_instruction: systemInstruction, contents, generationConfig: { temperature: 0.9, maxOutputTokens: 2048 } });
}

export async function runEventPageChat(messages, { apiKey, model, post }) {
  if (!Array.isArray(messages) || messages.length === 0)
    return { status: 400, body: { error: "No messages provided." } };

  const totalChars = messages.reduce((n, m) => n + (m.text?.length || 0), 0);
  if (totalChars > PAGE_LIMITS.totalChars)
    return { status: 413, body: { error: "Chat history is too long — start a new conversation." } };

  const m = model || "gemini-flash-lite-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
  let result;
  try {
    result = await post(url, { headers: { "Content-Type": "application/json" }, body: buildGeminiBody(messages, m) });
  } catch (e) {
    return { status: 502, body: { error: `Could not reach Gemini: ${e.message}` } };
  }

  if (result.status !== 200) {
    let detail = "";
    try { detail = JSON.parse(result.text)?.error?.message || ""; } catch { /* ignore */ }
    return { status: 502, body: { error: `Gemini returned ${result.status}${detail ? `: ${detail}` : ""}` } };
  }

  let parsed;
  try { parsed = JSON.parse(result.text); } catch { return { status: 502, body: { error: "Could not parse Gemini response." } }; }
  const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return { status: 502, body: { error: "Gemini returned an empty response." } };
  return { status: 200, body: { text } };
}
