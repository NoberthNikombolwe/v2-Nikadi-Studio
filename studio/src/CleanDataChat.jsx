import { useState, useRef, useEffect, useMemo, useId, Fragment } from "react";
import Icon from "./Icon";
import { N, alpha } from "./lib/theme";
import { supabase } from "./lib/supabase";
import { localDate } from "./lib/crm";
import { CLEAN_LIMITS, CLEAN_IMAGE_LIMITS, CLEAN_EXAMPLE, parseMarkdown, parseInline, stripInline, guestColumn, guestRowsFromBlocks, guestSheetRows, guestsToTsv,
  guestGaps, chatForApi, cleanFileName, turnParts, guestsToMarkdown, dropRepeatedGuests, checkAnswer, applyStatedTypes,
  photoFileProblem, fitImageSize, base64Length, sendPhotoAsIs, PHOTO_STEPS } from "./lib/dataClean";

// The Studio's data-cleaning chat: a floating "Clean data" button (Design, VCard, SMS, WhatsApp
// and Batch & Send) that opens a chat with Gemini. The user pastes a messy guest list and gets
// back clean Markdown tables (Name, Phone, CrdType), which can become the event's guest list,
// an Excel file or rows to paste.
//
// Gemini is asked through the ai-clean Edge Function (the Vite dev server in dev), which holds
// the API key and the bot's fixed instructions — see supabase/functions/_shared/dataClean.js.
// The chat lives only in memory (it holds guests' phone numbers): it survives switching tabs
// because <App> keeps this mounted, and is gone on reload. Like every pop-up here it closes
// only with its own button.
//
// Photos and screenshots of a list can be attached (the photo button, paste or drag and
// drop), several per message. They are shrunk here in the browser, kept in memory with the
// chat, sent to Gemini only with the message they belong to, and never saved anywhere (no
// Storage upload, nothing in the database). New chat, reload or sign-out drops them.
//
// Props: visible (on a Studio page), eventName, canUseGuests + onUseGuests(sheetRows) (load
// the rows like an uploaded spreadsheet), askDialog, showToast — all from <App>.

const AI_CLEAN_URL = import.meta.env.DEV ? "/ai-clean" : "/api/ai-clean";

// An Error with a readable message and the HTTP status (0 = no answer)
const cleanerError = (message, status = 0) => Object.assign(new Error(message), { status });

// One question to the data cleaner → { text, truncated }. Throws a cleanerError (or the
// AbortError when the request was stopped).
const askCleaner = async (messages, signal) => {
  const headers = { "Content-Type": "application/json" };
  const { data } = supabase ? await supabase.auth.getSession() : { data: null };
  const token = data?.session?.access_token;
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (!import.meta.env.DEV) throw new Error("You are not signed in — sign in again.");
  let res;
  try {
    res = await fetch(AI_CLEAN_URL, { method: "POST", headers, body: JSON.stringify({ messages }), signal });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw cleanerError("Could not reach the data cleaner — check your connection and try again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body?.error) throw cleanerError(body.error, res.status);
    if (res.status === 404) throw cleanerError("The data cleaner is not installed yet — deploy the ai-clean function (README).", 404);
    throw cleanerError(`The data cleaner failed (HTTP ${res.status}) — try again.`, res.status);
  }
  if (!body?.text) throw cleanerError("Gemini returned an empty answer — try again.", 502);
  return { text: body.text, truncated: !!body.truncated };
};

// askCleaner, trying again after 3 s and then 12 s when Gemini was busy (429: the free tier
// allows only so many requests a minute) or briefly unavailable
const RETRY_WAITS_MS = [3000, 12000];
const askWithRetry = async (messages, signal) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await askCleaner(messages, signal);
    } catch (e) {
      if (e?.name === "AbortError" || attempt >= RETRY_WAITS_MS.length || ![0, 429, 502, 503, 504].includes(e?.status)) throw e;
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, RETRY_WAITS_MS[attempt]);
        signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Stopped", "AbortError")); }, { once: true });
      });
    }
  }
};

// A turn asked in parts (turnParts: a long list cut into parts, or one photo per question),
// three at a time, then joined into one answer → { text, truncated, repeated, unread }.
// repeated: guests found on more than one photo and kept once; unread: the numbers of the
// photos in which no guest list was found. onProgress(partsDone) after each part. The first
// part that fails stops the rest and is reported as "Part n of N: …" or "Photo n: …".
const cleanInParts = async (parts, signal, onProgress) => {
  const answers = new Array(parts.length);
  let photoNo = 0;
  const labels = parts.map((p, i) => p.images.length ? `Photo ${++photoNo}` : `Part ${i + 1} of ${parts.length}`);
  let next = 0, done = 0, failed = false;
  const worker = async () => {
    while (next < parts.length && !failed) {
      const i = next++;
      const { text, images } = parts[i];
      try {
        answers[i] = await askWithRetry([images.length ? { role: "user", text, images } : { role: "user", text }], signal);
      } catch (e) {
        failed = true;
        if (e?.name === "AbortError") throw e;
        throw cleanerError(`${labels[i]}: ${e?.message || "it failed"}`, e?.status);
      }
      onProgress(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, parts.length) }, worker));
  const found = answers.map(a => guestRowsFromBlocks(parseMarkdown(a.text)));
  const fromPhotos = parts.some(p => p.images.length);
  const { guests, repeated } = fromPhotos ? dropRepeatedGuests(found.flat()) : { guests: found.flat(), repeated: 0 };
  const unread = guests.length ? labels.filter((l, i) => parts[i].images.length && !found[i].length) : [];
  return {
    text: guests.length ? guestsToMarkdown(guests) : answers.map(a => a.text).join("\n\n"),
    truncated: answers.some(a => a.truncated),
    repeated,
    unread,
  };
};

