import { useState, useRef, useCallback, useEffect } from "react";
import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";
import { supabase } from "./lib/supabase";
import LoginPage from "./LoginPage";

/* ══════════════════════════════════════════════════════════════════════════
   BRAND
══════════════════════════════════════════════════════════════════════════ */
const FONTS = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap";

const N = {
  navy900:"#050d1f", navy800:"#0a1628", navy700:"#0d1f3c", navy600:"#102848",
  navy500:"#163260", navy400:"#1e4080", navy300:"#2563b0",
  sky:"#38bdf8", accent:"#3b82f6", accentHover:"#2563eb",
  gold:"#f59e0b", green:"#22c55e", greenBg:"#052e16",
  red:"#ef4444", redBg:"#2d0a0a",
  amber:"#f59e0b", amberBg:"#2d1a00",
  purple:"#a855f7", purpleBg:"#1a0a2e",
  teal:"#14b8a6", tealBg:"#042f2e",
  text:"#e2e8f0", textMid:"#94a3b8", textDim:"#475569",
  border:"#1e3a5f",
};

const CSS = `
  @import url('${FONTS}');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${N.navy900}; font-family: 'Plus Jakarta Sans', sans-serif; color: ${N.text}; }
  .nk-app { display: flex; flex-direction: column; min-height: 100vh; background: ${N.navy900}; }

  /* Header */
  .nk-header {
    background: linear-gradient(135deg, ${N.navy800} 0%, ${N.navy700} 100%);
    border-bottom: 1px solid ${N.border}; padding: 0 28px; height: 64px;
    display: flex; align-items: center; gap: 16px;
    position: sticky; top: 0; z-index: 100;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  }
  .nk-logo { display: flex; align-items: center; gap: 10px; }
  .nk-logo-icon {
    width: 36px; height: 36px; border-radius: 10px;
    background: linear-gradient(135deg, ${N.accent}, ${N.sky});
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 16px; color: #fff;
    box-shadow: 0 4px 12px rgba(59,130,246,0.4); flex-shrink: 0;
  }
  .nk-logo-name {
    font-size: 18px; font-weight: 800; letter-spacing: -0.3px;
    background: linear-gradient(135deg, #fff 30%, ${N.sky});
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .nk-logo-tag { font-size: 10px; color: ${N.textDim}; font-weight: 500; letter-spacing: 0.5px; margin-top: -2px; }
  .nk-header-actions { margin-left: auto; display: flex; gap: 10px; align-items: center; }
  .nk-db-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; box-shadow: 0 0 6px currentColor; }
  .db-connected    { color: ${N.green};   background: ${N.green}; }
  .db-disconnected { color: ${N.red};     background: ${N.red}; }
  .db-unconfigured { color: ${N.textDim}; background: ${N.textDim}; }

  /* Tabs */
  .nk-tabs {
    display: flex; background: ${N.navy800};
    border-bottom: 1px solid ${N.border}; padding: 0 28px; overflow-x: auto;
  }
  .nk-tab {
    padding: 14px 20px; font-size: 13px; font-weight: 600;
    color: ${N.textDim}; border: none; background: none; cursor: pointer;
    border-bottom: 3px solid transparent; margin-bottom: -1px;
    transition: all 0.2s; font-family: 'Plus Jakarta Sans', sans-serif;
    display: flex; align-items: center; gap: 7px;
    white-space: nowrap; flex-shrink: 0;
  }
  .nk-tab:hover { color: ${N.text}; }
  .nk-tab.active { color: ${N.sky}; border-bottom-color: ${N.accent}; }

  /* Body */
  .nk-body { display: flex; flex: 1; overflow: hidden; min-height: 0; }

  /* Sidebar */
  .nk-sidebar {
    width: 240px; min-width: 240px; background: ${N.navy800};
    border-right: 1px solid ${N.border};
    padding: 20px 16px; overflow-y: auto;
    display: flex; flex-direction: column; gap: 20px;
  }
  .nk-sidebar-right {
    width: 240px; min-width: 240px; background: ${N.navy800};
    border-left: 1px solid ${N.border}; padding: 20px 16px; overflow-y: auto;
  }

  /* Section label */
  .nk-sec {
    font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
    color: ${N.textDim}; text-transform: uppercase;
    margin-bottom: 10px; display: flex; align-items: center; gap: 6px;
  }
  .nk-sec::before {
    content: ''; display: block; width: 3px; height: 12px;
    background: ${N.accent}; border-radius: 2px; flex-shrink: 0;
  }
  .nk-sec-purple::before { background: ${N.purple}; }
  .nk-sec-teal::before   { background: ${N.teal}; }
  .nk-sec-green::before  { background: ${N.green}; }
  .nk-sec-amber::before  { background: ${N.amber}; }

  /* Upload */
  .nk-upload {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    border: 1.5px dashed ${N.border}; border-radius: 12px;
    padding: 16px 12px; cursor: pointer; gap: 6px;
    background: ${N.navy900}; transition: all 0.2s; text-align: center;
  }
  .nk-upload:hover { border-color: ${N.accent}; background: ${N.navy700}; }
  .nk-upload-icon  { font-size: 22px; }
  .nk-upload-label { font-size: 12px; font-weight: 600; color: ${N.textMid}; }
  .nk-upload-sub   { font-size: 10px; color: ${N.textDim}; }

  /* Buttons */
  .nk-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    padding: 9px 16px; border-radius: 8px; border: none; cursor: pointer;
    font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 600; font-size: 13px;
    transition: all 0.18s; white-space: nowrap;
  }
  .nk-btn-primary  { background: linear-gradient(135deg, ${N.accent}, ${N.accentHover}); color: #fff; box-shadow: 0 4px 14px rgba(59,130,246,0.35); }
  .nk-btn-primary:hover  { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(59,130,246,0.45); }
  .nk-btn-ghost    { background: transparent; color: ${N.textMid}; border: 1.5px solid ${N.border}; }
  .nk-btn-ghost:hover    { border-color: ${N.accent}; color: ${N.sky}; background: ${N.navy700}; }
  .nk-btn-success  { background: linear-gradient(135deg, #16a34a, #15803d); color: #fff; box-shadow: 0 4px 14px rgba(34,197,94,0.3); }
  .nk-btn-success:hover  { transform: translateY(-1px); }
  .nk-btn-purple   { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; box-shadow: 0 4px 14px rgba(124,58,237,0.3); }
  .nk-btn-purple:hover   { transform: translateY(-1px); }
  .nk-btn-teal     { background: linear-gradient(135deg, #0d9488, #0f766e); color: #fff; box-shadow: 0 4px 14px rgba(20,184,166,0.3); }
  .nk-btn-teal:hover     { transform: translateY(-1px); }
  .nk-btn-danger   { background: linear-gradient(135deg, #dc2626, #b91c1c); color: #fff; }
  .nk-btn-danger:hover   { transform: translateY(-1px); }
  .nk-btn-amber    { background: linear-gradient(135deg, #d97706, #b45309); color: #fff; }
  .nk-btn-amber:hover    { transform: translateY(-1px); }
  .nk-btn-sm {
    padding: 4px 10px; font-size: 11px; border-radius: 6px; border: 1.5px solid;
    cursor: pointer; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 600;
    white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;
    transition: all 0.15s;
  }
  .nk-btn-full { width: 100%; margin-bottom: 8px; }
  .nk-btn:disabled, .nk-btn-sm:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; }

  /* Inputs */
  .nk-input {
    width: 100%; padding: 8px 12px; border-radius: 8px;
    background: ${N.navy900}; border: 1.5px solid ${N.border};
    color: ${N.text}; font-family: 'Plus Jakarta Sans', sans-serif;
    font-size: 13px; margin-bottom: 10px; outline: none; transition: border-color 0.2s;
  }
  .nk-input:focus { border-color: ${N.accent}; box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }
  .nk-input::placeholder { color: ${N.textDim}; }
  .nk-select {
    width: 100%; padding: 8px 12px; border-radius: 8px;
    background: ${N.navy900}; border: 1.5px solid ${N.border};
    color: ${N.text}; font-family: 'Plus Jakarta Sans', sans-serif;
    font-size: 13px; margin-bottom: 10px; outline: none; cursor: pointer;
  }
  .nk-select:focus { border-color: ${N.accent}; }
  .nk-textarea { resize: vertical; min-height: 90px; line-height: 1.6; }
  .nk-label { font-size: 11px; font-weight: 600; color: ${N.textMid}; margin-bottom: 5px; display: block; }

  /* Element pills */
  .nk-el-pill {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 12px; border-radius: 8px; cursor: pointer;
    border: 1.5px solid ${N.border}; margin-bottom: 6px;
    background: ${N.navy900}; transition: all 0.15s; font-size: 12px;
  }
  .nk-el-pill:hover  { border-color: ${N.accent}44; background: ${N.navy700}; }
  .nk-el-pill.active { border-color: ${N.sky}; background: ${N.navy600}; box-shadow: 0 0 0 3px rgba(56,189,248,0.1); }
  .nk-el-pill.disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
  .nk-el-type { font-size: 10px; color: ${N.textDim}; font-family: 'JetBrains Mono', monospace; }
  .nk-michango-badge {
    display: flex; align-items: center; gap: 6px; padding: 7px 10px;
    background: ${N.purpleBg}; border: 1px solid ${N.purple}44;
    border-radius: 8px; font-size: 11px; color: ${N.purple}; margin-bottom: 8px;
    line-height: 1.5;
  }

  /* Chip */
  .nk-chip {
    background: ${N.navy900}; border: 1px solid ${N.border};
    border-radius: 8px; padding: 10px 12px; margin-bottom: 8px;
    font-family: 'JetBrains Mono', monospace; font-size: 11px;
    color: ${N.sky}; line-height: 1.9;
  }
  .nk-chip-ok   { color: ${N.green}; font-size: 10px; }
  .nk-chip-warn { color: ${N.gold};  font-size: 10px; }

  /* Current event banner in sidebar */
  .nk-event-banner {
    background: linear-gradient(135deg, ${N.navy600}, ${N.navy700});
    border: 1px solid ${N.accent}44; border-radius: 10px;
    padding: 12px 14px; cursor: pointer; transition: all 0.15s;
  }
  .nk-event-banner:hover { border-color: ${N.accent}; }
  .nk-event-banner-name { font-size: 14px; font-weight: 700; color: ${N.sky}; }
  .nk-event-banner-meta { font-size: 11px; color: ${N.textDim}; margin-top: 2px; }

  /* Main */
  .nk-main { flex: 1; padding: 28px; overflow-y: auto; display: flex; flex-direction: column; align-items: center; gap: 20px; }
  .nk-main-wide { flex: 1; padding: 28px; overflow-y: auto; }
  .nk-hint {
    font-size: 12px; color: ${N.textDim}; text-align: center;
    background: ${N.navy800}; border: 1px solid ${N.border};
    border-radius: 8px; padding: 8px 20px;
  }

  /* Record pills */
  .nk-rec-pills { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
  .nk-rec-pill {
    padding: 5px 14px; border-radius: 20px; font-size: 12px; font-weight: 600;
    border: 1.5px solid ${N.border}; background: transparent;
    color: ${N.textMid}; cursor: pointer; font-family: 'Plus Jakarta Sans', sans-serif;
    transition: all 0.15s;
  }
  .nk-rec-pill:hover  { border-color: ${N.accent}; color: ${N.sky}; }
  .nk-rec-pill.active { background: ${N.accent}22; border-color: ${N.accent}; color: ${N.sky}; }

  /* Banner */
  .nk-banner {
    background: ${N.navy700}; border-bottom: 1px solid ${N.border};
    padding: 10px 28px; font-size: 12px; color: ${N.textMid};
    display: flex; gap: 10px; align-items: flex-start; line-height: 1.6;
  }
  .nk-banner strong { color: ${N.gold}; }
  .nk-banner code {
    background: ${N.navy900}; border-radius: 4px; padding: 1px 5px;
    font-family: 'JetBrains Mono', monospace; color: ${N.sky}; font-size: 11px;
  }

  /* Stats */
  .nk-stats { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
  .nk-stat  { background: ${N.navy800}; border: 1px solid ${N.border}; border-radius: 12px; padding: 14px 20px; text-align: center; min-width: 100px; }
  .nk-stat-num   { font-size: 24px; font-weight: 800; line-height: 1; margin-bottom: 4px; }
  .nk-stat-label { font-size: 10px; font-weight: 600; color: ${N.textDim}; text-transform: uppercase; letter-spacing: 0.5px; }

  /* Log */
  .nk-log { background: ${N.navy800}; border: 1px solid ${N.border}; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
  .nk-log-row { font-size: 12px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }

  /* Table */
  .nk-table { width: 100%; border-collapse: separate; border-spacing: 0; }
  .nk-table-wrap { background: ${N.navy800}; border: 1px solid ${N.border}; border-radius: 14px; overflow: hidden; }
  .nk-table thead th {
    padding: 12px 14px; text-align: left;
    font-size: 10px; font-weight: 700; letter-spacing: 1.2px;
    color: ${N.textDim}; text-transform: uppercase;
    background: ${N.navy700}; border-bottom: 1px solid ${N.border};
  }
  .nk-table tbody tr { transition: background 0.15s; }
  .nk-table tbody tr:hover { background: ${N.navy700}44; }
  .nk-table tbody tr.row-active { background: rgba(59,130,246,0.06); }
  .nk-table td { padding: 10px 14px; font-size: 13px; border-bottom: 1px solid ${N.border}22; vertical-align: middle; }
  .nk-table tbody tr:last-child td { border-bottom: none; }

  /* Badges */
  .nk-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; font-family: 'JetBrains Mono', monospace; }
  .badge-idle    { background: ${N.navy700}; color: ${N.textDim}; border: 1px solid ${N.border}; }
  .badge-testing { background: ${N.amberBg}; color: ${N.amber}; border: 1px solid ${N.amber}44; }
  .badge-yes     { background: ${N.greenBg}; color: ${N.green}; border: 1px solid ${N.green}44; }
  .badge-no      { background: ${N.redBg};   color: ${N.red};   border: 1px solid ${N.red}44; }
  .badge-sent    { background: ${N.tealBg};  color: ${N.teal};  border: 1px solid ${N.teal}44; }
  .badge-purple  { background: ${N.purpleBg}; color: ${N.purple}; border: 1px solid ${N.purple}44; }

  /* Toast */
  .nk-toast {
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    padding: 12px 20px; border-radius: 12px; font-size: 13px; font-weight: 500;
    box-shadow: 0 8px 30px rgba(0,0,0,0.5); max-width: 340px; line-height: 1.5;
    animation: slideUp 0.3s ease; display: flex; align-items: flex-start; gap: 10px;
  }
  .nk-toast-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
  .toast-success { background: #052e16; color: ${N.green}; border: 1px solid ${N.green}44; }
  .toast-warn    { background: ${N.amberBg}; color: ${N.amber}; border: 1px solid ${N.amber}44; }
  .toast-info    { background: ${N.navy600}; color: ${N.sky}; border: 1px solid ${N.sky}44; }
  @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

  input[type=range] { width: 100%; accent-color: ${N.accent}; margin-bottom: 6px; }

  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: ${N.navy800}; }
  ::-webkit-scrollbar-thumb { background: ${N.navy500}; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: ${N.accent}; }

  .nk-divider { height: 1px; background: ${N.border}; margin: 4px 0 16px; }
  canvas { display: block; }

  .nk-phone-edit {
    background: ${N.navy900}; border: 1.5px solid ${N.accent};
    color: ${N.text}; border-radius: 6px; padding: 3px 8px;
    font-family: 'JetBrains Mono', monospace; font-size: 12px; width: 130px; outline: none;
  }
  .nk-phone-val { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: ${N.textMid}; display: flex; align-items: center; gap: 6px; }

  /* ── Modal ── */
  .nk-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.75);
    z-index: 500; display: flex; align-items: center; justify-content: center;
    padding: 24px;
  }
  .nk-modal {
    background: ${N.navy800}; border: 1px solid ${N.border};
    border-radius: 18px; width: 100%; max-width: 620px;
    max-height: 90vh; overflow-y: auto;
    box-shadow: 0 24px 80px rgba(0,0,0,0.6);
    animation: modalIn 0.2s ease;
  }
  @keyframes modalIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  .nk-modal-head {
    padding: 24px 28px 0; display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 20px;
  }
  .nk-modal-title { font-size: 18px; font-weight: 800; color: ${N.text}; }
  .nk-modal-close {
    width: 32px; height: 32px; border-radius: 8px; border: 1.5px solid ${N.border};
    background: transparent; color: ${N.textDim}; cursor: pointer; font-size: 16px;
    display: flex; align-items: center; justify-content: center; transition: all 0.15s;
  }
  .nk-modal-close:hover { border-color: ${N.red}; color: ${N.red}; }
  .nk-modal-body { padding: 0 28px 28px; }
  .nk-modal-foot { padding: 0 28px 28px; display: flex; gap: 10px; justify-content: flex-end; }
  .nk-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

  /* ── VCard ── */
  .nk-vcard-preview {
    background: ${N.navy900}; border: 1px solid ${N.border};
    border-radius: 12px; padding: 16px; font-family: 'JetBrains Mono', monospace;
    font-size: 11px; color: ${N.sky}; line-height: 1.8; max-height: 240px; overflow-y: auto;
    white-space: pre-wrap; margin-bottom: 12px;
  }

  /* ── SMS ── */
  .nk-sms-settings { background: ${N.navy700}; border: 1px solid ${N.border}; border-radius: 12px; padding: 14px; margin-bottom: 12px; }

  /* ── Layout restored chip ── */
  .nk-layout-chip {
    display: inline-flex; align-items: center; gap: 6px;
    background: ${N.greenBg}; border: 1px solid ${N.green}44;
    border-radius: 20px; padding: 3px 12px; font-size: 11px;
    color: ${N.green}; font-family: 'JetBrains Mono', monospace;
  }

  /* ── Delete confirm overlay ── */
  .nk-confirm {
    background: ${N.navy800}; border: 1px solid ${N.red}44;
    border-radius: 14px; padding: 24px; max-width: 400px; width: 100%;
    box-shadow: 0 24px 80px rgba(0,0,0,0.6); animation: modalIn 0.2s ease;
  }
  .nk-confirm-title { font-size: 16px; font-weight: 700; color: ${N.text}; margin-bottom: 8px; }
  .nk-confirm-body  { font-size: 13px; color: ${N.textMid}; margin-bottom: 20px; line-height: 1.6; }

  .nk-page { width: 100%; max-width: 1100px; margin: 0 auto; }
`;

