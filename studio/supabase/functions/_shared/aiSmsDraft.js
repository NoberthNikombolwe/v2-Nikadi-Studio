// Shared logic for the SMS draft AI — used by the ai-sms-draft Edge Function and the Vite dev
// plugin. Plain JS with no browser/Node/Deno APIs (HTTP is passed in).

export const SMS_DRAFT_LIMITS = Object.freeze({ bodyBytes: 300_000, imageChars: 1_500_000 });

export const SMS_DRAFT_SYSTEM_PROMPT = `You are an SMS drafting assistant for Nikadi Studio, an event management platform used by event planners in Tanzania.

Your job is to draft a personalised SMS invitation message in Swahili for an event (wedding, birthday, corporate, etc.).

Use these placeholders exactly as shown — do not replace them with real names:
- {name} — the guest's name (always use this to personalise the greeting)
- {cardType} — the guest's invitation card type (e.g. Table 1, Single, Double, Group)

Here is a perfect example of the SMS style to follow:

---
Habari {name}! Familia ya MZEE SAMSON WA BUNDA MARA wanayo furaha kukualika kwenye harusi ya vijana wao wapendwa, PAUL SAMSON & FAITH HAMZA.

Ndoa itafungwa Jumamosi tarehe 21 NOV. 2026 katika kanisa la KKKT MADALE BETHEL saa 08:00 mchana na kufuatiwa na tafrija katika Ukumbi wa MALAIKA VILLA Makongo CCM Dar es Salaam saa 12:00 jioni.

Naomba upokee Kadi yako ya Mwaliko {cardType}

Dress code: Brown, Pink, Njano

Karibuni sana!

Mawasiliano zaidi:
0768 765 266
0714 478 670
0655 818 279
---

Rules:
- Always start with "Habari {name}!"
- Write in Swahili (use English only for proper nouns: venue names, place names, non-Swahili words)
- Write the host family name, couple names, and venue names in ALL CAPS
- Format times in Swahili style: "saa 08:00 mchana", "saa 12:00 jioni", "saa 03:00 usiku"
- Always include "Naomba upokee Kadi yako ya Mwaliko {cardType}" near the end
- Always end with "Karibuni sana!" followed by contact numbers if provided
- If an image is attached, read the event details from it (names, date, venue, dress code, contacts)
- Respond with ONLY the SMS text — no explanation, no preamble, no "Here is your SMS:" heading`;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// Detects JPEG/PNG/WebP from the first base64 bytes (same logic as dataClean.js)
function imageTypeOf(data) {
  let head = "";
  try { head = atob(String(data ?? "").slice(0, 16)); } catch { return ""; }
  if (head.startsWith("\xFF\xD8\xFF")) return "image/jpeg";
  if (head.startsWith("\x89PNG\r\n\x1A\n")) return "image/png";
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "image/webp";
  return "";
}

// Draft a single SMS from event details + an optional invitation card image.
// payload: { event: { name, type, date, venue, phones }, images?: [{ mime, data }] }
// Returns { status, body: { draft } } or { status, body: { error } }.
export async function runSmsDraft(payload, { apiKey, model, post }) {
  if (!payload || typeof payload !== "object")
    return { status: 400, body: { error: "Invalid request." } };

  const event  = payload.event ?? {};
  const images = Array.isArray(payload.images) ? payload.images : [];

  if (images.length > 1)
    return { status: 400, body: { error: "Only one image may be attached." } };

  const parts = [];

  for (const img of images) {
    const data = typeof img?.data === "string" ? img.data : "";
    if (!data) return { status: 400, body: { error: "An attached image could not be read." } };
    if (data.length > SMS_DRAFT_LIMITS.imageChars) return { status: 400, body: { error: "The image is too large." } };
    const mimeType = data.length % 4 === 0 && BASE64.test(data) ? imageTypeOf(data) : "";
    if (!mimeType) return { status: 400, body: { error: "Only JPEG, PNG or WebP images are accepted." } };
    parts.push({ inlineData: { mimeType, data } });
  }

  const lines = ["Draft an SMS invitation for this event:"];
  if (event.name)                                     lines.push(`Host / event name: ${event.name}`);
  if (event.type)                                     lines.push(`Event type: ${event.type}`);
  if (event.date)                                     lines.push(`Date: ${event.date}`);
  if (event.venue)                                    lines.push(`Venue: ${event.venue}`);
  const phones = Array.isArray(event.phones) ? event.phones.filter(Boolean) : [];
  if (phones.length)                                  lines.push(`Contact numbers: ${phones.join(", ")}`);
  if (images.length)                                  lines.push("(Refer to the attached image for event details.)");
  parts.push({ text: lines.join("\n") });

  const m   = model || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;

  let result;
  try {
    result = await post(url, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SMS_DRAFT_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 1024 },
      }),
    });
  } catch (e) {
    return { status: 502, body: { error: `Could not reach Gemini: ${e.message}` } };
  }

  if (result.status !== 200) {
    let detail = "";
    try { detail = JSON.parse(result.text)?.error?.message || ""; } catch { /* ignore */ }
    return { status: 502, body: { error: `Gemini returned ${result.status}${detail ? `: ${detail}` : ""}` } };
  }

  let parsed;
  try { parsed = JSON.parse(result.text); } catch {
    return { status: 502, body: { error: "Could not parse Gemini response." } };
  }
  const draft = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!draft) return { status: 502, body: { error: "Gemini returned an empty response." } };
  return { status: 200, body: { draft } };
}