/* ── Photos ── */

const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("unreadable"));
  img.src = url;
});
const canvasJpeg = (canvas, quality) => new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
const blobBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

// A picked photo made ready for the chat, here in the browser → { id, name, mime, data
// (base64), url (an in-memory preview), width, height }. A small PNG / WebP screenshot is
// kept as it is; anything else is redrawn as a JPEG (the right way up, at most
// CLEAN_IMAGE_LIMITS.maxSide pixels, smaller until it fits imageChars). Throws an Error with
// a message for the user.
const preparePhoto = async (file, id) => {
  const problem = photoFileProblem(file);
  if (problem) throw new Error(problem);
  const name = file.name || "Photo";
  const src = URL.createObjectURL(file);
  try {
    let img;
    try {
      img = await loadImage(src);
    } catch {
      throw new Error(`${name} could not be opened — attach a JPEG or PNG (for an iPhone HEIC photo, take a screenshot of it)`);
    }
    let blob = null;
    let size = { width: img.naturalWidth, height: img.naturalHeight };
    if (sendPhotoAsIs(file.type, file.size, size.width, size.height)) {
      blob = file;
    } else {
      const fit = fitImageSize(size.width, size.height);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      for (const step of PHOTO_STEPS) {
        size = { width: Math.max(1, Math.round(fit.width * step.scale)), height: Math.max(1, Math.round(fit.height * step.scale)) };
        canvas.width = size.width;
        canvas.height = size.height;
        ctx.fillStyle = "#fff";   // a transparent screenshot would turn black as a JPEG
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.drawImage(img, 0, 0, size.width, size.height);
        const out = await canvasJpeg(canvas, step.quality);
        if (out && base64Length(out.size) <= CLEAN_IMAGE_LIMITS.imageChars) { blob = out; break; }
      }
      canvas.width = canvas.height = 0;   // lets the browser free the canvas memory now
      if (!blob) throw new Error(`${name} could not be made small enough — crop it and try again`);
    }
    const data = await blobBase64(blob);
    return { id, name, mime: blob.type || "image/jpeg", data, url: URL.createObjectURL(blob), width: size.width, height: size.height };
  } finally {
    URL.revokeObjectURL(src);
  }
};