/* ── Helpers ──────────────────────────────────────────────────────────── */
const qrUrl = (data, size = 120) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&margin=6&color=0d1f3c&bgcolor=ffffff`;

const normalisePhone = (raw = "") => {
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 9) d = "255" + d.slice(1);
  return d;
};
const waLink = (phone, text = "") =>
  `https://wa.me/${normalisePhone(phone)}?text=${encodeURIComponent(text)}`;

const downloadBlob = (content, filename, type = "text/plain") => {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
};

/* Fingerprint a template data-URL for localStorage keying */
const templateFingerprint = (dataUrl, filename = "") => {
  const sample = (filename || "") + dataUrl.slice(0, 512) + String(dataUrl.length);
  let h = 5381;
  for (let i = 0; i < sample.length; i++) { h = ((h << 5) + h) ^ sample.charCodeAt(i); h = h >>> 0; }
  return h.toString(36);
};

const LAYOUT_PREFIX = "nikadi_layout_";

const generateVcf = (contacts, eventUsername) =>
  contacts.map(({ name, phone }) => {
    const fn  = `${name} ${eventUsername}_Nikadi`.trim();
    const tel = normalisePhone(phone);
    const e164 = tel.length >= 10 ? `+${tel}` : tel;
    return ["BEGIN:VCARD","VERSION:3.0",`FN:${fn}`,`N:${eventUsername}_Nikadi;${name};;;`,`TEL;TYPE=CELL:${e164}`,"END:VCARD"].join("\r\n");
  }).join("\r\n");

/* ── Constants ───────────────────────────────────────────────────────── */
const DEFAULT_W = 440, DEFAULT_H = 280, MAX_DISPLAY_W = 780;
const defaultElements = () => [
  { id:"name",     label:"Name",      type:"text", field:"name",     x:220, y:170, fontSize:22, color:"#0d1f3c", bold:true,  align:"center" },
  { id:"cardtype", label:"Card Type", type:"text", field:"cardType", x:220, y:200, fontSize:13, color:"#2563b0", bold:false, align:"center" },
  { id:"qr",       label:"QR Code",   type:"qr",                     x:300, y:95,  size:120 },
];
const WA  = { idle:"idle", testing:"testing", yes:"yes", no:"no" };
const SMS = { pending:"pending", sent:"sent", delivered:"delivered", failed:"failed" };
const BLANK_EVENT = { username:"", phone:"", event_type:"", status:"active", venue_name:"", venue_address:"", venue_location:"", start_datetime:"", end_datetime:"" };

/* ══════════════════════════════════════════════════════════════════════════
   CARD CANVAS
══════════════════════════════════════════════════════════════════════════ */
function CardCanvas({ bgImage, bgSize, elements, record, selected, onSelect, onMove }) {
  const ref  = useRef(null);
  const drag = useRef(null);
  const cw   = bgSize?.w || DEFAULT_W;
  const ch   = bgSize?.h || DEFAULT_H;
  const displayW = Math.min(cw, MAX_DISPLAY_W);
  const displayH = Math.round(ch * (displayW / cw));
  const scaleX   = cw / displayW;
  const scaleY   = ch / displayH;

  const draw = useCallback(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cw, ch);
    const renderEls = () => {
      elements.forEach((el) => {
        if (el.type === "text") {
          const val = record?.[el.field] || `[${el.label}]`;
          ctx.font = `${el.bold?"bold ":""}${el.fontSize}px 'Plus Jakarta Sans', sans-serif`;
          ctx.fillStyle = el.color; ctx.textAlign = el.align || "left";
          ctx.fillText(val, el.x, el.y); ctx.textAlign = "left";
          if (selected === el.id) {
            const w = ctx.measureText(val).width;
            const dx = el.align==="center" ? el.x - w/2 : el.align==="right" ? el.x - w : el.x;
            ctx.strokeStyle="#38bdf8"; ctx.lineWidth=1.5; ctx.setLineDash([4,3]);
            ctx.strokeRect(dx-4, el.y-el.fontSize-2, w+8, el.fontSize+10); ctx.setLineDash([]);
          }
        } else if (el.type === "qr") {
          const qrData = `Name=${record?.name||"?"};TypeCard=${record?.cardType||"?"}`;
          const img = new Image(); img.crossOrigin = "anonymous";
          img.onload = () => {
            ctx.save(); ctx.shadowColor="rgba(0,0,0,0.2)"; ctx.shadowBlur=6;
            ctx.drawImage(img, el.x, el.y, el.size, el.size); ctx.restore();
            if (selected === el.id) {
              ctx.strokeStyle="#38bdf8"; ctx.lineWidth=1.5; ctx.setLineDash([4,3]);
              ctx.strokeRect(el.x-3, el.y-3, el.size+6, el.size+6); ctx.setLineDash([]);
            }
          };
          img.src = qrUrl(qrData, el.size);
        }
      });
    };
    if (bgImage) {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, cw, ch); renderEls(); };
      img.src = bgImage;
    } else {
      const g = ctx.createLinearGradient(0,0,cw,ch); g.addColorStop(0,"#0a1628"); g.addColorStop(1,"#0d1f3c");
      ctx.fillStyle=g; ctx.fillRect(0,0,cw,ch);
      const s = ctx.createLinearGradient(0,0,0,ch); s.addColorStop(0,"#3b82f6"); s.addColorStop(1,"#38bdf8");
      ctx.fillStyle=s; ctx.fillRect(0,0,5,ch);
      ctx.fillStyle="rgba(59,130,246,0.08)"; ctx.fillRect(0,0,cw,65);
      ctx.fillStyle="#e2e8f0"; ctx.font="700 13px 'Plus Jakarta Sans', sans-serif"; ctx.fillText("NIKADI STUDIO",20,30);
      ctx.fillStyle="rgba(255,255,255,0.12)"; ctx.fillRect(20,38,140,1);
      ctx.fillStyle="#64748b"; ctx.font="500 10px 'Plus Jakarta Sans', sans-serif"; ctx.fillText("IDENTITY CARD",20,55);
      ctx.fillStyle="rgba(59,130,246,0.15)";
      for(let xi=0;xi<5;xi++) for(let yi=0;yi<3;yi++){ctx.beginPath();ctx.arc(cw-20-xi*12,15+yi*12,2,0,Math.PI*2);ctx.fill();}
      renderEls();
    }
  }, [bgImage, cw, ch, elements, record, selected]);

  useEffect(() => { draw(); }, [draw]);

  const hitEl  = (cx,cy) => [...elements].reverse().find((el) => {
    if (el.type==="text") { const hitW=200; const dx=el.align==="center"?el.x-hitW/2:el.align==="right"?el.x-hitW:el.x; return cx>=dx-4&&cx<=dx+hitW+4&&cy>=el.y-el.fontSize&&cy<=el.y+8; }
    return cx>=el.x&&cx<=el.x+el.size&&cy>=el.y&&cy<=el.y+el.size;
  });
  const toCv   = (e) => { const r=ref.current.getBoundingClientRect(); return {cx:(e.clientX-r.left)*scaleX,cy:(e.clientY-r.top)*scaleY}; };
  const onDown = (e) => { const {cx,cy}=toCv(e); const el=hitEl(cx,cy); if(el){onSelect(el.id);drag.current={id:el.id,ox:cx-el.x,oy:cy-el.y};}else onSelect(null); };
  const onMov  = (e) => { if(!drag.current)return; const {cx,cy}=toCv(e); onMove(drag.current.id,cx-drag.current.ox,cy-drag.current.oy); };
  const onUp   = () => { drag.current=null; };

  return (
    <canvas ref={ref} width={cw} height={ch}
      style={{ width:displayW, height:displayH, borderRadius:12, cursor:"crosshair",
        boxShadow:"0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(59,130,246,0.2)" }}
      onMouseDown={onDown} onMouseMove={onMov} onMouseUp={onUp} onMouseLeave={onUp} />
  );
}