// The image files in a paste (a screenshot copied to the clipboard). Pasted text wins: rows
// copied from Excel also carry a picture of the cells, which should paste as text.
const pastedPhotos = (clipboard) => {
  if (!clipboard || clipboard.getData("text/plain")) return [];
  return [...(clipboard.items || [])].filter(it => it.kind === "file" && /^image\//.test(it.type)).map(it => it.getAsFile()).filter(Boolean);
};
const dragHasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");

const RULES = ["Symbols and list numbers removed", "Phones as 07…", "Mr. & Mrs. and Title Case", "DOUBLE / SINGLE"];

const CSS = `
  .cb-fab { position: fixed; right: 24px; bottom: 24px; z-index: 410; display: inline-flex; align-items: center; gap: 8px;
    height: 48px; padding: 0 20px 0 16px; border-radius: 24px; border: none; cursor: pointer; color: #fff;
    background: linear-gradient(135deg, ${N.accent}, ${N.purple}); font: 700 14px 'Plus Jakarta Sans', sans-serif;
    box-shadow: 0 8px 24px var(--nk-shadow); transition: transform .15s ease; animation: cbIn .2s ease; }
  .cb-fab:hover { transform: translateY(-2px); }
  .cb-fab:focus-visible { outline: 2px solid ${N.sky}; outline-offset: 3px; }
  .cb-fab .nk-icon { width: 20px; height: 20px; }
  .cb-fab-busy { position: absolute; top: 2px; right: 2px; width: 12px; height: 12px; border-radius: 50%; background: ${N.amber}; border: 2px solid ${N.navy900}; }

  .cb-panel { position: fixed; right: 24px; bottom: 24px; z-index: 450; width: 440px; max-width: calc(100vw - 48px);
    height: min(680px, calc(100vh - 48px)); display: flex; flex-direction: column; overflow: hidden;
    background: ${N.navy800}; border: 1px solid ${N.border}; border-radius: 18px; box-shadow: 0 24px 80px var(--nk-shadow);
    animation: cbIn .2s ease; }
  .cb-panel, .cb-panel *, .cb-fab { box-sizing: border-box; }
  .cb-head { display: flex; align-items: center; gap: 10px; padding: 12px 10px 12px 14px; border-bottom: 1px solid ${N.border}; }
  .cb-head-ic { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; flex-shrink: 0; color: #fff;
    background: linear-gradient(135deg, ${N.accent}, ${N.purple}); }
  .cb-title { font-weight: 800; font-size: 15px; color: ${N.text}; line-height: 1.2; }
  .cb-sub { font-size: 11px; color: ${N.textDim}; }
  .cb-icon-btn { width: 36px; height: 36px; border-radius: 8px; border: none; background: transparent; color: ${N.textDim};
    cursor: pointer; display: grid; place-items: center; font-size: 17px; flex-shrink: 0; }
  .cb-icon-btn:hover { background: ${N.navy700}; color: ${N.text}; }
  .cb-icon-btn:focus-visible { outline: 2px solid ${N.accent}; outline-offset: -2px; }
  .cb-icon-btn:disabled { opacity: .4; cursor: not-allowed; background: transparent; }

  .cb-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 12px; }
  .cb-msg { flex-shrink: 0; font-size: 13px; line-height: 1.55; color: ${N.text}; }   /* a long chat scrolls; messages keep their height */
  .cb-user { align-self: flex-end; max-width: 88%; max-height: 200px; overflow-y: auto; padding: 9px 12px; font-size: 12.5px;
    white-space: pre-wrap; word-break: break-word; border-radius: 14px 14px 4px 14px;
    background: ${alpha(N.accent, "22")}; border: 1px solid ${alpha(N.accent, "44")}; }
  .cb-bot { align-self: stretch; min-width: 0; max-width: 100%; padding: 12px; border-radius: 14px 14px 14px 4px; background: ${N.navy700}; border: 1px solid ${N.border}; }
  .cb-bot-err { background: ${N.redBg}; border-color: ${alpha(N.red, "55")}; color: ${N.red}; }
  .cb-row { display: flex; gap: 8px; align-items: flex-start; }
  .cb-row .nk-icon { margin-top: 3px; }
  .cb-thinking { display: flex; align-items: center; gap: 10px; color: ${N.textDim}; font-size: 12.5px; }
  .cb-h { font-weight: 800; font-size: 13px; color: ${N.text}; margin: 2px 0 8px; }
  .cb-p { margin: 0 0 8px; }
  .cb-p:last-child { margin-bottom: 0; }
  .cb-list { margin: 0 0 8px 18px; }
  .cb-hr { border: none; border-top: 1px solid ${N.border}; margin: 8px 0; }
  .cb-code { font-family: 'JetBrains Mono', monospace; font-size: 12px; background: ${N.navy600}; padding: 1px 5px; border-radius: 4px; }
  .cb-tablewrap { overflow-x: auto; margin: 0 0 10px; border: 1px solid ${N.border}; border-radius: 10px; background: ${N.navy800}; }
  .cb-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .cb-table th { text-align: left; padding: 7px 10px; background: ${N.navy600}; color: ${N.textMid}; font-size: 10.5px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .4px; white-space: nowrap; }
  .cb-table td { padding: 6px 10px; border-top: 1px solid ${N.border}; white-space: nowrap; }
  .cb-table td em { color: ${N.amber}; }

  .cb-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 2px; padding-top: 10px; border-top: 1px dashed ${N.border}; }
  .cb-count { flex-basis: 100%; font-size: 11.5px; color: ${N.textDim}; }
  .cb-count b { color: ${N.text}; }
  .cb-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px; border-radius: 8px; cursor: pointer;
    border: 1.5px solid ${N.border}; background: transparent; color: ${N.textMid}; font: 600 12px 'Plus Jakarta Sans', sans-serif; }
  .cb-btn:hover { border-color: ${N.accent}; color: ${N.sky}; }
  .cb-btn:focus-visible { outline: 2px solid ${N.accent}; outline-offset: 1px; }
  .cb-btn-primary { background: ${N.accent}; border-color: ${N.accent}; color: #fff; }
  .cb-btn-primary:hover { color: #fff; filter: brightness(1.1); }
  .cb-note { display: flex; gap: 6px; align-items: flex-start; margin-top: 8px; font-size: 11.5px; color: ${N.amber}; }
  .cb-note .nk-icon { margin-top: 2px; }
  .cb-meta { margin-top: 6px; font-size: 11px; color: ${N.textDim}; }
  .cb-table td.cb-flag { color: ${N.red}; font-weight: 700; background: ${N.redBg}; }
  .cb-table td.cb-flag .nk-icon { vertical-align: -0.15em; }

  .cb-intro { padding: 4px 2px; font-size: 13px; line-height: 1.55; color: ${N.textMid}; }
  .cb-intro .cb-h { font-size: 15px; }
  .cb-rules { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 14px; }
  .cb-rule { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; padding: 4px 9px; border-radius: 999px;
    background: ${N.navy700}; border: 1px solid ${N.border}; color: ${N.textMid}; }
  .cb-rule .nk-icon { color: ${N.green}; }
  .cb-privacy { display: flex; gap: 6px; align-items: flex-start; margin-top: 16px; font-size: 11px; color: ${N.textDim}; }
  .cb-privacy .nk-icon { margin-top: 2px; }

  .cb-foot { border-top: 1px solid ${N.border}; padding: 10px 12px 12px; }
  .cb-input-row { display: flex; gap: 8px; align-items: flex-end; }
  .cb-input { flex: 1; resize: none; min-height: 44px; max-height: 160px; padding: 11px 12px; border-radius: 12px; outline: none;
    border: 1.5px solid ${N.border}; background: ${N.navy900}; color: ${N.text}; font: 13px/1.45 'Plus Jakarta Sans', sans-serif; }
  .cb-input:focus { border-color: ${N.accent}; }
  .cb-input::placeholder { color: ${N.textDim}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cb-send { width: 44px; height: 44px; flex-shrink: 0; border-radius: 12px; border: none; cursor: pointer; display: grid; place-items: center;
    background: ${N.accent}; color: #fff; font-size: 18px; }
  .cb-send:disabled { opacity: .45; cursor: not-allowed; }
  .cb-send:focus-visible { outline: 2px solid ${N.sky}; outline-offset: 2px; }
  .cb-hint { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; font-size: 10.5px; color: ${N.textDim}; }
  .cb-hint .cb-over { color: ${N.red}; font-weight: 700; }
  .cb-hint-photos { display: inline-flex; align-items: center; gap: 5px; }

  /* Photos: the attach button, the tray of photos waiting to be sent, and those in a message */
  .cb-attach { width: 44px; height: 44px; flex-shrink: 0; border-radius: 12px; cursor: pointer; display: grid; place-items: center;
    border: 1.5px solid ${N.border}; background: transparent; color: ${N.textMid}; font-size: 18px; }
  .cb-attach:hover { border-color: ${N.accent}; color: ${N.sky}; }
  .cb-attach:focus-visible { outline: 2px solid ${N.sky}; outline-offset: 2px; }
  .cb-attach:disabled { opacity: .45; cursor: not-allowed; }
  .cb-tray { display: flex; gap: 8px; overflow-x: auto; padding: 2px 2px 8px; }
  .cb-tray-item { position: relative; flex-shrink: 0; width: 60px; height: 60px; border-radius: 10px; overflow: hidden;
    border: 1px solid ${N.border}; background: ${N.navy900}; }
  .cb-tray-wait { display: grid; place-items: center; color: ${N.textDim}; }
  .cb-tray-x { position: absolute; top: 3px; right: 3px; width: 24px; height: 24px; padding: 0; border-radius: 50%; border: none; cursor: pointer;
    display: grid; place-items: center; background: rgba(0, 0, 0, .65); color: #fff; font-size: 13px; }
  .cb-tray-x:focus-visible { outline: 2px solid ${N.sky}; outline-offset: 1px; }
  .cb-thumbs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
  .cb-thumbs:last-child { margin-bottom: 0; }
  .cb-thumb { display: block; width: 56px; height: 56px; border-radius: 8px; overflow: hidden; border: 1px solid ${alpha(N.accent, "55")}; background: ${N.navy900}; }
  .cb-thumb:focus-visible { outline: 2px solid ${N.sky}; outline-offset: 1px; }
  .cb-thumb img, .cb-tray-item img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .cb-drop { position: absolute; inset: 8px; z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
    border-radius: 14px; border: 2px dashed ${N.accent}; background: ${alpha(N.navy900, 0.92)}; color: ${N.sky}; font-weight: 700; font-size: 14px;
    pointer-events: none; }
  .cb-drop .nk-icon { width: 32px; height: 32px; }

  @keyframes cbIn { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }

  /* Phones: a round button above the bottom navigation; the chat fills the screen */
  @media (max-width: 760px) {
    .cb-fab { right: 16px; bottom: calc(82px + env(safe-area-inset-bottom, 0px)); width: 54px; height: 54px; padding: 0;
      justify-content: center; border-radius: 50%; }
    .cb-fab-label { display: none; }
    .cb-panel { inset: 0; width: auto; max-width: none; height: auto; border: none; border-radius: 0; z-index: 650; }
    .cb-foot { padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)); }
    .cb-input { font-size: 16px; }
    .cb-hint-keys { display: none; }
  }
`;

// Bold / italic / code inside a line of Gemini's answer (React elements, never HTML)
function Inline({ text }) {
  return parseInline(String(text ?? "").replace(/<br\s*\/?>/gi, " ")).map((p, i) =>
    p.bold ? <strong key={i}>{p.text}</strong>
    : p.italic ? <em key={i}>{p.text}</em>
    : p.code ? <code key={i} className="cb-code">{p.text}</code>
    : <Fragment key={i}>{p.text}</Fragment>);
}

// `flags` (from checkAnswer): phones — numbers to mark in red in the Phone column;
// types — Map(phone → the card type the list states) to mark that row's card type
function Markdown({ blocks, flags }) {
  return blocks.map((b, i) => {
    if (b.type === "heading") return <div key={i} className="cb-h"><Inline text={b.text} /></div>;
    if (b.type === "rule") return <hr key={i} className="cb-hr" />;
    if (b.type === "list") {
      const List = b.ordered ? "ol" : "ul";
      return <List key={i} className="cb-list">{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</List>;
    }
    if (b.type === "table") {
      const phoneCol = b.header.findIndex(h => guestColumn(h) === "phone");
      const typeCol = b.header.findIndex(h => guestColumn(h) === "cardType");
      // Why a cell is marked, or null
      const flagOf = (row, c) => {
        const phone = phoneCol < 0 ? "" : stripInline(row[phoneCol]);
        if (c === phoneCol && flags?.phones.has(phone)) return "Check this number: it isn't in your list, or isn't a 10-digit 0… number";
        if (c === typeCol && flags?.types.has(phone)) return `Your list says ${flags.types.get(phone) || "no card type"} for this guest`;
        return null;
      };
      return (
        <div key={i} className="cb-tablewrap">
          <table className="cb-table">
            <thead><tr>{b.header.map((h, c) => <th key={c} scope="col"><Inline text={h} /></th>)}</tr></thead>
            <tbody>{b.rows.map((r, ri) => (
              <tr key={ri}>{r.map((cell, c) => {
                const why = flagOf(r, c);
                return why
                  ? <td key={c} className="cb-flag" title={why}><Icon n="alert" /> <Inline text={cell} /></td>
                  : <td key={c}><Inline text={cell} /></td>;
              })}</tr>
            ))}</tbody>
          </table>
        </div>
      );
    }
    return <p key={i} className="cb-p">{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}<Inline text={l} /></Fragment>)}</p>;
  });
}

// A few numbers for a warning: "0712…, 0754… and 3 more"
const someNumbers = (list) => list.length <= 3 ? list.join(", ") : `${list.slice(0, 3).join(", ")} and ${list.length - 3} more`;
// "Photo 2", "Photo 2 and Photo 4", "Photo 1, Photo 2 and Photo 4"
const andList = (list) => list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;

// How an answer asked in parts was made (cleanInParts)
const partsNote = (msg) => {
  const how = msg.photos > 1 ? "Each photo was read on its own, then everything was joined into one list."
    : msg.photos ? `Your typed list and the photo were read in ${msg.parts} parts, then joined into one list.`
    : `Cleaned in ${msg.parts} parts so no one is missed, then joined into one list.`;
  const r = msg.repeated || 0;
  return r ? `${how} ${r} guest${r === 1 ? "" : "s"} found twice (on overlapping photos) ${r === 1 ? "is" : "are"} listed once.` : how;
};

// One answer from the bot: its tables, checked against what the user typed (checkAnswer), and
// what can be done with the guests in them
function BotAnswer({ msg, canUseGuests, onUse, onExcel, onCopy, onFixTypes }) {
  const blocks = useMemo(() => parseMarkdown(msg.text), [msg.text]);
  const guests = useMemo(() => guestRowsFromBlocks(blocks), [blocks]);
  const check = useMemo(() => checkAnswer(guests, msg.turnText, msg.allText, { photos: msg.photos }), [guests, msg.turnText, msg.allText, msg.photos]);
  const flagged = useMemo(() => new Set([...check.notInList, ...check.badFormat]), [check]);
  const flags = useMemo(() => ({ phones: flagged, types: check.typeDiffers }), [flagged, check]);
  const typeCount = check.typeDiffers.size;
  const gaps = guestGaps(guests);
  return (
    <div className="cb-msg cb-bot">
      <Markdown blocks={blocks} flags={flags} />
      {msg.parts > 1 && <div className="cb-meta">{partsNote(msg)}</div>}
      {msg.truncated && (
        <div className="cb-note"><Icon n="alert" /> <span>The answer was cut off before the end. Send the rest of the list in a new message.</span></div>
      )}
      {guests.length > 0 && msg.photos > 0 && (
        <div className="cb-note"><Icon n="image" />
          <span>Read from {msg.photos === 1 ? "a photo" : `${msg.photos} photos`}: check every name and number against {msg.photos === 1 ? "it" : "them"} before you send cards. Numbers read from a photo can't be checked against what you typed.</span>
        </div>
      )}
      {msg.unread?.length > 0 && (
        <div className="cb-note"><Icon n="alert" />
          <span>No guest list was found in {andList(msg.unread)}. Attach a clearer photo of {msg.unread.length === 1 ? "it" : "them"} in a new message.</span>
        </div>
      )}
      {guests.length > 0 && check.missing.length > 0 && (
        <div className="cb-note"><Icon n="alert" />
          <span>{check.missing.length} number{check.missing.length === 1 ? "" : "s"} from your message {check.missing.length === 1 ? "is" : "are"} not in the table: {someNumbers(check.missing)}. Ask for {check.missing.length === 1 ? "it" : "them"} to be added, or add {check.missing.length === 1 ? "it" : "them"} by hand.</span>
        </div>
      )}
      {flagged.size > 0 && (
        <div className="cb-note"><Icon n="alert" />
          <span>{flagged.size} number{flagged.size === 1 ? "" : "s"} in the table {flagged.size === 1 ? "is" : "are"} marked in red: {msg.photos
            ? "not a 10-digit 0… number (a ? stands for a digit the photo didn't show clearly)"
            : "not found in your messages, or not a 10-digit 0… number"}. Check {flagged.size === 1 ? "it" : "them"} before sending cards.</span>
        </div>
      )}
      {typeCount > 0 && (
        <div className="cb-note"><Icon n="alert" />
          <span>
            {typeCount} card type{typeCount === 1 ? "" : "s"} {typeCount === 1 ? "differs" : "differ"} from what your list says (marked in red).
            <button type="button" className="cb-btn" style={{ marginTop: 6 }} onClick={() => onFixTypes(msg.id, applyStatedTypes(guests, check.typeDiffers))}>
              <Icon n="check" /> Use the card types from my list
            </button>
          </span>
        </div>
      )}
      {guests.length > 0 && (
        <div className="cb-actions">
          <div className="cb-count">
            <b>{guests.length}</b> guest{guests.length === 1 ? "" : "s"}
            {gaps.noPhone > 0 && <> · {gaps.noPhone} without a phone</>}
            {gaps.noCardType > 0 && <> · {gaps.noCardType} without a card type</>}
          </div>
          {canUseGuests && (
            <button type="button" className="cb-btn cb-btn-primary" onClick={() => onUse(guests, check.missing.length + flagged.size + typeCount)}><Icon n="users" /> Use as guest list</button>
          )}
          <button type="button" className="cb-btn" onClick={() => onExcel(guests)} title="Download as an Excel file you can upload later">
            <Icon n="download" /> Excel
          </button>
          <button type="button" className="cb-btn" onClick={() => onCopy(guests)} title="Copy as rows to paste into Excel or Google Sheets">
            <Icon n="copy" /> Copy
          </button>
        </div>
      )}
    </div>
  );
}