/* ── Export ──────────────────────────────────────────────────────────── */
function exportCard(bgImage, bgSize, elements, record) {
  return new Promise((resolve) => {
    const cw = bgSize?.w||DEFAULT_W; const ch = bgSize?.h||DEFAULT_H;
    const cv = document.createElement("canvas"); cv.width=cw; cv.height=ch;
    const ctx = cv.getContext("2d");
    const renderText = () => elements.forEach((el) => {
      if (el.type==="text") {
        const val = record?.[el.field]||"";
        ctx.font=`${el.bold?"bold ":""}${el.fontSize}px 'Plus Jakarta Sans', sans-serif`;
        ctx.fillStyle=el.color; ctx.textAlign=el.align||"left";
        ctx.fillText(val,el.x,el.y); ctx.textAlign="left";
      }
    });
    const renderQR = () => {
      const qrEls = elements.filter(e=>e.type==="qr");
      if (!qrEls.length) { resolve(cv.toDataURL("image/png")); return; }
      let done=0;
      qrEls.forEach((el) => {
        const qrData=`Name=${record?.name||"?"};TypeCard=${record?.cardType||"?"}`;
        const img=new Image(); img.crossOrigin="anonymous";
        img.onload=()=>{ ctx.save();ctx.shadowColor="rgba(0,0,0,0.2)";ctx.shadowBlur=6;ctx.drawImage(img,el.x,el.y,el.size,el.size);ctx.restore(); if(++done===qrEls.length)resolve(cv.toDataURL("image/png")); };
        img.onerror=()=>{ if(++done===qrEls.length)resolve(cv.toDataURL("image/png")); };
        img.src=qrUrl(qrData,el.size);
      });
    };
    if (bgImage) { const bg=new Image(); bg.onload=()=>{ctx.drawImage(bg,0,0,cw,ch);renderText();renderQR();}; bg.src=bgImage; }
    else {
      const g=ctx.createLinearGradient(0,0,cw,ch); g.addColorStop(0,"#0a1628"); g.addColorStop(1,"#0d1f3c");
      ctx.fillStyle=g; ctx.fillRect(0,0,cw,ch);
      const s=ctx.createLinearGradient(0,0,0,ch); s.addColorStop(0,"#3b82f6"); s.addColorStop(1,"#38bdf8");
      ctx.fillStyle=s; ctx.fillRect(0,0,5,ch);
      ctx.fillStyle="rgba(59,130,246,0.08)"; ctx.fillRect(0,0,cw,65);
      ctx.fillStyle="#e2e8f0"; ctx.font="700 13px 'Plus Jakarta Sans', sans-serif"; ctx.fillText("NIKADI STUDIO",20,30);
      ctx.fillStyle="rgba(255,255,255,0.12)"; ctx.fillRect(20,38,140,1);
      ctx.fillStyle="#64748b"; ctx.font="500 10px 'Plus Jakarta Sans', sans-serif"; ctx.fillText("IDENTITY CARD",20,55);
      ctx.fillStyle="rgba(59,130,246,0.15)";
      for(let xi=0;xi<5;xi++) for(let yi=0;yi<3;yi++){ctx.beginPath();ctx.arc(cw-20-xi*12,15+yi*12,2,0,Math.PI*2);ctx.fill();}
      renderText(); renderQR();
    }
  });
}

/* ── Small components ─────────────────────────────────────────────────── */
function WaBadge({ status }) {
  const map = { idle:["badge-idle","○","Not checked"], testing:["badge-testing","⏳","Awaiting"], yes:["badge-yes","✓","On WhatsApp"], no:["badge-no","✗","Not on WA"] };
  const [cls,icon,label] = map[status]||map.idle;
  return <span className={`nk-badge ${cls}`}>{icon} {label}</span>;
}

function Sb({ bg, col, border, children, onClick, title, disabled }) {
  return (
    <button className="nk-btn-sm" onClick={onClick} title={title} disabled={disabled}
      style={{ background:bg, color:col, borderColor:border||col+"44", opacity:disabled?0.5:1 }}>
      {children}
    </button>
  );
}