export default function CleanDataChat({ visible, eventName, canUseGuests, onUseGuests, askDialog, showToast }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);   // [{ id, role: "user" | "model", text?, images?, error?, truncated?, photos? }]
  const [input, setInput] = useState("");
  const [photos, setPhotos] = useState([]);       // attached to the next message (preparePhoto results), in memory only
  const [preparing, setPreparing] = useState(0);  // photos still being read and shrunk
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);   // { done, total, photos } while a turn is asked in parts
  const ctrlRef = useRef(null);    // the request in flight (stopped by Stop / New chat)
  const idRef = useRef(0);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  // The tray's bookkeeping. count: photos in it plus those being prepared (the per-message
  // limit); gen: bumped by New chat and on unmount, so photos still being prepared for the
  // old tray are dropped
  const trayRef = useRef({ count: 0, gen: 0 });
  const urlsRef = useRef(new Set());  // every photo preview URL made, freed by New chat and on unmount
  const titleId = useId();
  const shown = visible && open;

  // Keep the newest message in view
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, shown]);
  // Put the cursor in the box when the chat opens
  useEffect(() => { if (shown) inputRef.current?.focus(); }, [shown]);
  // The box grows with what is pasted, up to its max height
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input, shown]);
  // Signing out unmounts the chat: drop a request still in flight, photos still being
  // prepared, and every photo preview held in memory
  useEffect(() => {
    const urls = urlsRef.current, tray = trayRef.current;
    return () => {
      ctrlRef.current?.abort();
      tray.gen++;
      urls.forEach(u => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  if (!visible) return null;

  const nextId = () => ++idRef.current;
  const tooLong = input.length > CLEAN_LIMITS.messageChars;
  const lastId = messages[messages.length - 1]?.id;
  const maxPhotos = CLEAN_IMAGE_LIMITS.perMessage;

  // Asks Gemini about `history` (the chat including the new message) and adds its answer.
  // A turn with several photos, or a long one-guest-per-line list, is asked in parts (each on
  // its own, without the history: turnParts); anything else goes as one question with the
  // history, so follow-ups ("ongeza…") work. The answer keeps the text it replies to
  // (turnText), how many photos it was read from, and what checkAnswer compares it with
  // (allText: everything typed, plus earlier answers read from photos, whose numbers came
  // from the photos).
  const ask = async (history) => {
    const chat = chatForApi(history);
    if (!chat.length) return;
    const turn = chat[chat.length - 1];
    const turnText = turn.text;
    const photoCount = turn.images?.length || 0;
    const allText = history.filter(m => m.text && (m.role === "user" || m.photos)).map(m => m.text).join("\n");
    const parts = turnParts(turn);
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setBusy(true);
    setProgress(parts.length > 1 ? { done: 0, total: parts.length, photos: photoCount } : null);
    try {
      const { text, truncated, repeated = 0, unread = [] } = parts.length > 1
        ? await cleanInParts(parts, ctrl.signal, (done) => { if (ctrlRef.current === ctrl) setProgress({ done, total: parts.length, photos: photoCount }); })
        : await askWithRetry(chat, ctrl.signal);
      if (ctrlRef.current !== ctrl) return;
      setMessages(m => [...m, { id: nextId(), role: "model", text, truncated, parts: parts.length, turnText, allText, photos: photoCount, repeated, unread }]);
    } catch (e) {
      if (ctrlRef.current !== ctrl || e?.name === "AbortError") return;
      setMessages(m => [...m, { id: nextId(), role: "model", error: e?.message || "Something went wrong — try again." }]);
    } finally {
      if (ctrlRef.current === ctrl) { ctrlRef.current = null; setBusy(false); setProgress(null); }
    }
  };

  const send = () => {
    const text = input.trim();
    if ((!text && !photos.length) || busy || preparing || text.length > CLEAN_LIMITS.messageChars) return;
    const next = [...messages, { id: nextId(), role: "user", text, ...(photos.length ? { images: photos } : {}) }];
    setMessages(next);
    setInput("");
    setPhotos([]);
    trayRef.current.count = 0;
    ask(next);
  };

  // Reads picked, pasted or dropped files into the tray, one at a time (a phone has little
  // memory for big photos) and in the order picked. Up to maxPhotos per message.
  const addPhotos = async (list) => {
    const files = [...(list || [])].filter(Boolean);
    if (!files.length) return;
    const room = maxPhotos - trayRef.current.count;
    if (room <= 0) { showToast(`A message can carry up to ${maxPhotos} photos — send these first`, "warn"); return; }
    const take = files.slice(0, room);
    if (files.length > take.length) showToast(`A message can carry up to ${maxPhotos} photos — ${files.length - take.length} not added`, "warn");
    const gen = trayRef.current.gen;
    trayRef.current.count += take.length;
    setPreparing(n => n + take.length);
    const problems = [];
    for (const file of take) {
      try {
        if (trayRef.current.gen !== gen) continue;
        const photo = await preparePhoto(file, `photo-${nextId()}`);
        if (trayRef.current.gen !== gen) { URL.revokeObjectURL(photo.url); continue; }
        urlsRef.current.add(photo.url);
        setPhotos(p => [...p, photo]);
      } catch (e) {
        if (trayRef.current.gen === gen) trayRef.current.count--;
        problems.push(e?.message || "A photo could not be read");
      } finally {
        setPreparing(n => n - 1);
      }
    }
    if (problems.length && trayRef.current.gen === gen) {
      showToast(problems.length === 1 ? problems[0] : `${problems.length} photos could not be attached: ${problems[0]}`, "warn");
    }
    if (trayRef.current.gen === gen) inputRef.current?.focus();
  };

  const removePhoto = (id) => {
    const photo = photos.find(p => p.id === id);
    if (!photo) return;
    URL.revokeObjectURL(photo.url);
    urlsRef.current.delete(photo.url);
    trayRef.current.count--;
    setPhotos(p => p.filter(x => x.id !== id));
  };

  const pickPhotos = () => fileRef.current?.click();

  const onPickPhotos = (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";   // picking the same photo again still fires a change
    addPhotos(files);
  };

  const onPaste = (e) => {
    const files = pastedPhotos(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    addPhotos(files);
  };

  // Photos dragged onto the chat
  const onDragOver = (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!dragging) setDragging(true);
  };
  const onDragLeave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); };
  const onDrop = (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    setDragging(false);
    addPhotos(e.dataTransfer.files);
  };

  // Stops waiting; the message stays and is sent again with the next one
  const stop = () => { ctrlRef.current?.abort(); ctrlRef.current = null; setBusy(false); setProgress(null); };

  const retry = (errId) => {
    if (busy) return;
    const next = messages.filter(m => m.id !== errId);
    setMessages(next);
    ask(next);
  };

  const newChat = async () => {
    if (messages.length) {
      const ok = await askDialog({
        title: "Start a new chat?",
        body: "This chat, its photos and its cleaned tables are cleared. Download or use any list you still need first.",
        actions: [{ value: "yes", label: "Start a new chat", kind: "warn" }],
      });
      if (ok !== "yes") return;
    }
    stop();
    trayRef.current.gen++;
    urlsRef.current.forEach(u => URL.revokeObjectURL(u));
    urlsRef.current.clear();
    trayRef.current.count = 0;
    setMessages([]);
    setInput("");
    setPhotos([]);
    inputRef.current?.focus();
  };

  // "Use the card types from my list": rewrites that answer with the types its list states
  const fixTypes = (id, guests) => setMessages(m => m.map(x => x.id === id ? { ...x, text: guestsToMarkdown(guests) } : x));

  // Loads the guests as the event's guest list, the same way as an uploaded spreadsheet.
  // `issues`: numbers the answer check flagged (missing or marked in red)
  const takeGuests = async (guests, issues = 0) => {
    const gaps = guestGaps(guests);
    const ok = await askDialog({
      title: `Use these ${guests.length} guests as the guest list?`,
      body: (
        <>
          <p style={{ marginBottom: 8 }}>
            The guest list of <strong>{eventName || "this event"}</strong> is replaced by this list, the same as uploading a spreadsheet.
            Guests already saved are matched by phone and name, so their send statuses, calls and check-ins are kept.
          </p>
          {issues > 0 && (
            <p style={{ marginBottom: 8, color: N.red, fontWeight: 600 }}>
              {issues} phone number{issues === 1 ? " needs" : "s need"} checking (see the warnings under the table). Fix them before sending cards.
            </p>
          )}
          {(gaps.noPhone > 0 || gaps.noCardType > 0) && (
            <p style={{ marginBottom: 8, color: N.amber }}>
              {[gaps.noPhone > 0 && `${gaps.noPhone} without a phone`, gaps.noCardType > 0 && `${gaps.noCardType} without a card type`].filter(Boolean).join(" and ")} — you can fill these in afterwards.
            </p>
          )}
          <p>Nothing is saved until you press <strong>Save Cards</strong>.</p>
        </>
      ),
      actions: [{ value: "yes", label: `Use ${guests.length} guests` }],
    });
    if (ok === "yes") await onUseGuests(guestSheetRows(guests));
  };

  const downloadExcel = async (guests) => {
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(guestSheetRows(guests), { header: ["Name", "Phone", "CardType"] });
      ws["!cols"] = [{ wch: 34 }, { wch: 14 }, { wch: 11 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Guests");
      XLSX.writeFile(wb, cleanFileName(eventName, localDate()));
      showToast(`Downloaded ${guests.length} guests — upload the file with Upload Spreadsheet on the Design tab`, "success");
    } catch (e) {
      showToast("Could not make the Excel file: " + (e?.message || e), "warn");
    }
  };

  const copyGuests = async (guests) => {
    try {
      await navigator.clipboard.writeText(guestsToTsv(guests));
      showToast(`Copied ${guests.length} guests — paste them into Excel or Google Sheets`, "success");
    } catch {
      showToast("Could not copy — the browser blocked the clipboard", "warn");
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  };

  return (
    <>
      <style>{CSS}</style>
      {!open && (
        <button type="button" className="cb-fab" onClick={() => setOpen(true)} aria-label="Open the data cleaner" title="Clean a messy guest list with AI">
          <Icon n="sparkles" /><span className="cb-fab-label">Clean data</span>
          {busy && <span className="cb-fab-busy" aria-hidden="true" />}
        </button>
      )}
      {open && (
        <section className="cb-panel" role="dialog" aria-modal="false" aria-labelledby={titleId}
          onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
          {dragging && <div className="cb-drop" aria-hidden="true"><Icon n="image" /> Drop photos of the guest list</div>}
          <header className="cb-head">
            <div className="cb-head-ic"><Icon n="sparkles" /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="cb-title" id={titleId}>Data cleaner</div>
              <div className="cb-sub">Nikadi AI · cleans guest lists only</div>
            </div>
            <button type="button" className="cb-icon-btn" onClick={newChat} disabled={!messages.length && !input && !photos.length && !preparing} aria-label="New chat" title="New chat">
              <Icon n="plus" />
            </button>
            <button type="button" className="cb-icon-btn" onClick={() => setOpen(false)} aria-label="Close the data cleaner" title="Close (the chat is kept)">
              <Icon n="x" />
            </button>
          </header>

          <div className="cb-body" ref={bodyRef} aria-live="polite">
            {messages.length === 0 && (
              <div className="cb-intro">
                <div className="cb-h">Clean a messy guest list</div>
                <p className="cb-p">
                  Paste names and phone numbers in any shape: a WhatsApp message, a typed list or rows copied from Excel.
                  Or attach photos and screenshots of a list, several at once. You get back a clean table of Name, Phone
                  and card type. Ask for changes in the same chat.
                </p>
                <div className="cb-rules">
                  {RULES.map(r => <span key={r} className="cb-rule"><Icon n="check" /> {r}</span>)}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <button type="button" className="cb-btn" onClick={() => { setInput(CLEAN_EXAMPLE); inputRef.current?.focus(); }}>
                    <Icon n="file" /> Try an example
                  </button>
                  <button type="button" className="cb-btn" onClick={pickPhotos}>
                    <Icon n="image" /> Attach photos
                  </button>
                </div>
                <div className="cb-privacy"><Icon n="shield" />
                  <span>Lists and photos are sent to Google Gemini to be read. Photos stay in this browser only and are never saved. Check the result before you use it.</span>
                </div>
              </div>
            )}

            {messages.map(m => m.role === "user" ? (
              <div key={m.id} className="cb-msg cb-user">
                {m.images?.length > 0 && (
                  <div className="cb-thumbs">
                    {m.images.map((p, i) => (
                      <a key={p.id} className="cb-thumb" href={p.url} target="_blank" rel="noreferrer" title={`${p.name}: open full size`}>
                        <img src={p.url} alt={`Photo ${i + 1} of the guest list`} />
                      </a>
                    ))}
                  </div>
                )}
                {m.text}
              </div>
            ) : m.error ? (
              <div key={m.id} className="cb-msg cb-bot cb-bot-err" role="alert">
                <div className="cb-row"><Icon n="alert" /> <span>{m.error}</span></div>
                {m.id === lastId && !busy && (
                  <button type="button" className="cb-btn" style={{ marginTop: 10 }} onClick={() => retry(m.id)}><Icon n="refresh" /> Try again</button>
                )}
              </div>
            ) : (
              <BotAnswer key={m.id} msg={m} canUseGuests={canUseGuests} onUse={takeGuests} onExcel={downloadExcel} onCopy={copyGuests} onFixTypes={fixTypes} />
            ))}

            {busy && (
              <div className="cb-msg cb-bot cb-thinking">
                <Icon n="loader" />
                <span style={{ flex: 1 }}>
                  {progress
                    ? progress.photos > 1
                      ? `Reading ${progress.photos} photos… ${progress.done} of ${progress.total} done`
                      : `Cleaning a long list in ${progress.total} parts… ${progress.done} of ${progress.total} done`
                    : "Cleaning… a long list can take a minute."}
                </span>
                <button type="button" className="cb-btn" onClick={stop}>Stop</button>
              </div>
            )}
          </div>

          <div className="cb-foot">
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onPickPhotos} />
            {(photos.length > 0 || preparing > 0) && (
              <div className="cb-tray" role="list" aria-label="Photos to send with the next message">
                {photos.map((p, i) => (
                  <div key={p.id} className="cb-tray-item" role="listitem">
                    <img src={p.url} alt={`Photo ${i + 1}: ${p.name}`} />
                    <button type="button" className="cb-tray-x" onClick={() => removePhoto(p.id)} aria-label={`Remove photo ${i + 1}`} title="Remove this photo">
                      <Icon n="x" />
                    </button>
                  </div>
                ))}
                {preparing > 0 && (
                  <div className="cb-tray-item cb-tray-wait" role="listitem" aria-label={`Preparing ${preparing} photo${preparing === 1 ? "" : "s"}`} title="Preparing…">
                    <Icon n="loader" />
                  </div>
                )}
              </div>
            )}
            <div className="cb-input-row">
              <button type="button" className="cb-attach" onClick={pickPhotos} disabled={photos.length + preparing >= maxPhotos}
                aria-label="Attach photos or screenshots of a guest list" title={`Attach photos or screenshots (up to ${maxPhotos})`}>
                <Icon n="image" />
              </button>
              <textarea ref={inputRef} className="cb-input" rows={1} value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKeyDown} onPaste={onPaste}
                placeholder={photos.length ? "Add a note (optional), or just send…" : messages.length ? "Paste another list, or ask for a change…" : "Paste the guest list here…"}
                aria-label="Guest list or message for the data cleaner" />
              <button type="button" className="cb-send" onClick={send} disabled={busy || preparing > 0 || (!input.trim() && !photos.length) || tooLong}
                aria-label="Send" title={preparing ? "Preparing photos…" : "Send (Ctrl + Enter)"}>
                <Icon n={busy || preparing ? "loader" : "send"} />
              </button>
            </div>
            <div className="cb-hint">
              {photos.length > 0
                ? <span className="cb-hint-photos"><Icon n="lock" /> {photos.length} photo{photos.length === 1 ? "" : "s"} · kept in this browser only, never saved</span>
                : <span className="cb-hint-keys">Enter for a new line · Ctrl + Enter to send</span>}
              <span className={tooLong ? "cb-over" : undefined}>
                {tooLong
                  ? `Too long: ${input.length.toLocaleString("en")} / ${CLEAN_LIMITS.messageChars.toLocaleString("en")} — send it in parts`
                  : input.length > CLEAN_LIMITS.messageChars * 0.8 ? `${input.length.toLocaleString("en")} / ${CLEAN_LIMITS.messageChars.toLocaleString("en")}` : ""}
              </span>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