function RecordRow({ rec, idx, onEdit, onOpenTest, onConfirmWa, onSendSingle, onDownload, onSendSms, isActive, onActivate }) {
  const [editing,setEditing] = useState(false);
  const [phone,setPhone]     = useState("");
  const startEdit = () => { setPhone(rec.phone||""); setEditing(true); };
  const save = () => { onEdit(idx,"phone",phone); setEditing(false); };
  return (
    <tr className={isActive?"row-active":""}>
      <td><span style={{color:N.accent,cursor:"pointer",fontWeight:700,fontFamily:"JetBrains Mono, monospace",fontSize:12}} onClick={onActivate}>#{idx+1}</span></td>
      <td><span style={{fontWeight:600}}>{rec.name}</span></td>
      <td><span style={{color:N.textMid,fontSize:12}}>{rec.cardType}</span></td>
      <td>
        {editing ? (
          <span style={{display:"flex",gap:4,alignItems:"center"}}>
            <input value={phone} onChange={e=>setPhone(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()} autoFocus className="nk-phone-edit" />
            <Sb bg={N.greenBg} col={N.green} onClick={save}>✓</Sb>
            <Sb bg={N.redBg} col={N.red} onClick={()=>setEditing(false)}>✕</Sb>
          </span>
        ) : (
          <span className="nk-phone-val">
            {rec.phone||<span style={{color:N.textDim}}>—</span>}
            <Sb bg="transparent" col={N.textDim} border={N.border} onClick={startEdit} title="Edit">✎</Sb>
          </span>
        )}
      </td>
      <td><WaBadge status={rec.waStatus||WA.idle} /></td>
      <td>
        <span className={`nk-badge ${rec.smsStatus===SMS.delivered?"badge-yes":rec.smsStatus===SMS.sent?"badge-sent":rec.smsStatus===SMS.failed?"badge-no":"badge-idle"}`}>
          {rec.smsStatus===SMS.delivered?"✓ Delivered":rec.smsStatus===SMS.sent?"↑ Sent":rec.smsStatus===SMS.failed?"✗ Failed":"○ Pending"}
        </span>
      </td>
      <td>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {!rec.phone && <Sb bg={N.redBg} col={N.red} onClick={startEdit}>+ Add №</Sb>}
          {rec.phone && rec.waStatus===WA.idle && <Sb bg={N.amberBg} col={N.amber} onClick={()=>onOpenTest(idx)}>🔍 WA</Sb>}
          {rec.waStatus===WA.testing && (<>
            <span style={{fontSize:11,color:N.amber,alignSelf:"center",fontWeight:600}}>Chat open?</span>
            <Sb bg={N.greenBg} col={N.green} onClick={()=>onConfirmWa(idx,true)}>✓ Yes</Sb>
            <Sb bg={N.redBg} col={N.red} onClick={()=>onConfirmWa(idx,false)}>✗ No</Sb>
          </>)}
          {rec.waStatus===WA.yes && <Sb bg="#052e16" col={N.green} onClick={()=>onSendSingle(idx)}>📲 WA</Sb>}
          {rec.waStatus===WA.no  && <Sb bg={N.redBg} col={N.red} onClick={()=>{startEdit();onEdit(idx,"waStatus",WA.idle);}}>✎ Fix</Sb>}
          {(rec.waStatus===WA.yes||rec.waStatus===WA.no) && <Sb bg="transparent" col={N.textDim} border={N.border} onClick={()=>onEdit(idx,"waStatus",WA.idle)}>↺</Sb>}
          {rec.phone && <Sb bg={N.tealBg} col={N.teal} border={N.teal+"44"} onClick={()=>onSendSms(idx)}>💬 SMS</Sb>}
          <Sb bg={N.navy600} col={N.sky} border={N.sky+"44"} onClick={()=>onDownload(idx)}>⬇ PNG</Sb>
        </div>
      </td>
    </tr>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   EVENT MODAL  (Create / Edit)
══════════════════════════════════════════════════════════════════════════ */
function EventModal({ initial, onSave, onClose, saving }) {
  const [form, setForm] = useState({ ...BLANK_EVENT, ...initial });
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  return (
    <div className="nk-overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="nk-modal">
        <div className="nk-modal-head">
          <div className="nk-modal-title">{initial?.id ? "Edit Event" : "New Event"}</div>
          <button className="nk-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="nk-modal-body">
          <div className="nk-form-grid">
            <div>
              <label className="nk-label">Username *</label>
              <input className="nk-input" placeholder="e.g. Mwajuma" value={form.username} onChange={set("username")} />
            </div>
            <div>
              <label className="nk-label">Event Type</label>
              <select className="nk-select" value={form.event_type} onChange={set("event_type")}>
                <option value="">— Select —</option>
                {["Wedding","Conference","Birthday","Corporate","Graduation","Religious","Workshop","Michango","Other"].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="nk-label">Organizer Phone</label>
              <input className="nk-input" placeholder="+255…" value={form.phone} onChange={set("phone")} />
            </div>
            <div>
              <label className="nk-label">Status</label>
              <select className="nk-select" value={form.status} onChange={set("status")}>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <label className="nk-label">Venue Name</label>
              <input className="nk-input" placeholder="Hall / Hotel" value={form.venue_name} onChange={set("venue_name")} />
            </div>
            <div>
              <label className="nk-label">Venue Address</label>
              <input className="nk-input" placeholder="Street / Area" value={form.venue_address} onChange={set("venue_address")} />
            </div>
            <div style={{ gridColumn:"span 2" }}>
              <label className="nk-label">Location / GPS</label>
              <input className="nk-input" placeholder="City or coordinates" value={form.venue_location} onChange={set("venue_location")} />
            </div>
            <div>
              <label className="nk-label">Start Date & Time</label>
              <input type="datetime-local" className="nk-input" value={form.start_datetime} onChange={set("start_datetime")} />
            </div>
            <div>
              <label className="nk-label">End Date & Time</label>
              <input type="datetime-local" className="nk-input" value={form.end_datetime} onChange={set("end_datetime")} />
            </div>
          </div>
        </div>
        <div className="nk-modal-foot">
          <button className="nk-btn nk-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="nk-btn nk-btn-primary" onClick={() => onSave(form)} disabled={saving||!form.username}>
            {saving ? "⏳ Saving…" : "💾 Save Event"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════════════════════════════════ */
export default function App() {
  /* ── Canvas ── */
  const [bgImage,   setBgImage]   = useState(null);
  const [bgSize,    setBgSize]    = useState(null);
  const [elements,  setElements]  = useState(defaultElements());
  const [selected,  setSelected]  = useState(null);
  const [templateKey, setTemplateKey] = useState(null);
  const [layoutRestored, setLayoutRestored] = useState(false);
  const layoutSaveTimer   = useRef(null);
  const pendingDbLayout   = useRef(null);   // layout loaded from DB, consumed once by templateKey effect

  /* ── Records ── */
  const [records,   setRecords]   = useState([
    { name:"Nazael Ezekiel",     cardType:"SINGLE", phone:"0712345678", waStatus:WA.idle, smsStatus:SMS.pending },
    { name:"Denis Mwambuja",     cardType:"DOUBLE", phone:"0756789012", waStatus:WA.idle, smsStatus:SMS.pending },
    { name:"Noberth Nikombolwe", cardType:"20",     phone:"",           waStatus:WA.idle, smsStatus:SMS.pending },
  ]);
  const [activeIdx, setActiveIdx] = useState(0);

  /* ── Navigation ── */
  const [tab, setTab] = useState("events");

  /* ── WhatsApp ── */
  const [waMessage,   setWaMessage]   = useState("Hello {name}, please find your {cardType} ID card attached. Welcome aboard!");
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkLog,     setBulkLog]     = useState([]);

  /* ── Event state ── */
  const [eventData,    setEventData]    = useState(BLANK_EVENT);
  const [savedEventId, setSavedEventId] = useState(null);
  const [eventSearch, setEventSearch] = useState("");
  const [eventDropdownOpen, setEventDropdownOpen] = useState(false);
  const [savedEvents,  setSavedEvents]  = useState([]);
  const [coverUrl,          setCoverUrl]          = useState(null);
  const [isSaving,          setIsSaving]          = useState(false);
  const [loadingTemplate,   setLoadingTemplate]   = useState(false);
  const [dbStatus,          setDbStatus]          = useState(supabase ? "unknown" : "unconfigured");

  /* ── Saved templates ── */
  const [savedTemplates,    setSavedTemplates]    = useState([]);
  const [showSaveTemplate,  setShowSaveTemplate]  = useState(false);
  const [templateSaveName,  setTemplateSaveName]  = useState("");

  /* ── Event modal ── */
  const [modalEvent,   setModalEvent]   = useState(null); // null=closed, obj=open
  const [deleteTarget, setDeleteTarget] = useState(null); // event to confirm-delete

  /* ── SMS ── */
  const [smsMessage,      setSmsMessage]      = useState("Habari {name}, kadi yako ya {cardType} ipo tayari. Imepakiwa na Nikadi Studio. Asante!");
  const smsSettings = { bearerToken:"dc677ab4eddbafd7dfb35b115c91a9bc", senderId:"NIKADI" };
  const [smsSending,      setSmsSending]      = useState(false);
  const [smsLog,          setSmsLog]          = useState([]);
  const [smsBalance,      setSmsBalance]      = useState(null);
  const [smsBalanceLoading, setSmsBalanceLoading] = useState(false);

  /* ── VCard ── */
  const [vcardContacts, setVcardContacts] = useState([]);

  /* ── Toast ── */
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = "info") => { setToast({ msg, type }); setTimeout(() => setToast(null), 4500); };

  /* ── Auth ── */
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  useEffect(() => {
    if (!supabase) { setUser(null); return; }
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const activeRecord = records[activeIdx] || {};
  const selectedEl   = elements.find(e => e.id === selected);
  const cw = bgSize?.w || DEFAULT_W;
  const ch = bgSize?.h || DEFAULT_H;

  /* ── Supabase ping ── */
  useEffect(() => {
    if (!supabase) return;
    supabase.from("events").select("id", { count:"exact", head:true })
      .then(({ error }) => setDbStatus(error ? "disconnected" : "connected"))
      .catch(() => setDbStatus("disconnected"));
  }, []);

  /* ── Template layout: restore from DB (priority) or localStorage ── */
  useEffect(() => {
    if (!templateKey) return;

    // DB layout takes highest priority — set by selectEvent before setTemplateKey
    if (pendingDbLayout.current) {
      const layout = pendingDbLayout.current;
      pendingDbLayout.current = null;
      setElements(layout);
      setLayoutRestored(true);
      localStorage.setItem(LAYOUT_PREFIX + templateKey, JSON.stringify(layout));
      showToast("Layout restored from database", "success");
      return;
    }

    // Fall back to localStorage (previous session)
    const saved = localStorage.getItem(LAYOUT_PREFIX + templateKey);
    if (saved) {
      try {
        setElements(JSON.parse(saved));
        setLayoutRestored(true);
        showToast("Card layout restored from last session", "success");
      } catch { setElements(defaultElements()); setLayoutRestored(false); }
    } else {
      setElements(defaultElements());
      setLayoutRestored(false);
    }
  }, [templateKey]); // showToast intentionally omitted — stable ref not needed here

  /* ── Template layout: auto-save to localStorage on element changes ── */
  useEffect(() => {
    if (!templateKey) return;
    clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = setTimeout(() => {
      localStorage.setItem(LAYOUT_PREFIX + templateKey, JSON.stringify(elements));
    }, 600);
  }, [elements, templateKey]);

  /* ── Load saved events ── */
  const loadSavedEvents = async () => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("events").select("*").order("created_at", { ascending:false }).limit(50);
    if (!error && data) { setSavedEvents(data); return data; }
    return [];
  };
  useEffect(() => {
    if (!supabase) return;
    loadSavedTemplates();
    loadSavedEvents().then((events) => {
      const lastId = localStorage.getItem("nikadi_last_event");
      if (lastId) {
        const ev = events.find(e => e.id === lastId);
        if (ev) selectEvent(ev);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Persist active event ID so template auto-reloads on next visit */
  useEffect(() => {
    if (savedEventId) localStorage.setItem("nikadi_last_event", savedEventId);
    else localStorage.removeItem("nikadi_last_event");
  }, [savedEventId]);

  /* Close event dropdown on outside click */
  useEffect(() => {
    if (!eventDropdownOpen) return;
    const handleClick = (e) => {
      if (!e.target.closest(".nk-event-search")) setEventDropdownOpen(false);
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [eventDropdownOpen]);

  /* ── Upload template to Supabase Storage ── */
  const uploadTemplateToStorage = async (dataUrl) => {
    if (!supabase) return null;
    try {
      const res  = await fetch(dataUrl);
      const blob = await res.blob();
      const ext  = blob.type.split("/")[1] || "png";
      const path = `templates/tmpl_${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("templates").upload(path, blob, { contentType:blob.type });
      if (error) { console.warn("Storage:", error.message); return null; }
      const { data: { publicUrl } } = supabase.storage.from("templates").getPublicUrl(path);
      return publicUrl;
    } catch (e) { console.warn(e.message); return null; }
  };

  /* ── Saved templates: load / save / apply ── */
  const loadSavedTemplates = async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from("saved_templates").select("*").order("created_at", { ascending:false }).limit(50);
    if (!error && data) setSavedTemplates(data);
  };

  const saveCurrentTemplate = async () => {
    if (!supabase)   { showToast("Supabase not configured","warn"); return; }
    if (!bgImage)    { showToast("No template loaded to save","warn"); return; }
    const name = templateSaveName.trim();
    if (!name)       { showToast("Enter a template name","warn"); return; }

    let url = coverUrl;
    if (!url) {
      url = await uploadTemplateToStorage(bgImage);
      if (url) setCoverUrl(url);
    }

    const { error } = await supabase.from("saved_templates").insert([{
      name,
      cover_image_url: url || null,
      elements_layout: elements,
    }]);
    if (error) { showToast("Save failed: " + error.message, "warn"); return; }

    showToast(`Template "${name}" saved`, "success");
    setTemplateSaveName("");
    setShowSaveTemplate(false);
    loadSavedTemplates();
  };

  const applySavedTemplate = async (tpl) => {
    if (!tpl.cover_image_url) {
      if (tpl.elements_layout?.length) {
        setElements(tpl.elements_layout);
        setLayoutRestored(true);
        showToast(`Layout "${tpl.name}" applied`, "success");
      }
      return;
    }
    setLoadingTemplate(true);
    try {
      const res  = await fetch(tpl.cover_image_url);
      const blob = await res.blob();
      await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target.result;
          const fp      = templateFingerprint(dataUrl, tpl.cover_image_url);
          const img     = new Image();
          img.onload = () => {
            setBgImage(dataUrl);
            setBgSize({ w:img.naturalWidth, h:img.naturalHeight });
            if (Array.isArray(tpl.elements_layout) && tpl.elements_layout.length) {
              pendingDbLayout.current = tpl.elements_layout;
            }
            setTemplateKey(fp);
            setCoverUrl(tpl.cover_image_url);
            resolve();
          };
          img.src = dataUrl;
        };
        reader.readAsDataURL(blob);
      });
      showToast(`Template "${tpl.name}" applied`, "success");
    } catch { showToast("Could not load template", "warn"); }
    finally { setLoadingTemplate(false); }
  };

  const deleteSavedTemplate = async (tpl) => {
    if (!supabase) return;
    const { error } = await supabase.from("saved_templates").delete().eq("id", tpl.id);
    if (error) { showToast("Delete failed: " + error.message, "warn"); return; }
    showToast(`Template "${tpl.name}" deleted`, "success");
    loadSavedTemplates();
  };

  /* ── Background upload ── */
  const onBgUpload = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result;
      const fp      = templateFingerprint(dataUrl, f.name);
      const probe   = new Image();
      probe.onload = async () => {
        setBgImage(dataUrl);
        setBgSize({ w:probe.naturalWidth, h:probe.naturalHeight });
        setTemplateKey(fp); // triggers the layout-restore effect
        showToast(`Template loaded — ${probe.naturalWidth}×${probe.naturalHeight}px`, "success");
        if (supabase && !coverUrl) {
          const url = await uploadTemplateToStorage(dataUrl);
          if (url) { setCoverUrl(url); showToast("Template saved to cloud storage", "success"); }
        }
      };
      probe.src = dataUrl;
    };
    reader.readAsDataURL(f);
  };

  const resetTemplate = () => {
    setBgImage(null); setBgSize(null); setCoverUrl(null); setTemplateKey(null);
    setElements(defaultElements()); setLayoutRestored(false);
  };

  const resetLayout = () => {
    if (!templateKey) return;
    localStorage.removeItem(LAYOUT_PREFIX + templateKey);
    setElements(defaultElements());
    setLayoutRestored(false);
    showToast("Layout reset to defaults", "info");
  };

  /* ── Excel / CSV upload ── */
  const onExcelUpload = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      const wb   = XLSX.read(ev.target.result, { type:"array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { defval:"" });
      const norm = data.map(row => {
        const n = { waStatus:WA.idle, smsStatus:SMS.pending };
        Object.keys(row).forEach(k => {
          const kl = k.trim().toLowerCase().replace(/[\s_]/g,"");
          if      (kl==="name")                                             n.name     = String(row[k]);
          else if (kl==="cardtype"||kl==="card")                           n.cardType = String(row[k]);
          else if (kl==="phone"||kl==="phonenumber"||kl==="mobile")        n.phone    = String(row[k]);
          else n[k] = row[k];
        });
        return n;
      });
      setRecords(norm); setActiveIdx(0);
      showToast(`Loaded ${norm.length} records`, "success");
    };
    r.readAsArrayBuffer(f);
  };

  /* ── VCard CSV upload ── */
  const onVcardCsvUpload = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      const wb   = XLSX.read(ev.target.result, { type:"array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { defval:"" });
      const contacts = data.map(row => {
        const c = { name:"", phone:"" };
        Object.keys(row).forEach(k => {
          const kl = k.trim().toLowerCase().replace(/[\s_]/g,"");
          if (kl==="name") c.name = String(row[k]);
          else if (kl==="phone"||kl==="phonenumber"||kl==="mobile") c.phone = String(row[k]);
        });
        return c;
      }).filter(c => c.name || c.phone);
      setVcardContacts(contacts);
      showToast(`${contacts.length} contacts loaded for VCard`, "success");
    };
    r.readAsArrayBuffer(f);
  };

  const downloadVCard = () => {
    if (!vcardContacts.length) { showToast("Upload a CSV first","warn"); return; }
    const eu = eventData.username || "Nikadi";
    downloadBlob(generateVcf(vcardContacts, eu), `nikadi_contacts_${eu}.vcf`, "text/vcard");
    showToast(`Downloaded ${vcardContacts.length} contacts as VCard`, "success");
  };

  /* ── Save / upsert event ── */
  const persistEvent = async (formData, currentId = savedEventId) => {
    if (!supabase) { showToast("Supabase not configured","warn"); return null; }
    setIsSaving(true);
    try {
      const payload = {
        ...formData,
        cover_image_url: coverUrl||null,
        elements_layout: elements,
        start_datetime: formData.start_datetime||null,
        end_datetime:   formData.end_datetime||null,
      };
      if (currentId) {
        const { error } = await supabase.from("events").update(payload).eq("id", currentId);
        if (error) throw error;
        setEventData(formData);
        showToast("Event updated", "success");
        await loadSavedEvents();
        return currentId;
      } else {
        const { data, error } = await supabase.from("events").insert([payload]).select().single();
        if (error) throw error;
        setEventData(formData);
        setSavedEventId(data.id);
        showToast("Event created", "success");
        await loadSavedEvents();
        return data.id;
      }
    } catch (err) {
      showToast("Save failed: " + err.message, "warn");
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const saveCards = async (eventId) => {
    if (!supabase || !records.length) return;
    await supabase.from("event_cards").delete().eq("event_id", eventId);
    const rows = records.map(r => ({
      event_id:   eventId,
      name:       r.name||"",
      card_type:  r.cardType||"",
      phone:      r.phone||"",
      wa_status:  r.waStatus||WA.idle,
      sms_status: r.smsStatus||SMS.pending,
    }));
    const { error } = await supabase.from("event_cards").insert(rows);
    if (error) showToast("Cards save error: " + error.message, "warn");
    else showToast(`${records.length} cards saved`, "success");
  };

  const saveLayout = async () => {
    if (!supabase || !savedEventId) { showToast("Save the event first","warn"); return; }
    const { error } = await supabase.from("events").update({ elements_layout: elements }).eq("id", savedEventId);
    if (error) showToast("Layout save failed: " + error.message, "warn");
    else {
      if (templateKey) localStorage.setItem(LAYOUT_PREFIX + templateKey, JSON.stringify(elements));
      showToast("Layout saved to database", "success");
    }
  };

  const onModalSave = async (formData) => {
    const id = await persistEvent(formData, formData.id || null);
    if (id) setModalEvent(null);
  };

  /* ── Delete event ── */
  const deleteEvent = async (ev) => {
    if (!supabase) return;
    const { error } = await supabase.from("events").delete().eq("id", ev.id);
    if (error) { showToast("Delete failed: " + error.message, "warn"); return; }
    setSavedEvents(es => es.filter(e => e.id !== ev.id));
    if (savedEventId === ev.id) { setSavedEventId(null); setEventData(BLANK_EVENT); }
    setDeleteTarget(null);
    showToast(`Event "${ev.username}" deleted`, "success");
  };

  /* ── Core: load event data + template from DB into the designer ── */
  const selectEvent = async (eventIdOrObj) => {
    const ev = typeof eventIdOrObj === "string"
      ? savedEvents.find(e => e.id === eventIdOrObj)
      : eventIdOrObj;
    if (!ev) return;

    setEventData({
      username:       ev.username||"",
      phone:          ev.phone||"",
      event_type:     ev.event_type||"",
      status:         ev.status||"active",
      venue_name:     ev.venue_name||"",
      venue_address:  ev.venue_address||"",
      venue_location: ev.venue_location||"",
      start_datetime: ev.start_datetime ? ev.start_datetime.slice(0,16) : "",
      end_datetime:   ev.end_datetime   ? ev.end_datetime.slice(0,16)   : "",
    });
    setSavedEventId(ev.id);
    setCoverUrl(ev.cover_image_url||null);

    /* Clear canvas template when event has none */
    if (!ev.cover_image_url) {
      setBgImage(null); setBgSize(null); setTemplateKey(null);
      setElements(defaultElements()); setLayoutRestored(false);
    }

    /* Fetch template from Supabase Storage — only if URL changed */
    if (ev.cover_image_url && ev.cover_image_url !== coverUrl) {
      setLoadingTemplate(true);
      try {
        const res    = await fetch(ev.cover_image_url);
        const blob   = await res.blob();
        await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target.result;
            const fp      = templateFingerprint(dataUrl, ev.cover_image_url);
            const img     = new Image();
            img.onload = () => {
              setBgImage(dataUrl);
              setBgSize({ w:img.naturalWidth, h:img.naturalHeight });
              // Queue DB layout so templateKey effect applies it instead of localStorage
              if (Array.isArray(ev.elements_layout) && ev.elements_layout.length) {
                pendingDbLayout.current = ev.elements_layout;
              }
              setTemplateKey(fp);
              resolve();
            };
            img.src = dataUrl;
          };
          reader.readAsDataURL(blob);
        });
      } catch { showToast("Could not load template from database","warn"); }
      finally { setLoadingTemplate(false); }
    }

    /* Load cards */
    if (supabase) {
      const { data: cards } = await supabase.from("event_cards").select("*").eq("event_id", ev.id);
      if (cards?.length) {
        setRecords(cards.map(c => ({
          name:      c.name||"",
          cardType:  c.card_type||"",
          phone:     c.phone||"",
          waStatus:  c.wa_status||WA.idle,
          smsStatus: c.sms_status||SMS.pending,
        })));
        setActiveIdx(0);
      }
    }

    showToast(`"${ev.username}" loaded`, "success");
  };

  /* ── Sidebar dropdown handler ── */
  const onEventSelect = (id) => {
    if (!id) { setEventData(BLANK_EVENT); setSavedEventId(null); setCoverUrl(null); return; }
    selectEvent(id);
  };

  /* ── Events tab: Create Cards button ── */
  const createCardsFromEvent = async (ev) => {
    await selectEvent(ev);
    setTab("design");
  };

  /* ── Canvas helpers ── */
  const onMove     = (id,x,y) => setElements(els => els.map(el => el.id===id ? {...el,x,y} : el));
  const updateEl   = (prop,val) => setElements(els => els.map(el => el.id===selected ? {...el,[prop]:val} : el));
  const editRecord = (idx,field,val) => setRecords(rs => rs.map((r,i) => i===idx ? {...r,[field]:val} : r));

  /* ── WhatsApp ── */
  const openWaTest = (idx) => {
    const rec = records[idx];
    if (!rec.phone) { showToast("Add a phone number first","warn"); return; }
    const num = normalisePhone(rec.phone);
    if (num.length < 10) { showToast("Phone number too short","warn"); return; }
    window.open(`https://wa.me/${num}`, "_blank");
    setRecords(rs => rs.map((r,i) => i===idx ? {...r,waStatus:WA.testing} : r));
    showToast(`WhatsApp opened for ${rec.name} — confirm if chat appeared`, "info");
  };
  const confirmWa = (idx, isOnWa) => {
    setRecords(rs => rs.map((r,i) => i===idx ? {...r,waStatus:isOnWa?WA.yes:WA.no} : r));
    showToast(isOnWa ? `✓ ${records[idx].name} on WhatsApp` : `✗ ${records[idx].name} not on WhatsApp`, isOnWa?"success":"warn");
  };
  const testAllWa = async () => {
    const untested = records.map((r,i)=>({r,i})).filter(({r})=>r.phone&&r.waStatus===WA.idle);
    if (!untested.length) { showToast("All tested or no phones","warn"); return; }
    for (const {i} of untested) { openWaTest(i); await new Promise(r=>setTimeout(r,2000)); }
  };

  const buildWaMsg  = (rec) => waMessage.replace("{name}",rec.name||"").replace("{cardType}",rec.cardType||"");
  const buildSmsMsg = (rec) => smsMessage.replace("{name}",rec.name||"").replace("{cardType}",rec.cardType||"");

  const sendSingle = async (idx) => {
    const rec = records[idx];
    const url = await exportCard(bgImage, bgSize, designElements, rec);
    const a = document.createElement("a"); a.download=`${(rec.name||"card").replace(/\s/g,"_")}_Nikadi.png`; a.href=url; a.click();
    setTimeout(() => window.open(waLink(rec.phone, buildWaMsg(rec)), "_blank"), 400);
    showToast(`Card downloaded + WhatsApp opened for ${rec.name}`, "success");
    if (savedEventId) await saveCards(savedEventId);
  };

  const downloadCard = async (idx) => {
    const rec = records[idx];
    const url = await exportCard(bgImage, bgSize, designElements, rec);
    const a = document.createElement("a"); a.download=`${(rec.name||`Record_${idx}`).replace(/\s/g,"_")}_Nikadi.png`; a.href=url; a.click();
  };

  const downloadAll = async () => {
    if (!records.length) { showToast("No records","warn"); return; }
    showToast(`Zipping ${records.length} cards…`,"info");
    const zip = new JSZip();
    for (let i=0;i<records.length;i++) {
      const rec = records[i];
      const dataUrl = await exportCard(bgImage, bgSize, designElements, rec);
      zip.file(`${(rec.name||`Record_${i}`).replace(/\s/g,"_")}_Nikadi.png`, dataUrl.split(",")[1], { base64:true });
    }
    const blob = await zip.generateAsync({ type:"blob" });
    const a = document.createElement("a"); a.download="nikadi_cards.zip"; a.href=URL.createObjectURL(blob); a.click();
    URL.revokeObjectURL(a.href);
    showToast(`✓ nikadi_cards.zip (${records.length} cards)`, "success");
  };

  const sendAll = async () => {
    const ready = records.filter(r=>r.waStatus===WA.yes&&r.phone);
    if (!ready.length) { showToast("No confirmed WhatsApp numbers","warn"); return; }
    setBulkSending(true); setBulkLog([]);
    for (const rec of ready) {
      setBulkLog(l=>[...l,{name:rec.name,status:"sending"}]);
      const url = await exportCard(bgImage, bgSize, designElements, rec);
      const a = document.createElement("a"); a.download=`${(rec.name||"").replace(/\s/g,"_")}_Nikadi.png`; a.href=url; a.click();
      await new Promise(r=>setTimeout(r,800));
      window.open(waLink(rec.phone, buildWaMsg(rec)), "_blank");
      await new Promise(r=>setTimeout(r,1500));
      setBulkLog(l=>l.map(x=>x.name===rec.name?{...x,status:"sent"}:x));
    }
    setBulkSending(false);
    showToast(`Done — ${ready.length} cards sent`, "success");
    if (savedEventId) await saveCards(savedEventId);
  };

  /* ── SMS ── */
  const SMS_BASE = import.meta.env.DEV
    ? "/sms-proxy"
    : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms`;
  const SMS_API = `${SMS_BASE}/api/sms/v2`;

  const fetchSmsBalance = async () => {
    setSmsBalanceLoading(true);
    try {
      const res = await fetch(`${SMS_BASE}/api/v2/balance`, {
        headers: {
          Authorization: `Bearer ${smsSettings.bearerToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSmsBalance(data);
    } catch (err) {
      showToast(`Balance fetch failed: ${err.message}`, "warn");
    }
    setSmsBalanceLoading(false);
  };

  const sendSmsToOne = async (idx) => {
    const rec = records[idx];
    if (!rec.phone) { showToast("No phone for " + rec.name, "warn"); return; }
    setSmsLog(l => [...l, { name: rec.name, status: "sending" }]);
    try {
      const res = await fetch(`${SMS_API}/text/single`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${smsSettings.bearerToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          from: smsSettings.senderId || "NIKADI",
          to:   normalisePhone(rec.phone),
          text: buildSmsMsg(rec),
          flash: 0,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const grp = data?.messages?.[0]?.status?.groupId;
      if (grp === 18 || grp === 20) {
        const status = grp === 20 ? SMS.delivered : SMS.sent;
        const logStatus = grp === 20 ? "delivered" : "sent";
        setRecords(rs => rs.map((r, i) => i === idx ? { ...r, smsStatus: status } : r));
        setSmsLog(l => l.map(x => x.name === rec.name ? { ...x, status: logStatus } : x));
        showToast(`SMS ${logStatus} to ${rec.name}`, "success");
      } else {
        throw new Error(data?.messages?.[0]?.status?.name || "Unexpected status");
      }
    } catch (err) {
      setSmsLog(l => l.map(x => x.name === rec.name ? { ...x, status: "failed" } : x));
      setRecords(rs => rs.map((r, i) => i === idx ? { ...r, smsStatus: SMS.failed } : r));
      showToast(`SMS failed for ${rec.name}: ${err.message}`, "warn");
    }
  };

  const sendAllSms = async () => {
    const withPhone = records.filter(r => r.phone);
    if (!withPhone.length) { showToast("No phone numbers", "warn"); return; }
    setSmsSending(true);
    setSmsLog(withPhone.map(rec => ({ name: rec.name, status: "sending" })));
    try {
      const messages = withPhone.map(rec => ({
        from: smsSettings.senderId || "NIKADI",
        to:   normalisePhone(rec.phone),
        text: buildSmsMsg(rec),
      }));
      const res = await fetch(`${SMS_API}/text/multi`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${smsSettings.bearerToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ messages, flash: 0 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const respMsgs = data?.messages || [];
      setRecords(rs => rs.map(r => {
        if (!r.phone) return r;
        const match = respMsgs.find(m => m.to === normalisePhone(r.phone));
        if (!match) return r;
        if (match.status.groupId === 20) return { ...r, smsStatus: SMS.delivered };
        if (match.status.groupId === 18) return { ...r, smsStatus: SMS.sent };
        return { ...r, smsStatus: SMS.failed };
      }));
      setSmsLog(withPhone.map(rec => {
        const match = respMsgs.find(m => m.to === normalisePhone(rec.phone));
        const grp = match?.status?.groupId;
        const status = grp === 20 ? "delivered" : grp === 18 ? "sent" : "failed";
        return { name: rec.name, status };
      }));
      const sentCount = respMsgs.filter(m => m.status.groupId === 18 || m.status.groupId === 20).length;
      showToast(`Done — ${sentCount}/${withPhone.length} SMS sent`, "success");
    } catch (err) {
      setSmsLog(withPhone.map(rec => ({ name: rec.name, status: "failed" })));
      showToast(`Bulk SMS failed: ${err.message}`, "warn");
    }
    setSmsSending(false);
    if (savedEventId) await saveCards(savedEventId);
  };

  const downloadSmsCsv = () => {
    if (!records.length) { showToast("No records","warn"); return; }
    const rows = [["Phone","Message"], ...records.filter(r=>r.phone).map(r=>[`+${normalisePhone(r.phone)}`,buildSmsMsg(r)])];
    downloadBlob(rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n"), "nikadi_sms_list.csv", "text/csv");
    showToast(`Downloaded SMS list (${rows.length-1} recipients)`,"success");
  };

  /* ── Counts ── */
  const waOnCount      = records.filter(r=>r.waStatus===WA.yes).length;
  const waOffCount     = records.filter(r=>r.waStatus===WA.no).length;
  const waTestingCount = records.filter(r=>r.waStatus===WA.testing).length;
  const smsSentCount   = records.filter(r=>r.smsStatus===SMS.sent||r.smsStatus===SMS.delivered).length;
  const dbDot = dbStatus==="connected" ? "db-connected" : dbStatus==="unconfigured" ? "db-unconfigured" : "db-disconnected";

  /* ── Michango: hide QR + Card Type on canvas and exports ── */
  const isMichango   = eventData.event_type === "Michango";
  const designElements = isMichango
    ? elements.filter(el => el.id !== "qr" && el.id !== "cardtype")
    : elements;

  /* ══════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════ */
  if (user === undefined) return (
    <div style={{minHeight:"100vh",background:"#050d1f",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{width:40,height:40,border:"3px solid #1e3a5f",borderTopColor:"#3b82f6",borderRadius:"50%",animation:"spin 0.8s linear infinite"}} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!user) return <LoginPage />;

  return (
    <>
      <style>{CSS}</style>
      <div className="nk-app">

        {/* Toast */}
        {toast && (
          <div className={`nk-toast toast-${toast.type}`}>
            <span className="nk-toast-icon">{toast.type==="success"?"✓":toast.type==="warn"?"⚠":"ℹ"}</span>
            <span>{toast.msg}</span>
          </div>
        )}

        {/* Event modal */}
        {modalEvent !== null && (
          <EventModal initial={modalEvent} onSave={onModalSave} onClose={() => setModalEvent(null)} saving={isSaving} />
        )}

        {/* Delete confirm */}
        {deleteTarget && (
          <div className="nk-overlay">
            <div className="nk-confirm">
              <div className="nk-confirm-title">Delete Event?</div>
              <div className="nk-confirm-body">
                This will permanently delete <strong style={{color:N.text}}>"{deleteTarget.username}"</strong> and all its cards from the database. This cannot be undone.
              </div>
              <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button className="nk-btn nk-btn-ghost" onClick={()=>setDeleteTarget(null)}>Cancel</button>
                <button className="nk-btn nk-btn-danger" onClick={()=>deleteEvent(deleteTarget)}>🗑 Delete</button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <header className="nk-header">
          <div className="nk-logo">
            <div className="nk-logo-icon">N</div>
            <div>
              <div className="nk-logo-name">Nikadi Studio</div>
              <div className="nk-logo-tag">Card Design & Dispatch</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:16}}>
            <div className={`nk-db-dot ${dbDot}`} title={dbStatus} />
            <span style={{fontSize:11,color:N.textDim}}>{dbStatus === "connected" ? "Supabase ✓" : dbStatus === "unconfigured" ? "No DB" : "DB Error"}</span>
          </div>
          <div className="nk-header-actions">
            {savedEventId && (
              <span style={{fontSize:11,color:N.green,fontFamily:"JetBrains Mono, monospace"}}>
                ● {eventData.username||"Event"}{eventData.event_type ? ` · ${eventData.event_type}` : ""}
              </span>
            )}
            {waOnCount > 0 && (
              <button className="nk-btn nk-btn-success" onClick={sendAll} disabled={bulkSending}>
                {bulkSending ? "⏳ Sending…" : `📲 WA Send All (${waOnCount})`}
              </button>
            )}
            <button className="nk-btn nk-btn-primary" onClick={downloadAll}>
              ⬇ Download All ({records.length})
            </button>
            <button className="nk-btn nk-btn-ghost" onClick={testAllWa}>🔍 Test All WA</button>
            <div style={{display:"flex",alignItems:"center",gap:8,marginLeft:4,paddingLeft:12,borderLeft:`1px solid ${N.border}`}}>
              {user.user_metadata?.avatar_url && (
                <img src={user.user_metadata.avatar_url} alt="" style={{width:28,height:28,borderRadius:"50%",objectFit:"cover"}} />
              )}
              <span style={{fontSize:12,color:N.textMid,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {user.user_metadata?.full_name || user.email}
              </span>
              <button
                className="nk-btn nk-btn-ghost"
                style={{fontSize:12,padding:"4px 10px"}}
                onClick={() => supabase?.auth.signOut()}
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        {/* Tabs */}
        <nav className="nk-tabs">
          <button className={`nk-tab${tab==="events"?" active":""}`}  onClick={()=>{ loadSavedEvents(); setTab("events"); }}>🗂 Events</button>
          <button className={`nk-tab${tab==="design"?" active":""}`}  onClick={()=>setTab("design")}>🎨 Design</button>
          <button className={`nk-tab${tab==="vcard"?" active":""}`}   onClick={()=>setTab("vcard")}>📇 VCard</button>
          <button className={`nk-tab${tab==="sms"?" active":""}`}     onClick={()=>setTab("sms")}>💬 SMS</button>
          <button className={`nk-tab${tab==="batch"?" active":""}`}   onClick={()=>setTab("batch")}>📊 Batch & Send</button>
        </nav>

        {/* Info banners */}
        {tab==="batch" && (
          <div className="nk-banner">
            <span style={{fontSize:16,marginTop:1}}>ℹ</span>
            <span><strong>WhatsApp verification:</strong> Opens each <code>wa.me</code> link — confirm active numbers with <strong style={{color:N.green}}>✓ Yes</strong> or <strong style={{color:N.red}}>✗ No</strong>.</span>
          </div>
        )}
        {tab==="vcard" && (
          <div className="nk-banner">
            <span style={{fontSize:16,marginTop:1}}>ℹ</span>
            <span>Upload CSV with <code>Name</code> and <code>Phone</code> columns. Contacts will be saved as <code>{"{Name}"} {eventData.username||"EventUsername"}_Nikadi</code>.</span>
          </div>
        )}

        <div className="nk-body">

          {/* ═══ SIDEBAR (Design only) ═══ */}
          {tab === "design" && (
            <aside className="nk-sidebar">

              {/* Event selector with instant search */}
              <div className="nk-event-search" style={{position:"relative"}}>
                <div className="nk-sec">Select Event</div>
                {savedEventId ? (
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:13,fontWeight:500}}>{eventData.username}</span>
                    <button
                      onClick={() => {
                        setSavedEventId(null);
                        setEventData(BLANK_EVENT);
                        setEventSearch("");
                      }}
                      style={{background:"none",border:"none",color:N.red,cursor:"pointer",fontSize:16}}
                    >✕</button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      className="nk-input"
                      value={eventSearch}
                      onChange={e=>setEventSearch(e.target.value)}
                      onFocus={()=>setEventDropdownOpen(true)}
                      placeholder="🔍 Type to search..."
                      style={{marginBottom:4,fontSize:12}}
                    />
                    {eventDropdownOpen && (
                      <div className="nk-dropdown">
                        {savedEvents.filter(ev => {
                          if (!eventSearch) return true;
                          const s = eventSearch.toLowerCase();
                          return ev.username?.toLowerCase().includes(s) ||
                                 ev.event_type?.toLowerCase().includes(s) ||
                                 ev.venue_name?.toLowerCase().includes(s);
                        }).slice(0,10).map(ev => (
                          <div
                            key={ev.id}
                            className="nk-dropdown-item"
                            onClick={() => {
                              onEventSelect(ev.id);
                              setEventSearch("");
                              setEventDropdownOpen(false);
                            }}
                          >
                            <div style={{fontWeight:600,fontSize:13}}>{ev.username}</div>
                          </div>
                        ))}
                        {savedEvents.filter(ev => {
                          if (!eventSearch) return true;
                          const s = eventSearch.toLowerCase();
                          return ev.username?.toLowerCase().includes(s) ||
                                 ev.event_type?.toLowerCase().includes(s) ||
                                 ev.venue_name?.toLowerCase().includes(s);
                        }).length === 0 && (
                          <div style={{padding:12,color:N.textMid,fontSize:12}}>No events found</div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {loadingTemplate && (
                  <div style={{fontSize:11,color:N.amber,background:N.amberBg,border:`1px solid ${N.amber}44`,borderRadius:8,padding:"8px 12px",marginBottom:8,display:"flex",gap:8,alignItems:"center"}}>
                    <span>⏳</span> Loading template from database…
                  </div>
                )}

                {savedEventId && !loadingTemplate && (
                  <div className="nk-event-banner" onClick={()=>setTab("events")}>
                    <div className="nk-event-banner-name">{eventData.username}</div>
                    <div className="nk-event-banner-meta">
                      {eventData.event_type && <span>{eventData.event_type} · </span>}
                      {eventData.venue_name || "No venue"}
                      {eventData.start_datetime && <><br/>{new Date(eventData.start_datetime).toLocaleDateString("en-GB")}</>}
                    </div>
                    <div style={{fontSize:10,color:N.accent,marginTop:4}}>Click to manage events →</div>
                  </div>
                )}

                {!supabase && <p style={{fontSize:10,color:N.textDim,lineHeight:1.6}}>Connect Supabase to load saved events.</p>}
                {supabase && savedEvents.length===0 && (
                  <button className="nk-btn nk-btn-ghost nk-btn-full" style={{fontSize:11}} onClick={()=>setTab("events")}>+ Create First Event</button>
                )}
              </div>

              {/* Template */}
              <div>
                <div className="nk-sec">Card Template</div>
                <label className="nk-upload">
                  <input type="file" accept="image/*" style={{display:"none"}} onChange={onBgUpload} />
                  <span className="nk-upload-icon">🖼️</span>
                  <span className="nk-upload-label">Upload Template</span>
                  <span className="nk-upload-sub">PNG · JPG · SVG — positions auto-saved</span>
                </label>
                {bgSize && (
                  <div className="nk-chip">
                    📐 {bgSize.w} × {bgSize.h} px<br/>
                    <span className="nk-chip-ok">✓ Canvas locked to image</span>
                    {coverUrl && <><br/><span className="nk-chip-ok">☁ Saved to cloud</span></>}
                    {layoutRestored && <><br/><span className="nk-chip-ok">🔁 Layout restored</span></>}
                  </div>
                )}
                {bgImage && (
                  <div style={{display:"flex",gap:6}}>
                    <button className="nk-btn nk-btn-ghost nk-btn-full" style={{fontSize:11}} onClick={resetTemplate}>✕ Remove</button>
                    {templateKey && <button className="nk-btn nk-btn-ghost nk-btn-full" style={{fontSize:11}} onClick={resetLayout} title="Reset element positions to defaults">↺ Reset Layout</button>}
                  </div>
                )}
                {bgImage && supabase && (
                  showSaveTemplate ? (
                    <div style={{display:"flex",gap:6,marginTop:6}}>
                      <input
                        className="nk-input"
                        style={{fontSize:11,flex:1,padding:"4px 8px"}}
                        placeholder="Template name…"
                        value={templateSaveName}
                        onChange={e=>setTemplateSaveName(e.target.value)}
                        onKeyDown={e=>{ if(e.key==="Enter") saveCurrentTemplate(); if(e.key==="Escape") setShowSaveTemplate(false); }}
                        autoFocus
                      />
                      <button className="nk-btn nk-btn-primary" style={{fontSize:11,padding:"4px 10px"}} onClick={saveCurrentTemplate}>Save</button>
                      <button className="nk-btn nk-btn-ghost" style={{fontSize:11,padding:"4px 8px"}} onClick={()=>setShowSaveTemplate(false)}>✕</button>
                    </div>
                  ) : (
                    <button className="nk-btn nk-btn-ghost nk-btn-full" style={{fontSize:11,marginTop:6}} onClick={()=>{ setShowSaveTemplate(true); setTemplateSaveName(""); }}>
                      💾 Save as Template
                    </button>
                  )
                )}

                {/* Saved templates list */}
                {savedTemplates.length > 0 && (
                  <div style={{marginTop:10}}>
                    <div style={{fontSize:10,color:N.textDim,fontWeight:600,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Saved Templates</div>
                    {savedTemplates.map(tpl => (
                      <div key={tpl.id} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                        <button
                          className="nk-btn nk-btn-ghost nk-btn-full"
                          style={{fontSize:11,textAlign:"left",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                          title={`Apply "${tpl.name}"`}
                          onClick={()=>applySavedTemplate(tpl)}
                        >
                          🖼️ {tpl.name}
                        </button>
                        <button
                          className="nk-btn nk-btn-ghost"
                          style={{fontSize:10,padding:"3px 7px",color:N.red||"#f87171",flexShrink:0}}
                          title="Delete template"
                          onClick={()=>deleteSavedTemplate(tpl)}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Elements */}
              <div>
                <div className="nk-sec">Elements</div>
                {isMichango && (
                  <div className="nk-michango-badge">
                    <span>🚫</span>
                    <span><strong>Michango mode</strong><br/>QR Code &amp; Card Type hidden from card</span>
                  </div>
                )}
                {elements.map(el => {
                  const hidden = isMichango && (el.id==="qr" || el.id==="cardtype");
                  return (
                    <div key={el.id}
                      className={`nk-el-pill${selected===el.id&&!hidden?" active":""}${hidden?" disabled":""}`}
                      onClick={()=>!hidden&&setSelected(el.id)}
                      title={hidden?"Hidden for Michango events":""}>
                      <span style={{fontWeight:600,fontSize:13}}>{el.label}</span>
                      <span className="nk-el-type">{hidden?"hidden":el.type}</span>
                    </div>
                  );
                })}
                {savedEventId && (
                  <button className="nk-btn nk-btn-ghost nk-btn-full" style={{fontSize:11,marginTop:4}}
                    onClick={saveLayout}>
                    💾 Save Layout to DB
                  </button>
                )}
              </div>

              {/* Contacts */}
              <div>
                <div className="nk-sec">Contacts (Cards)</div>
                <label className="nk-upload">
                  <input type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={onExcelUpload} />
                  <span className="nk-upload-icon">📊</span>
                  <span className="nk-upload-label">Upload Spreadsheet</span>
                  <span className="nk-upload-sub">Name · CardType · Phone</span>
                </label>
                {savedEventId && records.length > 0 && (
                  <button className="nk-btn nk-btn-ghost nk-btn-full" style={{fontSize:11,marginTop:4}}
                    onClick={()=>saveCards(savedEventId)}>
                    💾 Save Cards to DB ({records.length})
                  </button>
                )}
              </div>

              {/* WhatsApp message */}
              <div>
                <div className="nk-sec">WhatsApp Message</div>
                <textarea className="nk-input nk-textarea" value={waMessage} onChange={e=>setWaMessage(e.target.value)} />
                <p style={{fontSize:10,color:N.textDim,lineHeight:1.7}}>
                  Variables: <code style={{fontFamily:"JetBrains Mono, monospace",color:N.sky,fontSize:11}}>{"{name}"}</code> &nbsp;
                  <code style={{fontFamily:"JetBrains Mono, monospace",color:N.sky,fontSize:11}}>{"{cardType}"}</code>
                </p>
              </div>

            </aside>
          )}

          {/* ═══ MAIN CONTENT ═══ */}
          <main className={tab==="design" ? "nk-main" : "nk-main-wide"}>

            {/* ─── EVENTS (CRUD) ─── */}
            {tab === "events" && (
              <div className="nk-page" style={{padding:"0 0 40px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
                  <div>
                    <h2 style={{fontSize:20,fontWeight:800,color:N.text}}>Events</h2>
                    <p style={{fontSize:12,color:N.textDim,marginTop:2}}>{savedEvents.length} event{savedEvents.length!==1?"s":""} · Click "Create Cards" to design cards for an event</p>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={loadSavedEvents}>↺ Refresh</button>
                    <button className="nk-btn nk-btn-primary" onClick={()=>setModalEvent(BLANK_EVENT)}>+ New Event</button>
                  </div>
                </div>

                {!supabase && (
                  <div style={{textAlign:"center",padding:60,color:N.textDim,background:N.navy800,borderRadius:16,border:`1px solid ${N.border}`}}>
                    <div style={{fontSize:48,marginBottom:12}}>🔌</div>
                    <p style={{fontWeight:700,marginBottom:6}}>Supabase not configured</p>
                    <p style={{fontSize:12}}>Add <code style={{fontFamily:"JetBrains Mono, monospace",color:N.sky}}>VITE_SUPABASE_URL</code> and <code style={{fontFamily:"JetBrains Mono, monospace",color:N.sky}}>VITE_SUPABASE_ANON_KEY</code> to <code style={{fontFamily:"JetBrains Mono, monospace",color:N.sky}}>.env.local</code> and restart the dev server.</p>
                  </div>
                )}

                {supabase && savedEvents.length === 0 && (
                  <div style={{textAlign:"center",padding:60,color:N.textDim,background:N.navy800,borderRadius:16,border:`1px solid ${N.border}`}}>
                    <div style={{fontSize:48,marginBottom:12}}>🗂️</div>
                    <p style={{fontWeight:700,marginBottom:6}}>No events yet</p>
                    <p style={{fontSize:12,marginBottom:20}}>Create your first event to get started.</p>
                    <button className="nk-btn nk-btn-primary" onClick={()=>setModalEvent(BLANK_EVENT)}>+ Create First Event</button>
                  </div>
                )}

                {supabase && savedEvents.length > 0 && (
                  <div className="nk-table-wrap">
                    <table className="nk-table">
                      <thead>
                        <tr>
                          {["#","Username","Type","Venue","Date","Status","Actions"].map(h=><th key={h}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {savedEvents.map((ev, i) => (
                          <tr key={ev.id} className={savedEventId===ev.id?"row-active":""}>
                            <td style={{color:N.textDim,fontFamily:"JetBrains Mono, monospace",fontSize:11}}>{i+1}</td>
                            <td>
                              <div style={{fontWeight:700,color:N.text}}>{ev.username}</div>
                              {ev.phone && <div style={{fontSize:11,color:N.textDim,fontFamily:"JetBrains Mono, monospace"}}>+{normalisePhone(ev.phone)}</div>}
                            </td>
                            <td><span style={{color:N.textMid,fontSize:12}}>{ev.event_type||"—"}</span></td>
                            <td>
                              <div style={{fontSize:12,color:N.textMid}}>{ev.venue_name||"—"}</div>
                              {ev.venue_address && <div style={{fontSize:11,color:N.textDim}}>{ev.venue_address}</div>}
                            </td>
                            <td style={{fontFamily:"JetBrains Mono, monospace",fontSize:11,color:N.textMid}}>
                              {ev.start_datetime ? new Date(ev.start_datetime).toLocaleDateString("en-GB") : "—"}
                              {ev.end_datetime && <><br/>{new Date(ev.end_datetime).toLocaleDateString("en-GB")}</>}
                            </td>
                            <td>
                              <span className={`nk-badge ${ev.status==="active"?"badge-yes":ev.status==="completed"?"badge-sent":"badge-no"}`}>
                                {ev.status}
                              </span>
                            </td>
                            <td>
                              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                                <Sb bg={N.accent} col="#fff" border={N.accent}
                                  onClick={()=>createCardsFromEvent(ev)}
                                  title="Load this event and open card designer">
                                  🎨 Create Cards
                                </Sb>
                                <Sb bg={N.navy600} col={N.sky} border={N.sky+"44"}
                                  onClick={()=>setModalEvent({...ev, start_datetime: ev.start_datetime?ev.start_datetime.slice(0,16):"", end_datetime: ev.end_datetime?ev.end_datetime.slice(0,16):""})}
                                  title="Edit event details">
                                  ✏ Edit
                                </Sb>
                                <Sb bg={N.redBg} col={N.red} border={N.red+"44"}
                                  onClick={()=>setDeleteTarget(ev)}
                                  title="Delete this event">
                                  🗑 Delete
                                </Sb>
                                {ev.cover_image_url && (
                                  <Sb bg={N.navy700} col={N.textMid} border={N.border}
                                    onClick={()=>window.open(ev.cover_image_url,"_blank")}
                                    title="View template">
                                    🖼
                                  </Sb>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ─── DESIGN ─── */}
            {tab === "design" && (
              <>
                <div className="nk-hint" style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",justifyContent:"center"}}>
                  <span>{bgSize ? `Canvas: ${cw}×${ch}px — matches template` : "Default 440×280 · Upload template to match dimensions"}</span>
                  {layoutRestored && <span className="nk-layout-chip">🔁 Layout restored</span>}
                  {!savedEventId && <span style={{color:N.amber,fontSize:11}}>⚠ No event loaded — <span style={{cursor:"pointer",textDecoration:"underline"}} onClick={()=>setTab("events")}>select one</span></span>}
                </div>
                <CardCanvas bgImage={bgImage} bgSize={bgSize} elements={designElements}
                  record={activeRecord} selected={selected} onSelect={setSelected} onMove={onMove} />
                <div className="nk-rec-pills">
                  {records.map((r,i)=>(
                    <button key={i} className={`nk-rec-pill${i===activeIdx?" active":""}`} onClick={()=>setActiveIdx(i)}>
                      {r.name||`#${i+1}`}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* ─── VCARD ─── */}
            {tab === "vcard" && (
              <div className="nk-page" style={{padding:"0 0 40px"}}>
                <div style={{display:"flex",gap:24,alignItems:"flex-start"}}>
                  <div style={{flex:"0 0 320px"}}>
                    <div className="nk-sec nk-sec-purple">Upload Contact CSV</div>
                    <label className="nk-upload" style={{marginBottom:12}}>
                      <input type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={onVcardCsvUpload} />
                      <span className="nk-upload-icon">📇</span>
                      <span className="nk-upload-label">Upload CSV for VCard</span>
                      <span className="nk-upload-sub">Columns: Name · Phone</span>
                    </label>
                    {vcardContacts.length > 0 && (
                      <div className="nk-chip" style={{marginBottom:12}}>
                        📇 {vcardContacts.length} contacts loaded<br/>
                        <span className="nk-chip-ok">Event Username: {eventData.username||"— set via Events tab"}</span>
                      </div>
                    )}
                    <div style={{marginBottom:12}}>
                      <label className="nk-label">Contact Name Format</label>
                      <div style={{background:N.navy900,border:`1px solid ${N.border}`,borderRadius:8,padding:"10px 12px",fontFamily:"JetBrains Mono, monospace",fontSize:12,color:N.sky}}>
                        {"{Name}"} {eventData.username||"EventUsername"}_Nikadi
                      </div>
                      <p style={{fontSize:10,color:N.textDim,marginTop:6,lineHeight:1.6}}>
                        Example: <span style={{color:N.green}}>Juma Hasani {eventData.username||"Mwajuma"}_Nikadi</span>
                      </p>
                    </div>
                    <button className="nk-btn nk-btn-purple nk-btn-full" onClick={downloadVCard} disabled={!vcardContacts.length}>
                      ⬇ Download .vcf File
                    </button>
                    {!eventData.username && (
                      <p style={{fontSize:11,color:N.amber,marginTop:8,textAlign:"center"}}>
                        ⚠ Load an event first to set the username
                      </p>
                    )}
                  </div>
                  <div style={{flex:1}}>
                    <div className="nk-sec nk-sec-purple">VCard Preview</div>
                    {vcardContacts.length > 0 ? (
                      <>
                        <div className="nk-vcard-preview">
                          {generateVcf(vcardContacts.slice(0,5), eventData.username||"EventUsername")}
                          {vcardContacts.length>5 && `\n\n… and ${vcardContacts.length-5} more contacts`}
                        </div>
                        <div className="nk-table-wrap">
                          <table className="nk-table">
                            <thead><tr>{["#","Name","Phone","VCard Name"].map(h=><th key={h}>{h}</th>)}</tr></thead>
                            <tbody>
                              {vcardContacts.map((c,i)=>(
                                <tr key={i}>
                                  <td style={{color:N.accent,fontFamily:"JetBrains Mono, monospace",fontSize:12}}>#{i+1}</td>
                                  <td style={{fontWeight:600}}>{c.name||"—"}</td>
                                  <td style={{fontFamily:"JetBrains Mono, monospace",fontSize:12,color:N.textMid}}>+{normalisePhone(c.phone)}</td>
                                  <td style={{color:N.purple,fontSize:12}}>{c.name} {eventData.username||"EventUsername"}_Nikadi</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : (
                      <div style={{textAlign:"center",padding:60,color:N.textDim}}>
                        <div style={{fontSize:48,marginBottom:12}}>📇</div>
                        <p>Upload a CSV to preview VCard contacts</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ─── SMS ─── */}
            {tab === "sms" && (
              <div className="nk-page" style={{padding:"0 0 40px"}}>
                <div style={{display:"flex",gap:24,alignItems:"flex-start"}}>
                  <div style={{flex:"0 0 340px"}}>
                    <div className="nk-sec nk-sec-teal">SMS Message</div>
                    <p style={{fontSize:11,color:N.textDim,marginBottom:8,lineHeight:1.6}}>Separate from WhatsApp — sent as plain SMS.</p>
                    <textarea className="nk-input nk-textarea" value={smsMessage} onChange={e=>setSmsMessage(e.target.value)} rows={5} />
                    <p style={{fontSize:10,color:N.textDim,lineHeight:1.7,marginBottom:14}}>
                      Variables: <code style={{fontFamily:"JetBrains Mono, monospace",color:N.sky,fontSize:11}}>{"{name}"}</code> &nbsp;
                      <code style={{fontFamily:"JetBrains Mono, monospace",color:N.sky,fontSize:11}}>{"{cardType}"}</code>
                    </p>
                    {(()=>{
                      const sample   = buildSmsMsg(records[0]||{});
                      const len      = sample.length;
                      const parts    = len === 0 ? 1 : len <= 160 ? 1 : Math.ceil(len / 153);
                      const contacts = records.filter(r=>r.phone).length;
                      const total    = parts * contacts;
                      return (
                        <div style={{background:N.cardBg,border:`1px solid ${N.border}`,borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:11}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                            <span style={{color:N.textDim}}>Characters</span>
                            <span style={{fontFamily:"JetBrains Mono, monospace",color:len>160?N.amber:N.textMid}}>
                              {len} / {len<=160?160:`${Math.ceil(len/153)*153} (${parts}×153)`}
                            </span>
                          </div>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                            <span style={{color:N.textDim}}>SMS per message</span>
                            <span style={{fontFamily:"JetBrains Mono, monospace",color:parts>1?N.amber:N.green,fontWeight:600}}>{parts} {parts>1?"parts":"part"}</span>
                          </div>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                            <span style={{color:N.textDim}}>Contacts with phone</span>
                            <span style={{fontFamily:"JetBrains Mono, monospace",color:N.textMid}}>{contacts}</span>
                          </div>
                          <div style={{height:1,background:N.border,margin:"6px 0"}}/>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                            <span style={{color:N.textDim,fontWeight:600}}>Total SMS credits</span>
                            <span style={{fontFamily:"JetBrains Mono, monospace",fontWeight:700,color:N.teal,fontSize:13}}>{total.toLocaleString()}</span>
                          </div>
                          <div style={{display:"flex",justifyContent:"space-between"}}>
                            <span style={{color:N.textDim,fontWeight:600}}>Amount (TZS)</span>
                            <span style={{fontFamily:"JetBrains Mono, monospace",fontWeight:700,color:N.amber,fontSize:13}}>{(total*16).toLocaleString()} Tsh</span>
                          </div>
                        </div>
                      );
                    })()}
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                      <div className="nk-sec nk-sec-teal" style={{margin:0}}>Remaining SMS</div>
                      <button className="nk-btn nk-btn-ghost" style={{padding:"3px 10px",fontSize:11}} onClick={fetchSmsBalance} disabled={smsBalanceLoading}>
                        {smsBalanceLoading?"⏳":"↻"} Refresh
                      </button>
                    </div>
                    <div style={{background:N.tealBg,border:`1.5px solid ${N.teal}55`,borderRadius:10,padding:"18px 20px",marginBottom:14,textAlign:"center"}}>
                      {smsBalanceLoading ? (
                        <div style={{color:N.textDim,fontSize:13,padding:"8px 0"}}>Loading…</div>
                      ) : smsBalance ? (
                        <>
                          <div style={{fontFamily:"JetBrains Mono, monospace",fontSize:36,fontWeight:800,color:N.teal,lineHeight:1}}>
                            {Math.floor(smsBalance.sms_balance / 16).toLocaleString()}
                          </div>
                          <div style={{fontSize:11,color:N.textDim,marginTop:4,marginBottom:10}}>SMS remaining</div>
                          <div style={{display:"flex",justifyContent:"center",gap:16}}>
                            <div style={{textAlign:"center"}}>
                              <div style={{fontSize:12,fontWeight:600,color:N.textMid}}>{smsBalance.display}</div>
                              <div style={{fontSize:10,color:N.textDim}}>Balance</div>
                            </div>
                            <div style={{width:1,background:N.border}}/>
                            <div style={{textAlign:"center"}}>
                              <div style={{fontSize:12,fontWeight:600,color:N.textMid}}>{smsBalance.default}</div>
                              <div style={{fontSize:10,color:N.textDim}}>Channel</div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div style={{color:N.textDim,fontSize:12,padding:"8px 0"}}>Click Refresh to load balance</div>
                      )}
                    </div>
                    <button className="nk-btn nk-btn-teal nk-btn-full" onClick={sendAllSms} disabled={smsSending}>
                      {smsSending?"⏳ Sending…":`💬 Send SMS to All (${records.filter(r=>r.phone).length})`}
                    </button>
                    <button className="nk-btn nk-btn-ghost nk-btn-full" onClick={downloadSmsCsv}>
                      ⬇ Download SMS CSV
                    </button>
                  </div>
                  {/* ── iPhone Pro Max Mockup ── */}
                  <div style={{flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
                    <div style={{fontSize:11,color:N.textDim,fontWeight:600,letterSpacing:1,textTransform:"uppercase"}}>Preview</div>
                    {/* phone shell */}
                    <div style={{
                      width:220,background:"linear-gradient(160deg,#2a2a2e,#1a1a1c)",
                      borderRadius:44,
                      padding:"10px 7px 14px",
                      boxShadow:"0 0 0 1.5px #3c3c3e, 0 0 0 3px #1a1a1c, inset 0 1px 0 rgba(255,255,255,0.08), 0 24px 60px rgba(0,0,0,0.7)",
                      position:"relative",
                    }}>
                      {/* side button left */}
                      <div style={{position:"absolute",left:-3,top:80,width:3,height:28,background:"#3a3a3c",borderRadius:"2px 0 0 2px"}}/>
                      <div style={{position:"absolute",left:-3,top:118,width:3,height:52,background:"#3a3a3c",borderRadius:"2px 0 0 2px"}}/>
                      <div style={{position:"absolute",left:-3,top:180,width:3,height:52,background:"#3a3a3c",borderRadius:"2px 0 0 2px"}}/>
                      {/* side button right */}
                      <div style={{position:"absolute",right:-3,top:120,width:3,height:72,background:"#3a3a3c",borderRadius:"0 2px 2px 0"}}/>
                      {/* screen bezel */}
                      <div style={{background:"#000",borderRadius:36,overflow:"hidden",position:"relative"}}>
                        {/* Dynamic Island */}
                        <div style={{position:"absolute",top:10,left:"50%",transform:"translateX(-50%)",width:80,height:26,background:"#000",borderRadius:20,zIndex:10,boxShadow:"0 0 0 1px #1c1c1c"}}/>
                        {/* screen content */}
                        <div style={{background:"#f5f5f5",display:"flex",flexDirection:"column",height:440}}>
                          {/* status bar */}
                          <div style={{paddingTop:14,paddingBottom:4,paddingLeft:20,paddingRight:16,display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:9,fontWeight:600,color:"#000",background:"#f5f5f5",flexShrink:0}}>
                            <span>9:41</span>
                            <div style={{display:"flex",gap:4,alignItems:"center",fontSize:9}}>
                              <span>●●●</span><span>WiFi</span><span>🔋</span>
                            </div>
                          </div>
                          {/* nav bar */}
                          <div style={{background:"#f5f5f5",borderBottom:"1px solid #e0e0e0",padding:"6px 12px",display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                            <span style={{fontSize:16,color:"#007aff"}}>‹</span>
                            <div style={{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,#0a7ea4,#0d9da8)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#fff",flexShrink:0}}>N</div>
                            <div style={{flex:1}}>
                              <div style={{fontSize:11,fontWeight:700,color:"#000",lineHeight:1.2}}>NIKADI</div>
                              <div style={{fontSize:9,color:"#8e8e93"}}>Text Message</div>
                            </div>
                            <span style={{fontSize:14,color:"#007aff"}}>📞</span>
                          </div>
                          {/* message area */}
                          <div style={{flex:1,minHeight:0,padding:"10px 8px",overflowY:"auto",display:"flex",flexDirection:"column",gap:6,background:"#fff"}}>
                            {/* timestamp */}
                            <div style={{textAlign:"center",fontSize:9,color:"#8e8e93",marginBottom:4,marginTop:"auto"}}>Today 9:41 AM</div>
                            {/* received bubble */}
                            <div style={{display:"flex",alignItems:"flex-end",gap:4}}>
                              <div style={{width:20,height:20,borderRadius:"50%",background:"linear-gradient(135deg,#0a7ea4,#0d9da8)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,color:"#fff",flexShrink:0}}>N</div>
                              <div style={{
                                background:"#e5e5ea",
                                borderRadius:"16px 16px 16px 4px",
                                padding:"7px 10px",
                                maxWidth:"82%",
                                fontSize:10,
                                lineHeight:1.5,
                                color:"#000",
                                wordBreak:"break-word",
                                whiteSpace:"pre-wrap",
                              }}>
                                {buildSmsMsg(records[0]||{name:"Mwanakadi",cardType:"VIP"})}
                              </div>
                            </div>
                            <div style={{textAlign:"left",paddingLeft:28,fontSize:8,color:"#8e8e93"}}>Delivered</div>
                          </div>
                          {/* input bar */}
                          <div style={{background:"#f5f5f5",borderTop:"1px solid #e0e0e0",padding:"6px 8px",display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                            <span style={{fontSize:14,color:"#007aff"}}>➕</span>
                            <div style={{flex:1,background:"#fff",border:"1px solid #c7c7cc",borderRadius:14,padding:"4px 10px",fontSize:9,color:"#c7c7cc"}}>iMessage</div>
                            <span style={{fontSize:14,color:"#007aff"}}>🎤</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* home bar */}
                    <div style={{width:60,height:4,background:"#3a3a3c",borderRadius:2,marginTop:-6}}/>
                  </div>

                  <div style={{flex:1}}>
                    <div className="nk-sec nk-sec-teal">SMS Preview per Recipient</div>
                    {smsLog.length > 0 && (
                      <div className="nk-log" style={{marginBottom:16}}>
                        <div className="nk-sec">Send Log</div>
                        {smsLog.map((x,i)=>(
                          <div key={i} className="nk-log-row" style={{color:x.status==="delivered"?N.green:x.status==="sent"?N.teal:x.status==="failed"?N.red:N.textMid}}>
                            <span>{x.status==="delivered"?"✓✓":x.status==="sent"?"↑":x.status==="failed"?"✗":"⏳"}</span>
                            <span>{x.name}</span>
                            <span style={{fontSize:11,color:N.textDim,textTransform:"capitalize"}}>{x.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="nk-table-wrap">
                      <table className="nk-table">
                        <thead><tr>{["#","Name","Phone","SMS Preview","Status",""].map(h=><th key={h}>{h}</th>)}</tr></thead>
                        <tbody>
                          {records.map((rec,i)=>(
                            <tr key={i}>
                              <td style={{color:N.accent,fontFamily:"JetBrains Mono, monospace",fontSize:12}}>#{i+1}</td>
                              <td style={{fontWeight:600}}>{rec.name}</td>
                              <td style={{fontFamily:"JetBrains Mono, monospace",fontSize:12,color:N.textMid}}>
                                {rec.phone?`+${normalisePhone(rec.phone)}`:<span style={{color:N.textDim}}>—</span>}
                              </td>
                              <td style={{fontSize:11,color:N.textMid,maxWidth:260}}>
                                <div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{buildSmsMsg(rec)}</div>
                              </td>
                              <td>
                                <span className={`nk-badge ${rec.smsStatus===SMS.delivered?"badge-yes":rec.smsStatus===SMS.sent?"badge-sent":rec.smsStatus===SMS.failed?"badge-no":"badge-idle"}`}>
                                  {rec.smsStatus===SMS.delivered?"✓ Delivered":rec.smsStatus===SMS.sent?"↑ Sent":rec.smsStatus===SMS.failed?"✗ Failed":"○ Pending"}
                                </span>
                              </td>
                              <td>{rec.phone?<Sb bg={N.tealBg} col={N.teal} border={N.teal+"44"} onClick={()=>sendSmsToOne(i)}>💬 Send</Sb>:<span style={{fontSize:11,color:N.textDim}}>—</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ─── BATCH & SEND ─── */}
            {tab === "batch" && (
              <div className="nk-page" style={{padding:"0 0 40px"}}>
                <div className="nk-stats">
                  {[
                    ["Total",     records.length,                                           N.textMid],
                    ["WA ✓",      waOnCount,                                                N.green],
                    ["Not on WA", waOffCount,                                               N.red],
                    ["Awaiting",  waTestingCount,                                           N.amber],
                    ["SMS Sent",  smsSentCount,                                             N.teal],
                    ["Unchecked", records.length-waOnCount-waOffCount-waTestingCount,       N.textDim],
                  ].map(([l,v,c])=>(
                    <div key={l} className="nk-stat" style={{borderColor:c+"33"}}>
                      <div className="nk-stat-num" style={{color:c}}>{v}</div>
                      <div className="nk-stat-label">{l}</div>
                    </div>
                  ))}
                </div>
                {bulkLog.length > 0 && (
                  <div className="nk-log">
                    <div className="nk-sec">WhatsApp Log</div>
                    {bulkLog.map((x,i)=>(
                      <div key={i} className="nk-log-row" style={{color:x.status==="sent"?N.green:N.textMid}}>
                        <span>{x.status==="sent"?"✓":"⏳"}</span><span>{x.name}</span>
                        <span style={{fontSize:11,color:N.textDim}}>{x.status==="sent"?"Sent":"Sending…"}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="nk-table-wrap">
                  <table className="nk-table">
                    <thead><tr>{["#","Name","Card Type","Phone","WA Status","SMS","Actions"].map(h=><th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {records.map((rec,i)=>(
                        <RecordRow key={i} rec={rec} idx={i}
                          onEdit={editRecord} onOpenTest={openWaTest} onConfirmWa={confirmWa}
                          onSendSingle={sendSingle} onDownload={downloadCard}
                          onSendSms={sendSmsToOne}
                          isActive={activeIdx===i}
                          onActivate={()=>{ setActiveIdx(i); setTab("design"); }} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </main>

          {/* ═══ RIGHT SIDEBAR (Design tab) ═══ */}
          {tab === "design" && (
            <aside className="nk-sidebar-right">
              <div className="nk-sec">Element Properties</div>
              {!selectedEl && <p style={{fontSize:12,color:N.textDim,lineHeight:1.6}}>Click an element on the canvas to edit its properties.</p>}

              {selectedEl?.type==="text" && (
                <>
                  <label className="nk-label">Font Size — {selectedEl.fontSize}px</label>
                  <input type="range" min={8} max={Math.round(ch*0.5)} value={selectedEl.fontSize} onChange={e=>updateEl("fontSize",Number(e.target.value))} />
                  <label className="nk-label">Color</label>
                  <input type="color" value={selectedEl.color} onChange={e=>updateEl("color",e.target.value)} className="nk-input" style={{height:40,padding:4}} />
                  <label className="nk-label">Weight</label>
                  <button className="nk-btn nk-btn-full" style={{marginBottom:10,background:selectedEl.bold?N.accent:"transparent",color:selectedEl.bold?"#fff":N.textMid,border:`1.5px solid ${selectedEl.bold?N.accent:N.border}`,borderRadius:8}} onClick={()=>updateEl("bold",!selectedEl.bold)}>
                    {selectedEl.bold?"Bold ON":"Bold OFF"}
                  </button>
                  <label className="nk-label">Alignment</label>
                  <div style={{display:"flex",gap:6,marginBottom:10}}>
                    {["left","center","right"].map(a=>(
                      <button key={a} onClick={()=>updateEl("align",a)}
                        style={{flex:1,padding:"7px 0",borderRadius:8,border:`1.5px solid ${(selectedEl.align||"left")===a?N.accent:N.border}`,background:(selectedEl.align||"left")===a?N.accent+"22":"transparent",color:(selectedEl.align||"left")===a?N.sky:N.textDim,cursor:"pointer",fontSize:16,fontFamily:"inherit"}}>
                        {a==="left"?"⬅":a==="center"?"⬛":"➡"}
                      </button>
                    ))}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <div><label className="nk-label">X (px)</label><input type="number" value={Math.round(selectedEl.x)} onChange={e=>updateEl("x",Number(e.target.value))} className="nk-input" /></div>
                    <div><label className="nk-label">Y (px)</label><input type="number" value={Math.round(selectedEl.y)} onChange={e=>updateEl("y",Number(e.target.value))} className="nk-input" /></div>
                  </div>
                </>
              )}

              {selectedEl?.type==="qr" && (
                <>
                  <label className="nk-label">QR Size — {selectedEl.size}px</label>
                  <input type="range" min={60} max={Math.round(Math.min(cw,ch)*0.8)} value={selectedEl.size} onChange={e=>updateEl("size",Number(e.target.value))} />
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <div><label className="nk-label">X (px)</label><input type="number" value={Math.round(selectedEl.x)} onChange={e=>updateEl("x",Number(e.target.value))} className="nk-input" /></div>
                    <div><label className="nk-label">Y (px)</label><input type="number" value={Math.round(selectedEl.y)} onChange={e=>updateEl("y",Number(e.target.value))} className="nk-input" /></div>
                  </div>
                  <p style={{fontSize:11,color:N.textDim,lineHeight:1.6,marginTop:4}}>Encodes: <code style={{fontFamily:"JetBrains Mono, monospace",color:N.sky,fontSize:11}}>Name=…;TypeCard=…</code></p>
                </>
              )}

              <div className="nk-divider" style={{marginTop:8}} />

              <div className="nk-chip">
                Canvas: {cw} × {ch} px<br/>
                Export: {cw} × {ch} px<br/>
                {bgSize ? <span className="nk-chip-ok">✓ Locked to template</span> : <span className="nk-chip-warn">⚠ Default size</span>}
              </div>

              <div className="nk-divider" />
              <div className="nk-sec">Edit Record</div>

              <label className="nk-label">Name</label>
              <input className="nk-input" value={activeRecord.name||""} onChange={e=>editRecord(activeIdx,"name",e.target.value)} />
              <label className="nk-label">Card Type</label>
              <input className="nk-input" value={activeRecord.cardType||""} onChange={e=>editRecord(activeIdx,"cardType",e.target.value)} />
              <label className="nk-label">Phone</label>
              <input className="nk-input" value={activeRecord.phone||""} onChange={e=>editRecord(activeIdx,"phone",e.target.value)} placeholder="+255…" />

              <button className="nk-btn nk-btn-primary nk-btn-full" onClick={()=>openWaTest(activeIdx)}>🔍 Test on WhatsApp</button>
              {activeRecord.waStatus===WA.testing && (
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <button className="nk-btn nk-btn-success" style={{flex:1}} onClick={()=>confirmWa(activeIdx,true)}>✓ Yes</button>
                  <button className="nk-btn nk-btn-danger"  style={{flex:1}} onClick={()=>confirmWa(activeIdx,false)}>✗ No</button>
                </div>
              )}
              {activeRecord.waStatus===WA.yes && (
                <button className="nk-btn nk-btn-success nk-btn-full" onClick={()=>sendSingle(activeIdx)}>📲 Send via WhatsApp</button>
              )}

              <button className="nk-btn nk-btn-ghost nk-btn-full" style={{marginTop:4}}
                onClick={()=>{ setRecords(r=>[...r,{name:"New Person",cardType:"STAFF",phone:"",waStatus:WA.idle,smsStatus:SMS.pending}]); setActiveIdx(records.length); }}>
                + Add Record
              </button>
            </aside>
          )}

        </div>
      </div>
    </>
  );
}
