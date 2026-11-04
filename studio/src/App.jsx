import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "./lib/supabase";
import { normalisePhone, isValidPhone } from "./lib/phone";
import { selectRecipients, dropDuplicates, describeSkipped } from "./lib/recipients";
import { fillTemplate, normaliseSheetRows, recipientKey, applyMessageStatuses, sanitiseMessages } from "./lib/messages";
import LoginPage from "./LoginPage";
import { N, alpha, getThemePref, applyTheme, nextThemePref } from "./lib/theme";
import { buildLogRow, filterHistory, summariseHistory, historyExportRows, mergeHistory, HISTORY_CHANNELS, HISTORY_ACTIONS, HISTORY_STATUSES } from "./lib/history";

/* ══════════════════════════════════════════════════════════════════════════
   NIKADI STUDIO — event card designer & distribution tool

   Single-file app: design a personalised event card (background + draggable
   name/QR/date/logo elements), import contacts from Excel/CSV, then export,
   WhatsApp, or SMS a rendered card to each contact. Events, contacts, and
   saved templates persist to Supabase (Postgres + Storage); WhatsApp/SMS
   sends go through messaging-service.co.tz, proxied via Vite in dev and a
   Supabase Edge Function in production (see supabase/functions/send-sms).

   Layout of this file, top to bottom:
     BRAND        — theme tokens + global CSS-in-JS string
     Helpers      — pure utility functions (QR URL, phone normalising, VCF…)
     CARD CANVAS  — <CardCanvas> renders the draggable card preview;
                    exportCard() rasterises one canvas to an image
     EVENT MODAL  — <EventModal> create/edit form for an event's details
     MAIN APP     — <App>, the default export. Holds all state and renders
                    the tabbed UI: Events, Design, Contacts, WhatsApp, SMS,
                    VCard. Gated behind <LoginPage> until Supabase auth
                    resolves a session.
══════════════════════════════════════════════════════════════════════════ */

// Spreadsheet and zip libraries are only needed when importing/exporting, so they are
// loaded on demand to keep them out of the initial bundle (both are bundled by Vite
// from node_modules — nothing is fetched from a third-party CDN at runtime)
const loadXlsx  = () => import("xlsx");
const loadJsZip = () => import("jszip").then(m => m.default);

/* ══════════════════════════════════════════════════════════════════════════
   BRAND
══════════════════════════════════════════════════════════════════════════ */
const FONTS = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&family=Poppins:wght@400;500;600;700;800&family=Montserrat:wght@400;500;600;700;800&family=Raleway:wght@400;500;600;700;800&family=Open+Sans:wght@400;500;600;700;800&family=Roboto:wght@400;500;700&family=Playfair+Display:wght@400;500;600;700&family=Oswald:wght@400;500;600;700&family=Lato:wght@400;700&family=Dancing+Script:wght@400;500;600;700&display=swap";

const FONT_OPTIONS = [
  { label:"Plus Jakarta Sans", value:"Plus Jakarta Sans" },
  { label:"Poppins",           value:"Poppins" },
  { label:"Montserrat",        value:"Montserrat" },
  { label:"Raleway",           value:"Raleway" },
  { label:"Open Sans",         value:"Open Sans" },
  { label:"Roboto",            value:"Roboto" },
  { label:"Playfair Display",  value:"Playfair Display" },
  { label:"Oswald",            value:"Oswald" },
  { label:"Lato",              value:"Lato" },
  { label:"Dancing Script",    value:"Dancing Script" },
];

// Colour tokens are CSS variables with light + dark values — see src/lib/theme.js and src/index.css


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
    box-shadow: 0 4px 24px var(--nk-shadow);
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
    background: linear-gradient(135deg, ${N.text} 30%, ${N.sky});
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
  .nk-el-pill:hover  { border-color: ${alpha(N.accent,"44")}; background: ${N.navy700}; }
  .nk-el-pill.active { border-color: ${N.sky}; background: ${N.navy600}; box-shadow: 0 0 0 3px rgba(56,189,248,0.1); }
  .nk-el-pill.disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
  .nk-el-type { font-size: 10px; color: ${N.textDim}; font-family: 'JetBrains Mono', monospace; }
  .nk-michango-badge {
    display: flex; align-items: center; gap: 6px; padding: 7px 10px;
    background: ${N.purpleBg}; border: 1px solid ${alpha(N.purple,"44")};
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
    border: 1px solid ${alpha(N.accent,"44")}; border-radius: 10px;
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
  .nk-rec-pill.active { background: ${alpha(N.accent,"22")}; border-color: ${N.accent}; color: ${N.sky}; }

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

  /* Floating activity logs: fixed to the viewport so showing/hiding them never moves the page */
  .nk-activity {
    position: fixed; left: 24px; bottom: 24px; z-index: 400;
    width: 340px; max-width: calc(100vw - 48px); max-height: 45vh; overflow-y: auto;
    display: flex; flex-direction: column; gap: 10px; animation: slideUp 0.3s ease;
  }
  .nk-activity .nk-log { margin-bottom: 0; box-shadow: 0 8px 30px var(--nk-shadow); }
  .nk-activity-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .nk-activity-close {
    background: transparent; border: none; color: ${N.textDim}; cursor: pointer;
    font-size: 14px; line-height: 1; padding: 2px 6px; border-radius: 6px;
  }
  .nk-activity-close:hover { color: ${N.text}; background: ${N.navy700}; }

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
  .nk-table tbody tr:hover { background: ${alpha(N.navy700,"44")}; }
  .nk-table tbody tr.row-active { background: rgba(59,130,246,0.06); }
  .nk-table td { padding: 10px 14px; font-size: 13px; border-bottom: 1px solid ${alpha(N.border,"22")}; vertical-align: middle; }
  .nk-table tbody tr:last-child td { border-bottom: none; }

  /* Badges */
  .nk-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; font-family: 'JetBrains Mono', monospace; }
  .badge-idle    { background: ${N.navy700}; color: ${N.textDim}; border: 1px solid ${N.border}; }
  .badge-testing { background: ${N.amberBg}; color: ${N.amber}; border: 1px solid ${alpha(N.amber,"44")}; }
  .badge-yes     { background: ${N.greenBg}; color: ${N.green}; border: 1px solid ${alpha(N.green,"44")}; }
  .badge-no      { background: ${N.redBg};   color: ${N.red};   border: 1px solid ${alpha(N.red,"44")}; }
  .badge-sent    { background: ${N.tealBg};  color: ${N.teal};  border: 1px solid ${alpha(N.teal,"44")}; }
  .badge-purple  { background: ${N.purpleBg}; color: ${N.purple}; border: 1px solid ${alpha(N.purple,"44")}; }

  /* Toast */
  .nk-toast {
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    padding: 12px 20px; border-radius: 12px; font-size: 13px; font-weight: 500;
    box-shadow: 0 8px 30px var(--nk-shadow); max-width: 340px; line-height: 1.5;
    animation: slideUp 0.3s ease; display: flex; align-items: flex-start; gap: 10px;
  }
  .nk-toast-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
  .toast-success { background: ${N.greenBg}; color: ${N.green}; border: 1px solid ${alpha(N.green,"44")}; }
  .toast-warn    { background: ${N.amberBg}; color: ${N.amber}; border: 1px solid ${alpha(N.amber,"44")}; }
  .toast-info    { background: ${N.navy600}; color: ${N.sky}; border: 1px solid ${alpha(N.sky,"44")}; }
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
    box-shadow: 0 24px 80px var(--nk-shadow);
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
    background: ${N.greenBg}; border: 1px solid ${alpha(N.green,"44")};
    border-radius: 20px; padding: 3px 12px; font-size: 11px;
    color: ${N.green}; font-family: 'JetBrains Mono', monospace;
  }

  /* ── Delete confirm overlay ── */
  .nk-confirm {
    background: ${N.navy800}; border: 1px solid ${alpha(N.red,"44")};
    border-radius: 14px; padding: 24px; max-width: 400px; width: 100%;
    box-shadow: 0 24px 80px var(--nk-shadow); animation: modalIn 0.2s ease;
  }
  .nk-confirm-title { font-size: 16px; font-weight: 700; color: ${N.text}; margin-bottom: 8px; }
  .nk-confirm-body  { font-size: 13px; color: ${N.textMid}; margin-bottom: 20px; line-height: 1.6; }

  /* ── Choice dialog (bulk-send / re-send confirmations) ── */
  .nk-dialog {
    background: ${N.navy800}; border: 1px solid ${N.border};
    border-radius: 14px; padding: 24px; max-width: 560px; width: 100%;
    max-height: 90vh; overflow-y: auto;
    box-shadow: 0 24px 80px var(--nk-shadow); animation: modalIn 0.2s ease;
  }
  .nk-dialog-title   { font-size: 16px; font-weight: 700; color: ${N.text}; margin-bottom: 10px; }
  .nk-dialog-body    { font-size: 13px; color: ${N.textMid}; margin-bottom: 20px; line-height: 1.6; }
  .nk-dialog-list    {
    background: ${N.navy900}; border: 1px solid ${N.border}; border-radius: 8px;
    padding: 10px 12px; font-size: 12px; line-height: 1.8; max-height: 160px; overflow-y: auto;
  }
  .nk-dialog-list .num { font-family: 'JetBrains Mono', monospace; color: ${N.sky}; }
  .nk-dialog-actions { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
  .nk-btn-warn       { background: ${N.amberBg}; color: ${N.amber}; border: 1.5px solid ${alpha(N.amber,"66")}; }
  .nk-btn-warn:hover { transform: translateY(-1px); filter: brightness(1.25); }

  .nk-page { width: 100%; max-width: 1100px; margin: 0 auto; }
`;

/* ── Helpers ──────────────────────────────────────────────────────────── */
// Builds a goqr.me image URL that encodes `data` as a QR code of `size`×`size` px
const qrUrl = (data, size = 120) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&margin=6&color=0d1f3c&bgcolor=ffffff`;

// Triggers a browser file download for arbitrary text content via a throwaway <a> tag
const downloadBlob = (content, filename, type = "text/plain") => {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
};

/* Fingerprint a template data-URL for localStorage keying */
// Cheap DJB2-style hash of a template image so the same background always maps to the same layout cache key
const templateFingerprint = (dataUrl, filename = "") => {
  const sample = (filename || "") + dataUrl.slice(0, 512) + String(dataUrl.length);
  let h = 5381;
  for (let i = 0; i < sample.length; i++) { h = ((h << 5) + h) ^ sample.charCodeAt(i); h = h >>> 0; }
  return h.toString(36);
};

const LAYOUT_PREFIX = "nikadi_layout_";

// Builds a single VCard (.vcf) string containing one vCard per contact, for phone-book import
const generateVcf = (contacts, eventUsername) =>
  contacts.map(({ name, phone }) => {
    const fn  = `${name} ${eventUsername}_Nikadi`.trim();
    const tel = normalisePhone(phone);
    const e164 = tel.length >= 10 ? `+${tel}` : tel;
    return ["BEGIN:VCARD","VERSION:3.0",`FN:${fn}`,`N:${eventUsername}_Nikadi;${name};;;`,`TEL;TYPE=CELL:${e164}`,"END:VCARD"].join("\r\n");
  }).join("\r\n");

/* ── Constants ───────────────────────────────────────────────────────── */
const DEFAULT_W = 440, DEFAULT_H = 280, MAX_DISPLAY_W = 780;
// Fallback card element layout (name, card type, QR) used for a blank/new template
const defaultElements = () => [
  { id:"name",     label:"Name",      type:"text", field:"name",     x:220, y:170, fontSize:22, color:"#0d1f3c", bold:true,  align:"center", fontFamily:"Plus Jakarta Sans" },
  { id:"cardtype", label:"Card Type", type:"text", field:"cardType", x:220, y:200, fontSize:13, color:"#2563b0", bold:false, align:"center", fontFamily:"Plus Jakarta Sans" },
  { id:"qr",       label:"QR Code",   type:"qr",                     x:300, y:95,  size:120 },
];
const WA  = { idle:"idle", sending:"sending", sent:"sent", notSent:"notSent", invalid:"invalid" };
const SMS = { pending:"pending", sent:"sent", delivered:"delivered", failed:"failed" };
const BLANK_EVENT = { username:"", phone:"", event_type:"", status:"active", venue_name:"", venue_address:"", venue_location:"", start_datetime:"", end_datetime:"" };
// Placeholder contacts for a fresh session / an event with no saved cards, so the
// designer has something to preview. They carry no phone number (so they can never
// be messaged) and are flagged `sample` so saveCards() never writes them to the DB.
const sampleRecords = () => ["Guest One","Guest Two","Guest Three"].map((name, i) => ({
  name, cardType:["SINGLE","DOUBLE","VIP"][i], phone:"",
  waStatus:WA.idle, smsStatus:SMS.pending, cardUrl:null, uploadStatus:"idle", sample:true,
}));

/* ══════════════════════════════════════════════════════════════════════════
   CARD CANVAS
══════════════════════════════════════════════════════════════════════════ */
// Interactive <canvas> preview of one card: draws background + elements, and lets
// the user click-select and drag-reposition an element with the mouse.
function CardCanvas({ bgImage, bgSize, elements, record, selected, onSelect, onMove }) {
  const ref  = useRef(null);
  const drag = useRef(null);
  const cw   = bgSize?.w || DEFAULT_W;
  const ch   = bgSize?.h || DEFAULT_H;
  const displayW = Math.min(cw, MAX_DISPLAY_W);
  const displayH = Math.round(ch * (displayW / cw));
  const scaleX   = cw / displayW;
  const scaleY   = ch / displayH;

  // Full repaint: background (or placeholder gradient) then every element, with a
  // dashed selection outline around whichever element is currently selected
  const draw = useCallback(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cw, ch);
    const renderEls = () => {
      elements.forEach((el) => {
        if (el.type === "text") {
          const val = record?.[el.field] || `[${el.label}]`;
          const ff = el.fontFamily || "Plus Jakarta Sans";
          ctx.font = `${el.bold?"bold ":""}${el.fontSize}px '${ff}', sans-serif`;
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

  // Hit-tests canvas coords against elements (topmost/last-in-array first) for click-selection
  const hitEl  = (cx,cy) => [...elements].reverse().find((el) => {
    if (el.type==="text") { const hitW=200; const dx=el.align==="center"?el.x-hitW/2:el.align==="right"?el.x-hitW:el.x; return cx>=dx-4&&cx<=dx+hitW+4&&cy>=el.y-el.fontSize&&cy<=el.y+8; }
    return cx>=el.x&&cx<=el.x+el.size&&cy>=el.y&&cy<=el.y+el.size;
  });
  // Converts a mouse event's client coords to canvas-space coords (accounts for display scaling)
  const toCv   = (e) => { const r=ref.current.getBoundingClientRect(); return {cx:(e.clientX-r.left)*scaleX,cy:(e.clientY-r.top)*scaleY}; };
  // Mouse-down: select the element under the cursor (or deselect) and start a drag
  const onDown = (e) => { const {cx,cy}=toCv(e); const el=hitEl(cx,cy); if(el){onSelect(el.id);drag.current={id:el.id,ox:cx-el.x,oy:cy-el.y};}else onSelect(null); };
  // Mouse-move: while dragging, report the new element position up to the parent
  const onMov  = (e) => { if(!drag.current)return; const {cx,cy}=toCv(e); onMove(drag.current.id,cx-drag.current.ox,cy-drag.current.oy); };
  // Mouse-up/leave: end the current drag
  const onUp   = () => { drag.current=null; };

  return (
    <canvas ref={ref} width={cw} height={ch}
      style={{ width:displayW, height:displayH, borderRadius:12, cursor:"crosshair",
        boxShadow:"0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(59,130,246,0.2)" }}
      onMouseDown={onDown} onMouseMove={onMov} onMouseUp={onUp} onMouseLeave={onUp} />
  );
}

/* ── Export ──────────────────────────────────────────────────────────── */
// Loads an image, retrying on error and giving up after `timeoutMs` so a stalled
// request can't hang an export (or a whole batch upload) forever
const loadImage = (src, { cors = false, retries = 0, timeoutMs = 15000 } = {}) => new Promise((resolve, reject) => {
  const attempt = (left) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    const retryOrFail = (reason) => left > 0 ? attempt(left - 1) : reject(new Error(reason));
    const timer = setTimeout(() => { img.onload = img.onerror = null; retryOrFail("timed out"); }, timeoutMs);
    img.onload  = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); retryOrFail("failed to load"); };
    img.src = src;
  };
  attempt(retries);
});

// Rasterises one card (background + text/QR elements) to a PNG data-URL, off-screen,
// for download or upload. Every image is loaded before anything is drawn, and the
// promise REJECTS if the template or any QR code can't be loaded — a card must never
// be exported (and then sent to a guest) with its QR code silently missing.
async function exportCard(bgImage, bgSize, elements, record) {
  const cw = bgSize?.w||DEFAULT_W; const ch = bgSize?.h||DEFAULT_H;
  const cv = document.createElement("canvas"); cv.width=cw; cv.height=ch;
  const ctx = cv.getContext("2d");
  const qrEls  = elements.filter(e=>e.type==="qr");
  const qrData = `Name=${record?.name||"?"};TypeCard=${record?.cardType||"?"}`;
  // Web fonts load lazily, and canvas drawing doesn't trigger a load — wait for every font a
  // text element uses, or the card silently falls back to a default font
  await Promise.all(elements.filter(el => el.type==="text").map(el =>
    Promise.resolve(document.fonts?.load(`${el.bold?"bold ":""}${el.fontSize}px '${el.fontFamily||"Plus Jakarta Sans"}'`)).catch(() => {})));
  const [bg, ...qrImgs] = await Promise.all([
    bgImage ? loadImage(bgImage).catch(e => { throw new Error(`Template image ${e.message}`); }) : null,
    ...qrEls.map(el => loadImage(qrUrl(qrData, el.size), { cors:true, retries:2 })
      .catch(e => { throw new Error(`QR code ${e.message} for ${record?.name||"record"}`); })),
  ]);
  if (bg) ctx.drawImage(bg,0,0,cw,ch);
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
  }
  elements.forEach((el) => {
    if (el.type==="text") {
      const val = record?.[el.field]||"";
      const ff = el.fontFamily || "Plus Jakarta Sans";
      ctx.font=`${el.bold?"bold ":""}${el.fontSize}px '${ff}', sans-serif`;
      ctx.fillStyle=el.color; ctx.textAlign=el.align||"left";
      ctx.fillText(val,el.x,el.y); ctx.textAlign="left";
    }
  });
  qrEls.forEach((el, i) => {
    ctx.save(); ctx.shadowColor="rgba(0,0,0,0.2)"; ctx.shadowBlur=6;
    ctx.drawImage(qrImgs[i],el.x,el.y,el.size,el.size); ctx.restore();
  });
  return cv.toDataURL("image/png");
}

/* ── Small components ─────────────────────────────────────────────────── */
// Colored status pill for a record's WhatsApp send status (idle/sending/sent/notSent/invalid)
function WaBadge({ status }) {
  const styles = {
    idle:    { cls:"badge-idle",    icon:"○", label:"Not Sent", extra:{} },
    sending: { cls:"badge-testing", icon:"⏳", label:"Sending…", extra:{} },
    sent:    { cls:"badge-sent",    icon:"✓", label:"Sent",     extra:{} },
    notSent: { cls:"badge-no",      icon:"✗", label:"Not Sent", extra:{background:N.redBg,color:N.red,border:`1px solid ${alpha(N.red,"44")}`} },
    invalid: { cls:"badge-testing", icon:"⚠", label:"Invalid",  extra:{background:N.amberBg,color:N.amber,border:`1px solid ${alpha(N.amber,"44")}`} },
  };
  const { cls, icon, label, extra } = styles[status] || styles.idle;
  return <span className={`nk-badge ${cls}`} style={extra}>{icon} {label}</span>;
}

// Compact icon-style action button used inside table rows (WA/SMS/download/edit actions)
function Sb({ bg, col, border, children, onClick, title, disabled }) {
  return (
    <button className="nk-btn-sm" onClick={onClick} title={title} disabled={disabled}
      style={{ background:bg, color:col, borderColor:border||alpha(col,"44"), opacity:disabled?0.5:1 }}>
      {children}
    </button>
  );
}

// One row of the Contacts table: shows WA/SMS status badges, lets the phone number be
// edited inline, and exposes per-row Upload / Send WA / Send SMS / Download PNG actions
function RecordRow({ rec, idx, onEdit, onUpload, onSendWa, onDownload, onSendSms, isActive, onActivate }) {
  const [editing,setEditing] = useState(false);
  const [phone,setPhone]     = useState("");
  // Enter inline phone-edit mode, seeded with the current value
  const startEdit = () => { setPhone(rec.phone||""); setEditing(true); };
  // Commit the edited phone number back to the parent's records array and exit edit mode
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
      <td><WaBadge status={rec.waStatus||WA.idle} reason={rec.waReason} /></td>
      <td>
        <span className={`nk-badge ${rec.smsStatus===SMS.delivered?"badge-yes":rec.smsStatus===SMS.sent?"badge-sent":rec.smsStatus===SMS.failed?"badge-no":"badge-idle"}`}>
          {rec.smsStatus===SMS.delivered?"✓ Delivered":rec.smsStatus===SMS.sent?"↑ Sent":rec.smsStatus===SMS.failed?"✗ Failed":"○ Pending"}
        </span>
      </td>
      <td>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {!rec.phone && <Sb bg={N.redBg} col={N.red} onClick={startEdit}>+ Add №</Sb>}
          <Sb bg={rec.uploadStatus==="uploaded"?N.greenBg:N.navy600} col={rec.uploadStatus==="uploaded"?N.green:N.sky}
            title={rec.uploadStatus==="uploaded"?"Card uploaded — click to re-upload":"Upload card to Supabase Storage"}
            onClick={()=>onUpload(idx)} disabled={rec.uploadStatus==="uploading"}>
            {rec.uploadStatus==="uploading"?"⏳":rec.uploadStatus==="uploaded"?"✓":"☁"} Upload
          </Sb>
          {rec.phone && <Sb bg={N.greenBg} col={N.green} onClick={()=>onSendWa(idx)} disabled={rec.waStatus===WA.sending}>
            {rec.waStatus===WA.sending?"⏳":"📲"} WA
          </Sb>}
          {rec.phone && <Sb bg={N.tealBg} col={N.teal} border={alpha(N.teal,"44")} onClick={()=>onSendSms(idx)}>💬 SMS</Sb>}
          <Sb bg={N.navy600} col={N.sky} border={alpha(N.sky,"44")} onClick={()=>onDownload(idx)}>⬇ PNG</Sb>
        </div>
      </td>
    </tr>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   EVENT MODAL  (Create / Edit)
══════════════════════════════════════════════════════════════════════════ */
// Create/Edit form modal for an event's details (username, type, venue, dates, status).
// Purely local form state until "Save Event" calls onSave(form) — the parent (App)
// owns the actual Supabase write via persistEvent/onModalSave.
function EventModal({ initial, onSave, onClose, saving }) {
  const [form, setForm] = useState({ ...BLANK_EVENT, ...initial });
  // Returns a field-specific onChange handler that writes one key into the form state
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

/* ── Activity logs ───────────────────────────────────────────────────── */
const NOTICE_VISIBLE_MS = 5000;   // how long toasts and finished activity logs stay on screen
const logPending = (x) => x.status === "uploading" || x.status === "sending";

// Empties an activity log NOTICE_VISIBLE_MS after its last change, but only once nothing in
// it is still in progress — a running upload/send keeps its log on screen. Any later
// change (e.g. a delayed WhatsApp rejection) restarts the countdown.
function useAutoClearLog(log, setLog) {
  useEffect(() => {
    if (!log.length || log.some(logPending)) return;
    const t = setTimeout(() => setLog([]), NOTICE_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [log, setLog]);
}

// status → [icon, colour] for each log's rows; anything not listed is still in progress (⏳)
const LOG_STYLES = {
  upload: { uploaded:["✓",N.green], failed:["✗",N.red] },
  wa:     { sent:["✓",N.green], invalid:["⚠",N.amber], "not sent":["✗",N.red] },
  sms:    { delivered:["✓✓",N.green], sent:["↑",N.teal], failed:["✗",N.red] },
};

// One titled list of activity-log rows inside the floating panel; renders nothing when empty
function LogSection({ title, color, styles, log, onClose }) {
  if (!log.length) return null;
  return (
    <div className="nk-log">
      <div className="nk-activity-head">
        <span className="nk-sec" style={{color,margin:0}}>{title}</span>
        <button className="nk-activity-close" onClick={onClose} title="Dismiss" aria-label={`Dismiss ${title}`}>✕</button>
      </div>
      {log.map((x,i) => {
        const [icon, col] = styles[x.status] || ["⏳", N.textMid];
        return (
          <div key={i} className="nk-log-row" style={{color:col}}>
            <span>{icon}</span>
            <span>{x.name}</span>
            <span style={{fontSize:11,color:N.textDim,textTransform:"capitalize"}}>{x.status}</span>
          </div>
        );
      })}
    </div>
  );
}

const DEFAULT_SMS_MESSAGE = "Habari {name}, kadi yako ya {cardType} ipo tayari. Imepakiwa na Nikadi Studio. Asante!";
const THEME_LABELS = { system:"System", light:"Light", dark:"Dark" };
const THEME_ICONS  = { system:"🖥", light:"☀️", dark:"🌙" };

// Id of an event's main SMS message (events.sms_message, statuses in event_cards.sms_status).
// Extra messages (events.sms_messages) use random ids — see src/lib/messages.js.
const MAIN_MSG = "main";

/* ══════════════════════════════════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════════════════════════════════ */
// Top-level app: owns every piece of state (canvas, records, event, SMS, WhatsApp,
// templates, auth) and renders the tabbed UI. See the file header comment for the
// overall data flow; section comments below mark each state/logic group.
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
  const [records,   setRecords]   = useState(sampleRecords);
  const [activeIdx, setActiveIdx] = useState(0);
  // Always-current copy of `records` for async flows (bulk sends) whose closure would
  // otherwise see the list as it was when they started
  const recordsRef = useRef(records);
  useEffect(() => { recordsRef.current = records; });
  const selectSeq   = useRef(0);          // bumped per selectEvent call so a superseded (slower) load can bail out
  const smsInFlight = useRef(new Set());  // record indexes with an SMS request currently in flight

  /* ── Navigation ── */
  const [tab, setTab] = useState("events");

  /* ── Theme ── */
  // "system" follows the browser's light/dark setting (CSS media query in index.css);
  // "light"/"dark" override it and are remembered in localStorage (nikadi_theme)
  const [themePref, setThemePref] = useState(getThemePref);
  useEffect(() => { applyTheme(themePref); }, [themePref]);

  /* ── WhatsApp ── */
  const [waTemplate,     setWaTemplate]     = useState("Mwaliko");
  const [bulkSending,    setBulkSending]    = useState(false);
  const [bulkLog,        setBulkLog]        = useState([]);
  const [uploadingCards, setUploadingCards] = useState(false);
  const [uploadLog,      setUploadLog]      = useState([]);

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
  const [smsMessage,      setSmsMessage]      = useState(DEFAULT_SMS_MESSAGE);
  const [smsMsgSaving,   setSmsMsgSaving]    = useState(false);
  const smsPersistedMsg = useRef(null);   // last value saved to / loaded from DB — skip redundant writes
  const [csvColumns,      setCsvColumns]      = useState(["name","cardType"]);   // columns offered as {placeholders} in the SMS editor
  const smsTextareaRef    = useRef(null);
  const smsDraftTimerRef  = useRef(null);
  const smsDraftBase      = useRef(null);   // last message loaded from / autosaved to events.sms_draft
  const [smsDraftSaved,   setSmsDraftSaved]   = useState(false);
  const smsSettings = {
    bearerToken: import.meta.env.VITE_SMS_BEARER_TOKEN || "",
    senderId:    import.meta.env.VITE_SMS_SENDER_ID || "NIKADI",
  };
  const [smsSending,      setSmsSending]      = useState(false);
  const [smsLog,          setSmsLog]          = useState([]);
  const [smsBalance,      setSmsBalance]      = useState(null);
  const [smsBalanceLoading, setSmsBalanceLoading] = useState(false);
  // Extra SMS messages for this event (events.sms_messages): each has its own text and
  // recipients — the event contacts or an uploaded list. `activeMsgId` is the one the SMS
  // tab is editing/sending (MAIN_MSG = the event's main message above).
  const [extraMessages,   setExtraMessages]   = useState([]);
  const [activeMsgId,     setActiveMsgId]     = useState(MAIN_MSG);
  const [extraMsgsSaved,  setExtraMsgsSaved]  = useState(false);
  const extraMessagesRef  = useRef(extraMessages);   // always-current copy for async send flows
  useEffect(() => { extraMessagesRef.current = extraMessages; });
  const extraMsgsBase     = useRef("[]");   // JSON last loaded from / saved to events.sms_messages
  const extraMsgsTimer    = useRef(null);
  const extraMsgsWarned   = useRef(false);  // warn about a failed save once, not on every keystroke

  /* ── Event history (event_logs) ── */
  const [historyRows,    setHistoryRows]    = useState([]);   // loaded entries for historyEventRef's event, newest first
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyFilter,  setHistoryFilter]  = useState({ channel:"all", status:"all", q:"" });
  const historyEventRef = useRef(null);   // event whose history is in historyRows
  const historyQueue    = useRef([]);     // rows waiting to be written
  const historyTimer    = useRef(null);
  const historyWarned   = useRef(false);  // warn about a failed write once, not per send

  /* ── VCard ── */
  const [vcardContacts, setVcardContacts] = useState([]);
  const [vcardColumns,  setVcardColumns]  = useState([]);   // every column of the VCard upload, for reuse as an SMS list

  /* ── Toast ── */
  const [toast, setToast] = useState(null);
  // Shows a transient toast (success/warn/info) that auto-dismisses after 5s. A new toast
  // cancels the previous toast's timer, so it always gets its own full 5s instead of being
  // wiped early when an older toast's timer fires.
  const toastTimer = useRef(null);
  const showToast = (msg, type = "info") => {
    setToast({ msg, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), NOTICE_VISIBLE_MS);
  };

  // Activity logs clear themselves 5 s after a run finishes (see useAutoClearLog)
  useAutoClearLog(uploadLog, setUploadLog);
  useAutoClearLog(bulkLog,   setBulkLog);
  useAutoClearLog(smsLog,    setSmsLog);

  /* ── Choice dialog (in-app replacement for the browser's confirm()) ── */
  // askDialog({ title, body, actions }) opens the modal and resolves with the chosen
  // action's `value`, or null if the user cancels (Cancel button, Esc, or a click outside).
  const [dialog, setDialog] = useState(null);
  const dialogResolve = useRef(null);
  const askDialog = (cfg) => new Promise((resolve) => {
    dialogResolve.current?.(null);   // a newer dialog supersedes one that is still open
    dialogResolve.current = resolve;
    setDialog(cfg);
  });
  const closeDialog = (value) => {
    const resolve = dialogResolve.current;
    dialogResolve.current = null;
    setDialog(null);
    resolve?.(value);
  };
  // Esc cancels the open dialog
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e) => { if (e.key === "Escape") closeDialog(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dialog]);

  /* ── Auth ── */
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  // Resolves the current Supabase session on mount and keeps `user` in sync with
  // subsequent sign-in/sign-out events; gates the whole app behind <LoginPage>
  useEffect(() => {
    if (!supabase) { setUser(null); return; }
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Stable identity for effects: Supabase returns a fresh `user` object on every token
  // refresh, which must not re-trigger data loads (that would overwrite unsaved edits)
  const userId = user?.id ?? null;
  const activeRecord = records[activeIdx] || {};
  const selectedEl   = elements.find(e => e.id === selected);
  const cw = bgSize?.w || DEFAULT_W;
  const ch = bgSize?.h || DEFAULT_H;

  /* ── Supabase ping ── */
  // On mount, does a cheap count query to confirm Supabase is reachable and drives
  // the connected/disconnected/unconfigured status dot in the header
  useEffect(() => {
    if (!supabase || !userId) return;   // RLS requires a signed-in session
    supabase.from("events").select("id", { count:"exact", head:true })
      .then(({ error }) => setDbStatus(error ? "disconnected" : "connected"))
      .catch(() => setDbStatus("disconnected"));
  }, [userId]);

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

  /* ── SMS message: manual save to DB for the loaded event ── */
  const saveSmsMessage = async () => {
    if (!supabase || !savedEventId) { showToast("Save the event first","warn"); return; }
    setSmsMsgSaving(true);
    const { error } = await supabase.from("events").update({ sms_message: smsMessage }).eq("id", savedEventId);
    setSmsMsgSaving(false);
    if (error) { showToast("SMS message save failed: " + error.message, "warn"); return; }
    smsPersistedMsg.current = smsMessage;
    setSavedEvents(es => es.map(e => e.id === savedEventId ? { ...e, sms_message: smsMessage } : e));
    showToast("SMS message saved", "success");
  };

  /* ── Load saved events ── */
  // Fetches the 50 most-recent events from Supabase for the Events tab / search dropdown
  const loadSavedEvents = async () => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("events").select("*").order("created_at", { ascending:false }).limit(50);
    if (!error && data) { setSavedEvents(data); return data; }
    return [];
  };
  // On first mount: load templates + events, then reopen whichever event was last
  // active (persisted in localStorage under "nikadi_last_event")
  useEffect(() => {
    if (!supabase || !userId) return;   // RLS requires a signed-in session
    loadSavedTemplates();
    loadSavedEvents().then((events) => {
      const lastId = localStorage.getItem("nikadi_last_event");
      if (lastId) {
        const ev = events.find(e => e.id === lastId);
        if (ev) selectEvent(ev);
      }
    });
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Persist active event ID so template auto-reloads on next visit */
  useEffect(() => {
    if (savedEventId) localStorage.setItem("nikadi_last_event", savedEventId);
    else localStorage.removeItem("nikadi_last_event");
  }, [savedEventId]);

  /* Auto-save the SMS draft to the event (debounced 1.5 s). This is separate from the manual
     "Save Template" button (events.sms_message): the draft is the working copy, and it is only
     written when it differs from what was last loaded/saved. Needs the events.sms_draft column
     (supabase-schema.sql / supabase-grants-migration.sql); a missing column just skips the save. */
  useEffect(() => {
    if (!supabase || !savedEventId || smsMessage === smsDraftBase.current) return;
    clearTimeout(smsDraftTimerRef.current);
    setSmsDraftSaved(false);
    smsDraftTimerRef.current = setTimeout(async () => {
      const { error } = await supabase.from("events").update({ sms_draft: smsMessage }).eq("id", savedEventId);
      if (!error) {
        smsDraftBase.current = smsMessage;
        setSmsDraftSaved(true);
        setTimeout(() => setSmsDraftSaved(false), 2500);
      }
    }, 1500);
    return () => clearTimeout(smsDraftTimerRef.current);
  }, [smsMessage, savedEventId]);

  // Writes the extra SMS messages (text, recipients, statuses) to events.sms_messages.
  // Needs that column (supabase-schema.sql); a failure is reported once, not per keystroke.
  const persistExtraMessages = async (eventId, msgs) => {
    if (!supabase || !eventId) return false;
    const { error } = await supabase.from("events").update({ sms_messages: msgs }).eq("id", eventId);
    if (error) {
      if (!extraMsgsWarned.current) {
        extraMsgsWarned.current = true;
        showToast(`Extra SMS messages not saved: ${error.message} (run supabase-schema.sql)`, "warn");
      }
      return false;
    }
    extraMsgsWarned.current = false;
    extraMsgsBase.current = JSON.stringify(msgs);
    setSavedEvents(es => es.map(e => e.id === eventId ? { ...e, sms_messages: msgs } : e));
    return true;
  };

  /* ── Event history ── */
  // Writes every queued history row in one insert. Entries for the event whose History
  // tab is loaded are added to it straight away. Never throws: history must not break a send.
  const flushHistory = async () => {
    clearTimeout(historyTimer.current);
    const rows = historyQueue.current.splice(0);
    if (!rows.length || !supabase) return;
    const { data, error } = await supabase.from("event_logs").insert(rows).select();
    if (error) {
      if (!historyWarned.current) {
        historyWarned.current = true;
        showToast(`Event history not saved: ${error.message} (run supabase-schema.sql)`, "warn");
      }
      return;
    }
    historyWarned.current = false;
    const mine = (data || []).filter(r => r.event_id === historyEventRef.current);
    if (mine.length) setHistoryRows(hs => mergeHistory(hs, mine));
  };

  // Records one history entry for an event (default: the open one) — see buildLogRow for
  // the fields. Entries are batched (written ~1 s after the last one, or every 50) so a bulk
  // send doesn't make one request per contact. No-op when no event is saved yet.
  const logHistory = (entry, eventId = savedEventId) => {
    if (!supabase || !eventId) return;
    try { historyQueue.current.push(buildLogRow(eventId, entry)); }
    catch (e) { console.warn(e.message); return; }
    clearTimeout(historyTimer.current);
    if (historyQueue.current.length >= 50) flushHistory();
    else historyTimer.current = setTimeout(flushHistory, 1000);
  };

  // Best effort: write what's still queued when the tab is closed or hidden
  useEffect(() => {
    const flush = () => { if (document.visibilityState === "hidden") flushHistory(); };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Loads the open event's history, newest first, HISTORY_PAGE rows at a time
  // (`more` appends the next page). Anything still queued is written first so it shows up.
  const HISTORY_PAGE = 300;
  const loadHistory = async (more = false) => {
    const evId = savedEventId;
    if (!supabase || !evId) { historyEventRef.current = null; setHistoryRows([]); setHistoryHasMore(false); return; }
    if (!more && historyEventRef.current !== evId) setHistoryRows([]);
    historyEventRef.current = evId;
    setHistoryLoading(true);
    await flushHistory();
    const from = more ? historyRows.length : 0;
    const { data, error } = await supabase.from("event_logs").select("*").eq("event_id", evId)
      .order("created_at", { ascending:false }).range(from, from + HISTORY_PAGE - 1);
    if (historyEventRef.current !== evId) return;   // another event was opened meanwhile
    setHistoryLoading(false);
    if (error) { showToast("Could not load history: " + error.message, "warn"); return; }
    setHistoryRows(hs => mergeHistory(more ? hs : hs.filter(r => r.event_id === evId), data || []));
    setHistoryHasMore((data || []).length === HISTORY_PAGE);
  };
  // (Re)load when the History tab is opened or another event is opened while it's showing
  useEffect(() => { if (tab === "history") loadHistory(); }, [tab, savedEventId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Exports the filtered history as .xlsx, named after the event
  const downloadHistory = async () => {
    const rows = filterHistory(historyRows, historyFilter);
    if (!rows.length) { showToast("No history to export", "warn"); return; }
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.json_to_sheet(historyExportRows(rows));
    ws["!cols"] = [{ wch:20 }, { wch:10 }, { wch:16 }, { wch:10 }, { wch:24 }, { wch:16 }, { wch:18 }, { wch:26 }, { wch:50 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "History");
    const evName = (eventData.username || "Event").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
    XLSX.writeFile(wb, `${evName}_History_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  /* Auto-save the extra SMS messages (debounced 1.5 s), only when they changed since the last load/save */
  useEffect(() => {
    if (!supabase || !savedEventId || JSON.stringify(extraMessages) === extraMsgsBase.current) return;
    clearTimeout(extraMsgsTimer.current);
    setExtraMsgsSaved(false);
    extraMsgsTimer.current = setTimeout(async () => {
      if (await persistExtraMessages(savedEventId, extraMessages)) {
        setExtraMsgsSaved(true);
        setTimeout(() => setExtraMsgsSaved(false), 2500);
      }
    }, 1500);
    return () => clearTimeout(extraMsgsTimer.current);
  }, [extraMessages, savedEventId]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Uploads a background image (data-URL) to the `templates` Storage bucket and
  // returns its public URL, or null on failure (caller falls back gracefully)
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
  // Fetches the 50 most-recent saved templates for the template picker list
  const loadSavedTemplates = async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from("saved_templates").select("*").order("created_at", { ascending:false }).limit(50);
    if (!error && data) setSavedTemplates(data);
  };

  // Saves the current background image + element layout as a new named, reusable template
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

  // Loads a saved template's background image + element layout onto the canvas.
  // If the template has no image, only its layout is applied (over the current bg).
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

  // Deletes a saved template row from Supabase and refreshes the template list
  const deleteSavedTemplate = async (tpl) => {
    if (!supabase) return;
    const { error } = await supabase.from("saved_templates").delete().eq("id", tpl.id);
    if (error) { showToast("Delete failed: " + error.message, "warn"); return; }
    showToast(`Template "${tpl.name}" deleted`, "success");
    loadSavedTemplates();
  };

  /* ── Background upload ── */
  // File-input handler for manually picking a background image: loads it onto the
  // canvas (which triggers the layout-restore effect via templateKey), and — if no
  // template is attached to the current event yet — also uploads it to Storage
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

  // Clears the canvas entirely: no background image, default element layout
  const resetTemplate = () => {
    setBgImage(null); setBgSize(null); setCoverUrl(null); setTemplateKey(null);
    setElements(defaultElements()); setLayoutRestored(false);
  };

  // Discards the locally-cached layout for this template (localStorage) and
  // restores the default element positions
  const resetLayout = () => {
    if (!templateKey) return;
    localStorage.removeItem(LAYOUT_PREFIX + templateKey);
    setElements(defaultElements());
    setLayoutRestored(false);
    showToast("Layout reset to defaults", "info");
  };

  /* ── Excel / CSV upload ── */
  // Parses an uploaded Excel/CSV file (via SheetJS) into `records`, normalising
  // common column-name variants (name / cardType|card / phone|phoneNumber|mobile);
  // any other columns pass through untouched
  const onExcelUpload = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = async ev => {
      const XLSX = await loadXlsx();
      const wb   = XLSX.read(ev.target.result, { type:"array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { defval:"" });
      const { rows, columns } = normaliseSheetRows(data);
      const norm = rows.map(r => ({ waStatus:WA.idle, smsStatus:SMS.pending, cardUrl:null, uploadStatus:"idle", ...r }));
      // Ordered column list for the SMS variable chips: standard columns first, then any extras
      setCsvColumns(columns);
      setRecords(norm); setActiveIdx(0);
      showToast(`Loaded ${norm.length} records`, "success");
    };
    r.readAsArrayBuffer(f);
  };

  /* ── VCard CSV upload ── */
  // Parses an uploaded CSV into `vcardContacts` feeding the VCard tab's export —
  // independent of the main `records` table. The .vcf only uses name + phone, but every
  // column is kept so the same list can be reused as an SMS message's recipients.
  const onVcardCsvUpload = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = async ev => {
      const XLSX = await loadXlsx();
      const wb   = XLSX.read(ev.target.result, { type:"array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { defval:"" });
      const { rows, columns } = normaliseSheetRows(data);
      const contacts = rows.map(c => ({ name:"", phone:"", ...c })).filter(c => c.name || c.phone);
      setVcardContacts(contacts);
      setVcardColumns(columns.includes("name") ? columns : ["name", ...columns]);
      showToast(`${contacts.length} contacts loaded for VCard`, "success");
    };
    r.readAsArrayBuffer(f);
  };

  // Downloads all vcardContacts as a single .vcf file named after the current event
  const downloadVCard = () => {
    if (!vcardContacts.length) { showToast("Upload a CSV first","warn"); return; }
    const eu = eventData.username || "Nikadi";
    downloadBlob(generateVcf(vcardContacts, eu), `nikadi_contacts_${eu}.vcf`, "text/vcard");
    showToast(`Downloaded ${vcardContacts.length} contacts as VCard`, "success");
  };

  /* ── Save / upsert event ── */
  // Inserts a new event row or updates an existing one (branches on `currentId`).
  // Also stamps the designer's cover image, element layout, and — only when saving
  // the currently-loaded event, not a brand-new one — the SMS message.
  const persistEvent = async (formData, currentId = savedEventId) => {
    if (!supabase) { showToast("Supabase not configured","warn"); return null; }
    setIsSaving(true);
    try {
      // Only stamp the designer's SMS message onto the loaded event or a brand-new one
      const isLoadedEvent = !currentId || currentId === savedEventId;
      const payload = {
        ...formData,
        cover_image_url: coverUrl||null,
        elements_layout: elements,
        ...(isLoadedEvent ? { sms_message: smsMessage } : {}),
        start_datetime: formData.start_datetime||null,
        end_datetime:   formData.end_datetime||null,
      };
      if (currentId) {
        const { error } = await supabase.from("events").update(payload).eq("id", currentId);
        if (error) throw error;
        if (isLoadedEvent) { smsPersistedMsg.current = smsMessage; smsDraftBase.current = smsMessage; }
        logHistory({ channel:"event", action:"update", detail:`Event details saved: ${formData.username || ""}` }, currentId);
        setEventData(formData);
        showToast("Event updated", "success");
        await loadSavedEvents();
        return currentId;
      } else {
        const { data, error } = await supabase.from("events").insert([payload]).select().single();
        if (error) throw error;
        smsPersistedMsg.current = smsMessage;
        smsDraftBase.current = smsMessage;
        // Extra SMS messages carry over to the new event like the main text, but not their send history
        const carried = extraMessagesRef.current.map(m => ({
          ...m, statuses: {}, recipients: m.recipients.map(r => ({ ...r, smsStatus: SMS.pending })),
        }));
        resetExtraMessages(carried);
        if (carried.length) persistExtraMessages(data.id, carried);
        logHistory({ channel:"event", action:"create", detail:`Event created: ${formData.username || ""}` }, data.id);
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

  // Replaces this event's `event_cards` rows with `recs` (default: the current records).
  // Insert-then-delete rather than delete-then-insert: the new rows go in first and
  // only the rows that existed beforehand are removed, so a failed insert can never
  // leave the event with no contacts. Placeholder `sample` records are never saved.
  // Bulk-send flows pass their own `recs` — this function's closure `records` would
  // still hold the pre-send statuses.
  const saveCards = async (eventId, recs = records) => {
    if (!supabase) return;
    const entries = recs.map((r, i) => ({ r, i })).filter(({ r }) => !r.sample);   // keep each row's position in `recs`
    const toSave  = entries.map(({ r }) => r);
    if (!toSave.length) { showToast("No contacts to save", "info"); return; }
    const { data: old, error: readErr } = await supabase.from("event_cards").select("id").eq("event_id", eventId);
    if (readErr) { showToast("Cards save error: " + readErr.message, "warn"); return; }
    const rows = toSave.map(r => ({
      event_id:   eventId,
      name:       r.name||"",
      card_type:  r.cardType||"",
      phone:      r.phone||"",
      wa_status:  r.waStatus||WA.idle,
      sms_status: r.smsStatus||SMS.pending,
    }));
    const { data: inserted, error } = await supabase.from("event_cards").insert(rows).select("id");
    if (error) { showToast("Cards save error: " + error.message, "warn"); return; }
    // Remember each row's new database id so per-card status updates (autoSaveCard) can target it
    if (inserted?.length === entries.length) {
      const ids = new Map(entries.map(({ i }, n) => [i, inserted[n].id]));
      setRecords(rs => rs.map((r, i) => ids.has(i) ? { ...r, dbId: ids.get(i) } : r));
    }
    if (old?.length) {
      const { error: delErr } = await supabase.from("event_cards").delete().in("id", old.map(o => o.id));
      if (delErr) { showToast("Cards saved, but old rows could not be removed: " + delErr.message, "warn"); return; }
    }
    // Status-only saves (after every send) keep the same count — only log real list changes
    if ((old?.length || 0) !== toSave.length) {
      logHistory({ channel:"event", action:"contacts", detail:`Contact list saved: ${toSave.length} contacts (was ${old?.length || 0})` }, eventId);
    }
    showToast(`${toSave.length} cards saved`, "success");
  };

  // Manually persists the current element layout to the loaded event's DB row
  // (and refreshes the localStorage layout cache to match)
  const saveLayout = async () => {
    if (!supabase || !savedEventId) { showToast("Save the event first","warn"); return; }
    const { error } = await supabase.from("events").update({ elements_layout: elements }).eq("id", savedEventId);
    if (error) showToast("Layout save failed: " + error.message, "warn");
    else {
      if (templateKey) localStorage.setItem(LAYOUT_PREFIX + templateKey, JSON.stringify(elements));
      showToast("Layout saved to database", "success");
    }
  };

  // EventModal's onSave callback: persists the form via persistEvent, then closes
  // the modal only if the save actually succeeded
  const onModalSave = async (formData) => {
    const id = await persistEvent(formData, formData.id || null);
    if (id) setModalEvent(null);
  };

  // Replaces the extra SMS messages with an event's saved ones (default: none) without
  // triggering an autosave, and goes back to editing the main message
  const resetExtraMessages = (msgs = []) => {
    clearTimeout(extraMsgsTimer.current);
    // Flush edits still waiting for the debounced autosave so switching events can't lose them
    const pending = extraMessagesRef.current;
    if (savedEventId && JSON.stringify(pending) !== extraMsgsBase.current) persistExtraMessages(savedEventId, pending);
    extraMsgsBase.current    = JSON.stringify(msgs);
    extraMessagesRef.current = msgs;
    setExtraMessages(msgs);
    setActiveMsgId(MAIN_MSG);
  };

  /* ── Delete event ── */
  // Deletes an event row from Supabase (cascades to its cards at the DB level);
  // if it was the currently-loaded event, also clears designer state back to blank
  const deleteEvent = async (ev) => {
    if (!supabase) return;
    const { error } = await supabase.from("events").delete().eq("id", ev.id);
    if (error) { showToast("Delete failed: " + error.message, "warn"); return; }
    setSavedEvents(es => es.filter(e => e.id !== ev.id));
    if (savedEventId === ev.id) {
      setSavedEventId(null); setEventData(BLANK_EVENT);
      smsPersistedMsg.current = null;
      setSmsMessage(DEFAULT_SMS_MESSAGE);
      resetExtraMessages();
    }
    setDeleteTarget(null);
    showToast(`Event "${ev.username}" deleted`, "success");
  };

  /* ── Core: load event data + template from DB into the designer ── */
  // The main "open an event" routine: populates the event form, SMS message,
  // background image + element layout (fetched from Storage, only if the cover URL
  // actually changed), and this event's saved contact cards. Called from the
  // sidebar dropdown, the Events tab, and on-mount restore-last-event.
  const selectEvent = async (eventIdOrObj, targetTab = "design") => {
    const ev = typeof eventIdOrObj === "string"
      ? savedEvents.find(e => e.id === eventIdOrObj)
      : eventIdOrObj;
    if (!ev) return;

    // Opening an event is several async steps; if the user opens another one before
    // this finishes, the older call must stop instead of overwriting the newer event
    const seq    = ++selectSeq.current;
    const stale  = () => seq !== selectSeq.current;
    setLoadingTemplate(false);

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
    smsPersistedMsg.current = ev.sms_message || DEFAULT_SMS_MESSAGE;   // the saved template
    smsDraftBase.current    = ev.sms_draft || smsPersistedMsg.current;  // an autosaved draft wins when present
    setSmsMessage(smsDraftBase.current);
    resetExtraMessages(sanitiseMessages(ev.sms_messages));

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
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob   = await res.blob();
        if (stale()) return;
        await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error);
          reader.onload = (e) => {
            const dataUrl = e.target.result;
            const fp      = templateFingerprint(dataUrl, ev.cover_image_url);
            const img     = new Image();
            img.onerror = () => reject(new Error("template image is not a valid image"));
            img.onload = () => {
              if (stale()) { resolve(); return; }
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
      } catch (err) { if (!stale()) showToast(`Could not load template from database: ${err.message}`,"warn"); }
      finally { if (!stale()) setLoadingTemplate(false); }
    }
    if (stale()) return;

    /* Load cards — never carry the previously open event's contacts over: when this
       event has none (or they can't be loaded) fall back to the placeholder samples */
    if (supabase) {
      const { data: cards, error: cardsErr } = await supabase.from("event_cards").select("*").eq("event_id", ev.id);
      if (stale()) return;
      if (cardsErr) showToast("Could not load contacts: " + cardsErr.message, "warn");
      setRecords(cards?.length ? cards.map(c => ({
        dbId:      c.id,
        name:      c.name||"",
        cardType:  c.card_type||"",
        phone:     c.phone||"",
        waStatus:     c.wa_status||WA.idle,
        smsStatus:    c.sms_status||SMS.pending,
        cardUrl:      null,
        uploadStatus: "idle",
      })) : sampleRecords());
      setActiveIdx(0);
    }

    showToast(`"${ev.username}" loaded`, "success");
    if (targetTab) setTab(targetTab);
  };

  /* ── Sidebar dropdown handler ── */
  // Loads the chosen event via selectEvent, or resets to a blank event when "— none —" is picked
  const onEventSelect = (id) => {
    if (!id) { selectSeq.current++; setEventData(BLANK_EVENT); setSavedEventId(null); setCoverUrl(null); resetExtraMessages(); return; }
    selectEvent(id);
  };

  /* ── Events tab: Create Cards button ── */
  // Shortcut: load the event and jump straight to the Design tab (selectEvent opens it)
  const createCardsFromEvent = async (ev) => {
    await selectEvent(ev);
  };

  /* ── Canvas helpers ── */
  // Drag handler: updates one element's x/y as CardCanvas reports drag movement
  const onMove     = (id,x,y) => setElements(els => els.map(el => el.id===id ? {...el,x,y} : el));
  // Updates a single property (fontSize/color/align/etc.) on the currently selected element
  const updateEl   = (prop,val) => setElements(els => els.map(el => el.id===selected ? {...el,[prop]:val} : el));
  // Updates a single field on one contact record (used by RecordRow's inline phone edit).
  // Editing a placeholder sample row turns it into a real contact, so it gets saved.
  const editRecord = (idx,field,val) => setRecords(rs => rs.map((r,i) => i===idx ? {...r,[field]:val,...(r.sample?{sample:false}:{})} : r));

  /* ── WhatsApp API ── */
  const WA_BASE = import.meta.env.DEV
    ? "/wa-proxy"
    : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-wa`;
  const WA_BEARER = import.meta.env.VITE_WA_BEARER_TOKEN || "";

  // Bearer token for the SMS/WhatsApp proxy. Dev: the provider token from
  // .env.development.local (the Vite proxy forwards it as-is). Production: the
  // signed-in user's Supabase access token — the Edge Functions verify it and attach
  // the provider token server-side, so no provider secret ever reaches the browser.
  // Throws a readable error instead of letting the provider answer a bare "HTTP 401".
  const getApiToken = async (kind) => {
    if (import.meta.env.DEV) {
      const token = kind === "wa" ? (WA_BEARER || smsSettings.bearerToken) : smsSettings.bearerToken;
      if (!token) throw new Error(`no ${kind === "wa" ? "VITE_WA_BEARER_TOKEN / " : ""}VITE_SMS_BEARER_TOKEN — add it to .env.development.local and restart npm run dev`);
      return token;
    }
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) throw new Error("not signed in — sign in again");
    return data.session.access_token;
  };

  // Asks (in-app modal) before re-sending to someone who already received a message
  const confirmResend = async (name, what) => (await askDialog({
    title: "Send again?",
    body: `${name} already received ${what}. Sending again messages them a second time.`,
    actions: [{ value: "yes", label: "Send again", kind: "warn" }],
  })) === "yes";

  // Works out who a bulk send goes to and asks the user in the modal. When some contacts
  // share a phone number the user chooses between "Send without duplicates" (the first
  // record per number) and "Send duplicates too" (every record). Resolves to the chosen
  // recipients, or null when there is nothing to send or the user cancels.
  // `recs` defaults to the event contacts; an SMS message with an uploaded list passes its own.
  const pickBulkRecipients = async ({ title, emptyMsg, options, recs = records }) => {
    const { targets: all, skipped, duplicateGroups } = selectRecipients(recs, { ...options, allowDuplicates: true });
    const note = describeSkipped(skipped);
    if (!all.length) { showToast(`${emptyMsg} ${note}`.trim(), "warn"); return null; }
    const unique = dropDuplicates(all);
    const extra  = all.length - unique.length;   // records that repeat another record's number
    const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    const choice = await askDialog({
      title,
      body: (
        <>
          <div>
            <strong style={{color:N.text}}>{plural(unique.length, "contact")}</strong> ready to send{extra ? " (without duplicates)" : ""}.
          </div>
          {extra > 0 && (
            <div style={{marginTop:14}}>
              <div style={{color:N.amber,fontWeight:700,marginBottom:6}}>
                ⚠ {plural(extra, "extra record")} {extra === 1 ? "shares" : "share"} a number with another contact
              </div>
              <div className="nk-dialog-list">
                {duplicateGroups.slice(0, 6).map(g => (
                  <div key={g.phone}><span className="num">+{g.phone}</span> — {g.names.join(", ")}</div>
                ))}
                {duplicateGroups.length > 6 && <div style={{color:N.textDim}}>…and {duplicateGroups.length - 6} more</div>}
              </div>
              <div style={{marginTop:8,fontSize:12,color:N.textDim}}>
                <strong>Without duplicates</strong> messages each number once (the first contact listed).{" "}
                <strong>Duplicates too</strong> messages every record, so these numbers get more than one message and use extra credit.
              </div>
            </div>
          )}
          {note && <div style={{marginTop:12,fontSize:12,color:N.textDim}}>{note}</div>}
        </>
      ),
      actions: extra > 0
        ? [{ value:"unique", label:`Send without duplicates (${unique.length})`, kind:"success" },
           { value:"all",    label:`Send duplicates too (${all.length})`,        kind:"warn" }]
        : [{ value:"all", label:`Send to ${plural(all.length, "contact")}`, kind:"success" }],
    });
    return choice === "unique" ? unique : choice === "all" ? all : null;
  };

  // Fills the {name}/{cardType} placeholders in an SMS template (default: the main message) for one record
  // Also supports {phone} and any extra spreadsheet column as {ColumnName}; unknown {x} is left as typed
  const buildSmsMsg = (rec, body = smsMessage) => fillTemplate(body, rec);

  /* ── SMS messages: main + extras ── */
  // The extra message being edited in the SMS tab (null while the main message is selected)
  const activeExtra = extraMessages.find(m => m.id === activeMsgId) || null;
  // Looks up a message by id (null for the main message) from the always-current list
  const findMessage = (msgId) => msgId === MAIN_MSG ? null : extraMessagesRef.current.find(m => m.id === msgId) || null;
  // Who a message goes to, each carrying its smsStatus *for that message*: the main message
  // uses the event contacts as-is, an extra one its uploaded list or the contacts plus its own statuses
  const messageRecipients = (msg, recs = records) => !msg ? recs
    : msg.source === "upload" ? msg.recipients
    : recs.map(r => ({ ...r, smsStatus: msg.statuses[recipientKey(r)] || SMS.pending }));
  const activeRecipients = messageRecipients(activeExtra);
  const activeBody       = activeExtra ? activeExtra.body : smsMessage;
  const activeColumns    = activeExtra?.source === "upload" ? activeExtra.columns : csvColumns;
  // Patches one extra message (object, or function of the message returning a patch)
  const updateExtraMessage = (id, patch) =>
    setExtraMessages(ms => ms.map(m => m.id === id ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m));
  // Sets the text of whichever message is selected (accepts a value or an updater, like a setState)
  const setActiveBody = (val) => {
    if (!activeExtra) { setSmsMessage(val); return; }
    updateExtraMessage(activeExtra.id, m => ({ body: typeof val === "function" ? val(m.body) : val }));
  };

  // Adds a new extra message (event contacts as recipients, empty text) and selects it
  const addExtraMessage = () => {
    const msg = {
      id: crypto.randomUUID(), title: `Message ${extraMessages.length + 2}`, body: "",
      source: "contacts", fileName: null, columns: [], recipients: [], statuses: {},
    };
    setExtraMessages(ms => [...ms, msg]);
    setActiveMsgId(msg.id);
  };

  // Deletes the selected extra message after confirming (its send history goes with it)
  const deleteExtraMessage = async (msg) => {
    const sent = messageRecipients(msg).filter(r => r.smsStatus && r.smsStatus !== SMS.pending).length;
    const ok = await askDialog({
      title: `Delete "${msg.title}"?`,
      body: `This removes the message text and its recipient list${sent ? `, including the send status of ${sent} recipient${sent === 1 ? "" : "s"}` : ""}. Messages already sent are not affected.`,
      actions: [{ value: "yes", label: "Delete message", kind: "warn" }],
    });
    if (ok !== "yes") return;
    setExtraMessages(ms => ms.filter(m => m.id !== msg.id));
    setActiveMsgId(MAIN_MSG);
  };

  // Switches an extra message's recipients to the event contacts or to an uploaded list.
  // Replacing a list that already has sends asks first, because its statuses are reset.
  const setMessageList = async (msg, { source, rows = [], columns = [], fileName = null }) => {
    const sent = messageRecipients(msg).filter(r => r.smsStatus && r.smsStatus !== SMS.pending).length;
    if (sent) {
      const ok = await askDialog({
        title: "Replace recipient list?",
        body: `${sent} recipient${sent === 1 ? " has" : "s have"} already been sent "${msg.title}". Changing the list resets those statuses, so they could be messaged again.`,
        actions: [{ value: "yes", label: "Replace list", kind: "warn" }],
      });
      if (ok !== "yes") return;
    }
    updateExtraMessage(msg.id, source === "upload"
      ? { source, fileName, columns, recipients: rows.map(r => ({ ...r, smsStatus: SMS.pending })), statuses: {} }
      : { source: "contacts", fileName: null, columns: [], recipients: [], statuses: {} });
    if (source === "upload") showToast(`${rows.length} recipients loaded for "${msg.title}"`, "success");
  };

  // Loads an Excel/CSV file as the selected extra message's own recipient list. Any column
  // (Name, Phone, Table, Amount…) becomes a {placeholder} for that message.
  const onMessageListUpload = (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f || !activeExtra) return;
    const msg = activeExtra;
    const r = new FileReader();
    r.onload = async ev => {
      const XLSX = await loadXlsx();
      const wb   = XLSX.read(ev.target.result, { type:"array" });
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval:"" });
      const { rows, columns } = normaliseSheetRows(data);
      const kept = rows.filter(x => x.name || x.phone);
      if (!kept.length) { showToast("No rows with a Name or Phone column found", "warn"); return; }
      await setMessageList(msg, { source: "upload", rows: kept, columns, fileName: f.name });
    };
    r.readAsArrayBuffer(f);
  };

  // Records send results for a message. `recs` is the recipient list the send was made from
  // and `updates` maps an index in it to the new status. The main message updates `records`
  // (the caller saves event_cards); an extra message is saved to events.sms_messages at once.
  const setMessageStatuses = (msgId, recs, updates) => {
    if (msgId === MAIN_MSG) {
      setRecords(rs => rs.map((r, i) => updates.has(i) ? { ...r, smsStatus: updates.get(i) } : r));
      return;
    }
    // The user may have switched event mid-send: the message is then no longer in the list
    if (!extraMessagesRef.current.some(m => m.id === msgId)) return;
    const apply = (ms) => ms.map(m => m.id === msgId ? applyMessageStatuses(m, recs, updates) : m);
    const next  = apply(extraMessagesRef.current);
    extraMessagesRef.current = next;
    setExtraMessages(apply);
    extraMsgsBase.current = JSON.stringify(next);   // saved right here, so the debounced autosave can skip it
    if (savedEventId) persistExtraMessages(savedEventId, next);
  };

  /* Step 1 — Upload personalized card to Supabase Storage, save public URL on record */
  // Re-encodes a card PNG as JPEG, iteratively lowering quality (and downscaling
  // width first) until the result is under `maxKb` — keeps WhatsApp image uploads
  // fast and comfortably under the provider's size limit
  const compressCard = (dataUrl, maxKb = 2800, quality = 0.88) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Could not read the rendered card"));
    img.onload = () => {
      // Scale down if needed so the JPEG stays well under 3 MB
      let w = img.width, h = img.height;
      const MAX_W = 1200;
      if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      // Try progressively lower quality until under maxKb
      let q = quality;
      const tryEncode = () => {
        const result = canvas.toDataURL("image/jpeg", q);
        const kb = Math.round((result.length * 3) / 4 / 1024);
        if (kb > maxKb && q > 0.4) { q = Math.max(q - 0.08, 0.4); tryEncode(); }
        else resolve(result);
      };
      tryEncode();
    };
    img.src = dataUrl;
  });

  // Renders one record's card, compresses it to JPEG, and uploads it to the
  // `wa-cards` Storage bucket; stores the resulting public URL on the record so
  // sendWaSingle can attach it as the WhatsApp message's image header
  const uploadCardSingle = async (idx) => {
    const rec = records[idx];
    if (!supabase) throw new Error("Supabase not configured");
    setRecords(rs => rs.map((r,i) => i===idx ? {...r, uploadStatus:"uploading"} : r));
    try {
      const rawDataUrl = await exportCard(bgImage, bgSize, designElements, rec);
      const dataUrl = await compressCard(rawDataUrl);
      const blob = await fetch(dataUrl).then(r => r.blob());
      const storageKey = `wa/${Date.now()}_${(rec.name||"card").replace(/\W/g,"_")}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("wa-cards")
        .upload(storageKey, blob, { contentType:"image/jpeg", upsert:true });
      if (upErr) throw new Error(upErr.message);
      const { data: { publicUrl } } = supabase.storage.from("wa-cards").getPublicUrl(storageKey);
      setRecords(rs => rs.map((r,i) => i===idx ? {...r, cardUrl:publicUrl, uploadStatus:"uploaded"} : r));
      logHistory({ channel:"card", action:"upload", name:rec.name, phone:rec.phone });
      return publicUrl;
    } catch (err) {
      // Any failure (render, QR/template load, compression, Storage) — never leave the row on "uploading"
      setRecords(rs => rs.map((r,i) => i===idx ? {...r, uploadStatus:"failed"} : r));
      logHistory({ channel:"card", action:"upload", status:"failed", name:rec.name, phone:rec.phone, detail:err.message });
      throw err;
    }
  };

  // Batch & Send row action: runs uploadCardSingle and reports the outcome as a
  // toast (that tab has no upload log)
  const uploadCardWithToast = async (idx) => {
    const name = records[idx]?.name || `#${idx+1}`;
    try {
      await uploadCardSingle(idx);
      showToast(`Card uploaded for ${name}`, "success");
    } catch (e) {
      showToast(`Upload failed for ${name}: ${e.message}`, "warn");
    }
  };

  // Runs uploadCardSingle for every record, one at a time, tracking per-row
  // progress in uploadLog for the "Upload Cards" progress list
  const uploadAllCards = async () => {
    if (!supabase) { showToast("Supabase not configured", "warn"); return; }
    setUploadingCards(true);
    setUploadLog(records.map(r => ({ name:r.name, status:"uploading" })));
    let ok = 0, fail = 0;
    for (let i = 0; i < records.length; i++) {
      try {
        await uploadCardSingle(i);
        setUploadLog(l => l.map((x,j) => j===i ? {...x, status:"uploaded"} : x));
        ok++;
      } catch {
        setUploadLog(l => l.map((x,j) => j===i ? {...x, status:"failed"} : x));
        fail++;
      }
    }
    setUploadingCards(false);
    showToast(`Upload done — ${ok} uploaded${fail ? `, ${fail} failed` : ""}`, ok ? "success" : "warn");
  };

  /* Silently persist a single card's status to the DB right after it changes */
  const autoSaveCard = (dbId, waStatus, smsStatus) => {
    if (!supabase || !savedEventId || !dbId) return;
    const updates = {};
    if (waStatus  !== undefined) updates.wa_status  = waStatus;
    if (smsStatus !== undefined) updates.sms_status = smsStatus;
    if (!Object.keys(updates).length) return;
    supabase.from("event_cards").update(updates).eq("id", dbId)
      .then(({ error }) => { if (error) console.warn("Auto-save card:", error.message); });
  };

  /* Poll delivery report until we get a terminal status (runs in background) */
  // Re-checks a "pending" WA message's delivery report a few times (with increasing
  // delays) to catch late rejections — e.g. the number turns out not to be on
  // WhatsApp — after it was already optimistically marked Sent. groupId/id are the
  // provider's status codes; see the branches below for what each combination means.
  const pollWaStatus = async (messageId, idx, recName, dbId, phone) => {
    const delays = [4000, 6000, 8000, 10000, 12000];
    for (const delay of delays) {
      await new Promise(r => setTimeout(r, delay));
      try {
        const res = await fetch(`${WA_BASE}/api/whatsapp/v1/reports?messageId=${messageId}&limit=1`, {
          headers: { Authorization: `Bearer ${await getApiToken("wa")}`, Accept: "application/json" },
        });
        if (!res.ok) continue;
        const data = await res.json().catch(() => null);
        const result = data?.results?.[0];
        if (!result) continue;
        const grp = result.status?.groupId;
        const rid = result.status?.id;
        if (grp === 18) continue; // still pending, keep polling
        if (grp === 20 && [73, 109, 77].includes(rid)) {
          // confirmed delivered — already marked sent, nothing to do
          return;
        }
        if (
          (grp === 20 && [75, 76, 78, 79, 80].includes(rid)) ||
          grp === 19
        ) {
          setRecords(rs => rs.map((r,i) => i===idx ? {...r, waStatus:WA.invalid} : r));
          setBulkLog(l => l.map(x => x.name===recName ? {...x, status:"invalid"} : x));
          autoSaveCard(dbId, WA.invalid);
          logHistory({ channel:"whatsapp", action:"status", status:"invalid", name:recName, phone, title:waTemplate, detail:"Late delivery report: number not on WhatsApp" });
          showToast(`${recName} — number not on WhatsApp`, "warn");
          return;
        }
        if (grp === 22) {
          setRecords(rs => rs.map((r,i) => i===idx ? {...r, waStatus:WA.notSent} : r));
          setBulkLog(l => l.map(x => x.name===recName ? {...x, status:"not sent"} : x));
          autoSaveCard(dbId, WA.notSent);
          logHistory({ channel:"whatsapp", action:"status", status:"not_sent", name:recName, phone, title:waTemplate, detail:`Late delivery report: ${result.status?.name || "not sent"}` });
          return;
        }
      } catch { /* network error, retry */ }
    }
    // exhausted — leave as Sent (message was accepted by server)
  };

  /* Step 2 — Send WA using the already-uploaded cardUrl */
  // Sends one WhatsApp template message (image header = the record's uploaded
  // card) via messaging-service.co.tz, and interprets the provider's response
  // status codes (groupId/id) to mark the record Sent, Invalid, or Not Sent.
  // A "pending" (groupId 18) response kicks off pollWaStatus in the background.
  const sendWaSingle = async (idx) => {
    const rec = records[idx];
    if (rec.waStatus === WA.sending) return;   // a request for this row is already in flight
    if (!rec.phone)   { showToast("No phone for " + rec.name, "warn"); return; }
    if (!isValidPhone(rec.phone)) { showToast(`Invalid phone number for ${rec.name}`, "warn"); return; }
    if (!rec.cardUrl) { showToast(`Upload card first for ${rec.name}`, "warn"); return; }
    if (!waTemplate)  { showToast("Select a template first", "warn"); return; }
    if (rec.waStatus === WA.sent && !(await confirmResend(rec.name, "this card on WhatsApp"))) return;
    setRecords(rs => rs.map((r,i) => i===idx ? {...r, waStatus:WA.sending} : r));
    setBulkLog(l => {
      const exists = l.find(x => x.name === rec.name);
      return exists ? l.map(x => x.name===rec.name ? {...x, status:"sending"} : x)
                    : [...l, { name:rec.name, status:"sending" }];
    });
    try {
      const reqBody = {
        to:       [Number(normalisePhone(rec.phone))],
        account:  "Nikadi",
        template: waTemplate,
        header:   { image: { file: rec.cardUrl, name: rec.name || "Event Card" } },
      };
      const res = await fetch(`${WA_BASE}/api/whatsapp/v2/text/single`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await getApiToken("wa")}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(reqBody),
      });
      const rawText = await res.text().catch(() => "");

      const markSent = () => {
        setRecords(rs => rs.map((r,i) => i===idx ? {...r, waStatus:WA.sent} : r));
        setBulkLog(l => l.map(x => x.name===rec.name ? {...x, status:"sent"} : x));
        autoSaveCard(rec.dbId, WA.sent);
        logHistory({ channel:"whatsapp", action:"send", status:"sent", name:rec.name, phone:rec.phone, title:waTemplate });
        showToast(`WA sent to ${rec.name}`, "success");
      };
      const markInvalid = (reason) => {
        setRecords(rs => rs.map((r,i) => i===idx ? {...r, waStatus:WA.invalid} : r));
        setBulkLog(l => l.map(x => x.name===rec.name ? {...x, status:"invalid"} : x));
        autoSaveCard(rec.dbId, WA.invalid);
        logHistory({ channel:"whatsapp", action:"send", status:"invalid", name:rec.name, phone:rec.phone, title:waTemplate, detail:reason });
        showToast(`${rec.name} — ${reason}`, "warn");
      };

      const invalidHint = (t = "") => {
        const s = t.toLowerCase();
        return s.includes("not a whatsapp") || s.includes("not registered")
          || s.includes("unregistered") || s.includes("no whatsapp")
          || s.includes("missing outlet") || s.includes("recipient not found");
      };

      if (!res.ok) {
        if ((res.status === 422 || res.status === 400) && invalidHint(rawText)) {
          markInvalid("number not on WhatsApp"); return;
        }
        throw new Error(`HTTP ${res.status}: ${rawText}`);
      }

      let data = {};
      try { data = JSON.parse(rawText); } catch { throw new Error("Invalid JSON response"); }

      const msg   = data?.messages?.[0];
      const grp   = msg?.status?.groupId;
      const id    = msg?.status?.id;
      const sName = msg?.status?.name || "";
      const sDesc = (msg?.status?.description || "").toLowerCase();

      if (grp === 18) {
        // PENDING — accepted by API; mark Sent now, poll in background for rejection
        markSent();
        const messageId = msg?.messageId;
        if (messageId) pollWaStatus(messageId, idx, rec.name, rec.dbId, rec.phone);
      } else if (grp === 20 && [73, 109, 77].includes(id)) {
        // DELIVERED_TO_HANDSET / SENT_TO_OPERATOR / DELIVERED_TO_OPERATOR
        markSent();
      } else if (
        (grp === 20 && [75, 76, 78, 79, 80].includes(id)) ||
        (grp === 19 && id === 111) ||
        invalidHint(sName) || invalidHint(sDesc)
      ) {
        // UNDELIVERABLE / REJECTED_MISSING_OUTLET — number not on WhatsApp
        markInvalid("number not on WhatsApp");
      } else {
        throw new Error(sName || `groupId ${grp}`);
      }
    } catch (err) {
      setRecords(rs => rs.map((r,i) => i===idx ? {...r, waStatus:WA.notSent} : r));
      setBulkLog(l => l.map(x => x.name===rec.name ? {...x, status:"not sent"} : x));
      autoSaveCard(rec.dbId, WA.notSent);
      logHistory({ channel:"whatsapp", action:"send", status:"not_sent", name:rec.name, phone:rec.phone, title:waTemplate, detail:err.message });
      showToast(`WA failed for ${rec.name}: ${err.message}`, "warn");
    }
  };

  // Sends the WhatsApp card to every record that has a valid phone and an uploaded
  // card, one at a time with a 1s pacing delay. Skips contacts already sent, asks in a
  // modal first (a bulk send costs credits and can't be recalled) — including whether to
  // skip or include repeated numbers — then saves the resulting statuses to
  // `event_cards` if an event is loaded.
  const sendWaAll = async () => {
    if (bulkSending) return;
    const targets = await pickBulkRecipients({
      title:    "Send WhatsApp cards",
      emptyMsg: "Nothing to send — upload cards first.",
      options:  { isDone: r => r.waStatus === WA.sent, isEligible: r => !!r.cardUrl },
    });
    if (!targets) return;
    setBulkSending(true);
    setBulkLog(targets.map(({rec}) => ({ name:rec.name, status:"sending" })));
    for (const {index} of targets) {
      await sendWaSingle(index);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    setBulkSending(false);
    showToast(`Done — ${targets.length} WA messages dispatched`, "success");
    const waNow = (s) => targets.filter(({index}) => recordsRef.current[index]?.waStatus === s).length;
    logHistory({ channel:"whatsapp", action:"bulk", title:waTemplate,
      detail:`${targets.length} cards: ${waNow(WA.sent)} sent, ${waNow(WA.invalid)} invalid, ${waNow(WA.notSent)} not sent` });
    // recordsRef is current here: the 1s pacing delay above lets React flush the status updates
    if (savedEventId) await saveCards(savedEventId, recordsRef.current);
  };

  // Exports an Excel (.xlsx) report of WhatsApp send status per record, named after the event
  const downloadWaReport = async () => {
    const statusLabel = {
      [WA.sent]:    "Sent",
      [WA.invalid]: "Invalid",
      [WA.notSent]: "Not Sent",
      [WA.sending]: "Sending",
      [WA.idle]:    "Not Sent",
    };
    const rows = records.map(r => ({
      "Name":       r.name     || "",
      "Card Type":  r.cardType || "",
      "Phone":      r.phone ? `+${normalisePhone(r.phone)}` : "",
      "WA Status":  statusLabel[r.waStatus] || "Not Sent",
    }));
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "WA Report");
    const evName = (eventData.username || "Event").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
    XLSX.writeFile(wb, `${evName}_WA_Report_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  // Exports one Excel sheet with both WhatsApp and SMS status per record, named after the event
  const downloadFullReport = async () => {
    const waLabel  = { [WA.sent]:"Sent", [WA.invalid]:"Invalid", [WA.notSent]:"Not Sent", [WA.sending]:"Sending", [WA.idle]:"Not Sent" };
    const smsLabel = { [SMS.delivered]:"Delivered", [SMS.sent]:"Sent", [SMS.failed]:"Failed", [SMS.pending]:"Pending" };
    const rows = records.map(r => ({
      "Name":       r.name     || "",
      "Card Type":  r.cardType || "",
      "Phone":      r.phone ? `+${normalisePhone(r.phone)}` : "",
      "WA Status":  waLabel[r.waStatus]   || "Not Sent",
      "SMS Status": smsLabel[r.smsStatus] || "Pending",
    }));
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch:28 }, { wch:14 }, { wch:18 }, { wch:14 }, { wch:14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Send Report");
    const evName = (eventData.username || "Event").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
    XLSX.writeFile(wb, `${evName}_Send_Report_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  // Downloads one record's rendered card as a single PNG file
  const downloadCard = async (idx) => {
    const rec = records[idx];
    try {
      const url = await exportCard(bgImage, bgSize, designElements, rec);
      const a = document.createElement("a"); a.download=`${(rec.name||`Record_${idx}`).replace(/\s/g,"_")}_Nikadi.png`; a.href=url; a.click();
    } catch (err) { showToast(`Could not render card for ${rec.name}: ${err.message}`, "warn"); }
  };

  // Renders every record's card and zips them into a single "nikadi_cards.zip" download
  const downloadAll = async () => {
    if (!records.length) { showToast("No records","warn"); return; }
    showToast(`Zipping ${records.length} cards…`,"info");
    try {
      const JSZip = await loadJsZip();
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
    } catch (err) { showToast(`Download failed: ${err.message}`, "warn"); }
  };

  /* ── SMS ── */
  const SMS_BASE = import.meta.env.DEV
    ? "/sms-proxy"
    : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms`;
  const SMS_API = `${SMS_BASE}/api/sms/v2`;

  // Queries the messaging-service.co.tz balance endpoint for remaining SMS credits
  const fetchSmsBalance = async () => {
    setSmsBalanceLoading(true);
    try {
      const res = await fetch(`${SMS_BASE}/api/v2/balance`, {
        headers: {
          Authorization: `Bearer ${await getApiToken("sms")}`,
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

  // Sends a single SMS to one record (rendered from the SMS template) and updates
  // its smsStatus from the provider's response groupId (18=sent, 20=delivered).
  // Guarded against double-clicks (in-flight set) and accidental re-sends (confirm).
  // `msgId` picks the message (default: the main one, as the Batch & Send tab uses); `idx`
  // is the row in that message's recipient list.
  const sendSmsToOne = async (idx, msgId = MAIN_MSG) => {
    const msg = findMessage(msgId);
    if (msgId !== MAIN_MSG && !msg) return;
    const recs = messageRecipients(msg);
    const rec  = recs[idx];
    if (!rec) return;
    if (!rec.phone) { showToast("No phone for " + rec.name, "warn"); return; }
    if (!isValidPhone(rec.phone)) { showToast(`Invalid phone number for ${rec.name}`, "warn"); return; }
    const flightKey = `${msgId}:${idx}`;
    if (smsInFlight.current.has(flightKey)) return;
    if ((rec.smsStatus === SMS.sent || rec.smsStatus === SMS.delivered)
        && !(await confirmResend(rec.name, msg ? `"${msg.title}"` : "this SMS"))) return;
    smsInFlight.current.add(flightKey);
    setSmsLog(l => [...l, { name: rec.name, status: "sending" }]);
    try {
      const res = await fetch(`${SMS_API}/text/single`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await getApiToken("sms")}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          from: smsSettings.senderId || "NIKADI",
          to:   normalisePhone(rec.phone),
          text: buildSmsMsg(rec, msg ? msg.body : smsMessage),
          flash: 0,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const grp = data?.messages?.[0]?.status?.groupId;
      if (grp === 18 || grp === 20) {
        const status = grp === 20 ? SMS.delivered : SMS.sent;
        const logStatus = grp === 20 ? "delivered" : "sent";
        setMessageStatuses(msgId, recs, new Map([[idx, status]]));
        logHistory({ channel:"sms", action:"send", status:logStatus, name:rec.name, phone:rec.phone, title: msg ? msg.title : "Main message" });
        setSmsLog(l => l.map(x => x.name === rec.name ? { ...x, status: logStatus } : x));
        if (!msg) autoSaveCard(rec.dbId, undefined, status);
        showToast(`SMS ${logStatus} to ${rec.name}`, "success");
      } else {
        throw new Error(data?.messages?.[0]?.status?.name || "Unexpected status");
      }
    } catch (err) {
      setSmsLog(l => l.map(x => x.name === rec.name ? { ...x, status: "failed" } : x));
      setMessageStatuses(msgId, recs, new Map([[idx, SMS.failed]]));
      logHistory({ channel:"sms", action:"send", status:"failed", name:rec.name, phone:rec.phone, title: msg ? msg.title : "Main message", detail:err.message });
      if (!msg) autoSaveCard(rec.dbId, undefined, SMS.failed);
      showToast(`SMS failed for ${rec.name}: ${err.message}`, "warn");
    } finally {
      smsInFlight.current.delete(flightKey);
    }
  };

  // Sends SMS to every record with a valid phone number in one bulk API call, then maps
  // the per-recipient results back onto `records` by matching normalised phone numbers,
  // and saves the updated statuses if an event is loaded. Skips contacts already sent and
  // asks in a modal first (it costs credits) — including whether to skip or include
  // repeated numbers. `msgId` picks which message (and so which recipient list) is sent.
  const sendAllSms = async (msgId = MAIN_MSG) => {
    if (smsSending) return;
    const msg = findMessage(msgId);
    if (msgId !== MAIN_MSG && !msg) return;
    if (msg && !msg.body.trim()) { showToast(`"${msg.title}" has no text yet`, "warn"); return; }
    const recs = messageRecipients(msg);
    const targets = await pickBulkRecipients({
      title:    msg ? `Send "${msg.title}"` : "Send SMS",
      emptyMsg: "No SMS to send.",
      options:  { isDone: r => r.smsStatus === SMS.sent || r.smsStatus === SMS.delivered },
      recs,
    });
    if (!targets) return;
    setSmsSending(true);
    setSmsLog(targets.map(({rec}) => ({ name: rec.name, status: "sending" })));
    const msgTitle = msg ? msg.title : "Main message";
    // How this run changes `records`; applied to state and to the copy that gets saved
    let applyResults = (rs) => rs;
    try {
      const messages = targets.map(({rec}) => ({
        from: smsSettings.senderId || "NIKADI",
        to:   normalisePhone(rec.phone),
        text: buildSmsMsg(rec, msg ? msg.body : smsMessage),
      }));
      const res = await fetch(`${SMS_API}/text/multi`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await getApiToken("sms")}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ messages, flash: 0 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const respMsgs = data?.messages || [];
      // The provider echoes each recipient's number. If a number was sent more than once
      // (user chose "Send duplicates too"), hand out its results in order, one per record.
      const queues = new Map();
      respMsgs.forEach(m => {
        const k = String(m.to);
        if (!queues.has(k)) queues.set(k, []);
        queues.get(k).push(m);
      });
      const groupIds = targets.map(({rec}) => queues.get(normalisePhone(rec.phone))?.shift()?.status?.groupId);
      const statusOf = (grp) => grp === 20 ? SMS.delivered : grp === 18 ? SMS.sent : SMS.failed;
      // index → new smsStatus, only for recipients the provider actually reported on
      const updates = new Map(targets.flatMap(({index}, n) => groupIds[n] === undefined ? [] : [[index, statusOf(groupIds[n])]]));
      if (msg) setMessageStatuses(msgId, recs, updates);   // extra message: its own statuses, saved at once
      else {
        applyResults = (rs) => rs.map((r, i) => updates.has(i) ? { ...r, smsStatus: updates.get(i) } : r);
        setRecords(applyResults);
      }
      setSmsLog(targets.map(({rec}, n) => ({
        name: rec.name,
        status: groupIds[n] === 20 ? "delivered" : groupIds[n] === 18 ? "sent" : "failed",
      })));
      const sentCount = respMsgs.filter(m => m.status?.groupId === 18 || m.status?.groupId === 20).length;
      targets.forEach(({rec}, n) => logHistory({
        channel:"sms", action:"send", name:rec.name, phone:rec.phone, title:msgTitle,
        status: groupIds[n] === 20 ? "delivered" : groupIds[n] === 18 ? "sent" : "failed",
        detail: groupIds[n] === undefined ? "No result from the SMS provider" : undefined,
      }));
      logHistory({ channel:"sms", action:"bulk", title:msgTitle, detail:`${sentCount}/${targets.length} SMS sent` });
      showToast(`Done — ${sentCount}/${targets.length} SMS sent`, "success");
    } catch (err) {
      setSmsLog(targets.map(({rec}) => ({ name: rec.name, status: "failed" })));
      targets.forEach(({rec}) => logHistory({ channel:"sms", action:"send", status:"failed", name:rec.name, phone:rec.phone, title:msgTitle, detail:err.message }));
      logHistory({ channel:"sms", action:"bulk", status:"failed", title:msgTitle, detail:`Bulk SMS to ${targets.length} failed: ${err.message}` });
      showToast(`Bulk SMS failed: ${err.message}`, "warn");
    }
    setSmsSending(false);
    // `records` in this closure is pre-send; apply the same updates to the latest list
    if (!msg && savedEventId) await saveCards(savedEventId, applyResults(recordsRef.current));
  };

  // Safe file-name fragment for the selected message ("" for the main message)
  const activeMsgSlug = activeExtra ? "_" + activeExtra.title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") : "";

  // Exports phone+message pairs for the selected message as a CSV, for sending via a third-party bulk SMS tool
  const downloadSmsCsv = () => {
    if (!activeRecipients.length) { showToast("No records","warn"); return; }
    const rows = [["Phone","Message"], ...activeRecipients.filter(r=>r.phone).map(r=>[`+${normalisePhone(r.phone)}`,buildSmsMsg(r, activeBody)])];
    downloadBlob(rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n"), `nikadi_sms_list${activeMsgSlug}.csv`, "text/csv");
    showToast(`Downloaded SMS list (${rows.length-1} recipients)`,"success");
  };

  // Exports an Excel (.xlsx) report of SMS status per recipient of the selected message, named after the event
  const downloadSmsReport = async () => {
    const smsLabel = { [SMS.delivered]:"Delivered", [SMS.sent]:"Sent", [SMS.failed]:"Failed", [SMS.pending]:"Pending" };
    const rows = activeRecipients.map(r => ({
      "Name":       r.name     || "",
      "Card Type":  r.cardType || "",
      "Phone":      r.phone ? `+${normalisePhone(r.phone)}` : "",
      "SMS Status": smsLabel[r.smsStatus] || "Pending",
    }));
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch:28 }, { wch:14 }, { wch:18 }, { wch:14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SMS Report");
    const evName = (eventData.username || "Event").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
    XLSX.writeFile(wb, `${evName}${activeMsgSlug}_SMS_Report_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  /* ── Counts ── */
  const waSentCount    = records.filter(r=>r.waStatus===WA.sent).length;
  const waInvalidCount = records.filter(r=>r.waStatus===WA.invalid).length;
  const smsSentCount   = records.filter(r=>r.smsStatus===SMS.sent||r.smsStatus===SMS.delivered).length;
  const waReportReady  = records.some(r=>r.waStatus===WA.sent||r.waStatus===WA.invalid||r.waStatus===WA.notSent);
  const smsReportReady = activeRecipients.some(r=>r.smsStatus && r.smsStatus!==SMS.pending);   // reads statuses, not the log, so it outlives the log
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
    <div style={{minHeight:"100vh",background:N.navy900,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{width:40,height:40,border:`3px solid ${N.border}`,borderTopColor:N.accent,borderRadius:"50%",animation:"spin 0.8s linear infinite"}} />
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

        {/* Activity logs — floating (position: fixed) so they never shift the page; each clears
            itself 5 s after its run finishes */}
        {(uploadLog.length > 0 || bulkLog.length > 0 || smsLog.length > 0) && (
          <div className="nk-activity" role="log" aria-live="polite">
            <LogSection title="Upload Log"   color={N.sky}   styles={LOG_STYLES.upload} log={uploadLog} onClose={()=>setUploadLog([])} />
            <LogSection title="WhatsApp Log" color={N.green} styles={LOG_STYLES.wa}     log={bulkLog}   onClose={()=>setBulkLog([])} />
            <LogSection title="SMS Log"      color={N.teal}  styles={LOG_STYLES.sms}    log={smsLog}    onClose={()=>setSmsLog([])} />
          </div>
        )}

        {/* Choice dialog (bulk-send / re-send confirmations) */}
        {dialog && (
          <div className="nk-overlay" onClick={e => e.target===e.currentTarget && closeDialog(null)}>
            <div className="nk-dialog" role="dialog" aria-modal="true" aria-labelledby="nk-dialog-title">
              <div className="nk-dialog-title" id="nk-dialog-title">{dialog.title}</div>
              <div className="nk-dialog-body">{dialog.body}</div>
              <div className="nk-dialog-actions">
                {/* Cancel is focused by default so a stray Enter can never trigger a send */}
                <button className="nk-btn nk-btn-ghost" autoFocus onClick={()=>closeDialog(null)}>Cancel</button>
                {dialog.actions.map(a => (
                  <button key={a.value} className={`nk-btn nk-btn-${a.kind||"primary"}`} onClick={()=>closeDialog(a.value)}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Delete confirm */}
        {deleteTarget && (
          <div className="nk-overlay">
            <div className="nk-confirm">
              <div className="nk-confirm-title">Delete Event?</div>
              <div className="nk-confirm-body">
                This will permanently delete <strong style={{color:N.text}}>"{deleteTarget.username}"</strong> and all its cards and history from the database. This cannot be undone.
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
            <button className="nk-btn nk-btn-success" onClick={sendWaAll} disabled={bulkSending}>
              {bulkSending ? "⏳ Sending…" : `📲 WA Send All (${records.filter(r=>r.phone).length})`}
            </button>
            <button className="nk-btn nk-btn-primary" onClick={downloadAll}>
              ⬇ Download All ({records.length})
            </button>
            {/* Theme: System (follows the browser) → Light → Dark */}
            <button className="nk-btn nk-btn-ghost" style={{padding:"6px 10px",fontSize:12}}
              onClick={()=>setThemePref(nextThemePref(themePref))}
              title={`Theme: ${THEME_LABELS[themePref]} — click to change`}
              aria-label={`Theme: ${THEME_LABELS[themePref]}. Click to change.`}>
              {THEME_ICONS[themePref]} {THEME_LABELS[themePref]}
            </button>
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
          <button className={`nk-tab${tab==="events"?" active":""}`}    onClick={()=>{ loadSavedEvents(); setTab("events"); }}>🗂 Events</button>
          <button className={`nk-tab${tab==="design"?" active":""}`}    onClick={()=>setTab("design")}>🎨 Design</button>
          <button className={`nk-tab${tab==="vcard"?" active":""}`}     onClick={()=>setTab("vcard")}>📇 VCard</button>
          <button className={`nk-tab${tab==="sms"?" active":""}`}       onClick={()=>setTab("sms")}>💬 SMS</button>
          <button className={`nk-tab${tab==="whatsapp"?" active":""}`}  onClick={()=>setTab("whatsapp")}>📲 WhatsApp</button>
          <button className={`nk-tab${tab==="batch"?" active":""}`}     onClick={()=>setTab("batch")}>📊 Batch & Send</button>
          <button className={`nk-tab${tab==="reports"?" active":""}`}   onClick={()=>setTab("reports")}>📋 Reports</button>
          <button className={`nk-tab${tab==="history"?" active":""}`}   onClick={()=>setTab("history")}>🕘 History</button>
        </nav>

        {/* Info banners */}
        {tab==="batch" && (
          <div className="nk-banner">
            <span style={{fontSize:16,marginTop:1}}>ℹ</span>
            <span><strong>WhatsApp Sending:</strong> Select an image in the <strong>WhatsApp</strong> tab, then use <strong style={{color:N.green}}>📲 WA</strong> per row or <strong style={{color:N.green}}>WA Send All</strong> in the header. 1 second gap per number.</span>
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
                  <div style={{fontSize:11,color:N.amber,background:N.amberBg,border:`1px solid ${alpha(N.amber,"44")}`,borderRadius:8,padding:"8px 12px",marginBottom:8,display:"flex",gap:8,alignItems:"center"}}>
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

              {/* WhatsApp info */}
              <div>
                <div className="nk-sec">WhatsApp</div>
                <div className="nk-chip" style={{fontSize:11,lineHeight:1.8}}>
                  Each card is generated<br/>
                  from the canvas design<br/>
                  and sent per recipient.
                </div>
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
                          <tr key={ev.id} className={savedEventId===ev.id?"row-active":""}
                            onClick={()=>selectEvent(ev)}
                            style={{cursor:"pointer"}}
                            title="Click to load this event and open its design">
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
                                  onClick={(e)=>{ e.stopPropagation(); createCardsFromEvent(ev); }}
                                  title="Load this event and open card designer">
                                  🎨 Create Cards
                                </Sb>
                                <Sb bg={N.navy600} col={N.teal} border={alpha(N.teal,"44")}
                                  onClick={(e)=>{ e.stopPropagation(); selectEvent(ev, "reports"); }}
                                  title="View this event's cards and download the send report">
                                  📋 Report
                                </Sb>
                                <Sb bg={N.navy600} col={N.purple} border={alpha(N.purple,"44")}
                                  onClick={(e)=>{ e.stopPropagation(); selectEvent(ev, "history"); }}
                                  title="Every card and SMS sent for this event, with results">
                                  🕘 History
                                </Sb>
                                <Sb bg={N.navy600} col={N.sky} border={alpha(N.sky,"44")}
                                  onClick={(e)=>{ e.stopPropagation(); setModalEvent({...ev, start_datetime: ev.start_datetime?ev.start_datetime.slice(0,16):"", end_datetime: ev.end_datetime?ev.end_datetime.slice(0,16):""}); }}
                                  title="Edit event details">
                                  ✏ Edit
                                </Sb>
                                <Sb bg={N.redBg} col={N.red} border={alpha(N.red,"44")}
                                  onClick={(e)=>{ e.stopPropagation(); setDeleteTarget(ev); }}
                                  title="Delete this event">
                                  🗑 Delete
                                </Sb>
                                {ev.cover_image_url && (
                                  <Sb bg={N.navy700} col={N.textMid} border={N.border}
                                    onClick={(e)=>{ e.stopPropagation(); window.open(ev.cover_image_url,"_blank"); }}
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
                    {/* Message picker — the main message plus any extra ones (reminder, thank-you…) */}
                    <div className="nk-sec nk-sec-teal" style={{marginBottom:6}}>Messages</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:14}}>
                      {[{ id: MAIN_MSG, title: "Main message" }, ...extraMessages].map(m => {
                        const on = m.id === activeMsgId;
                        return (
                          <button key={m.id} onClick={()=>setActiveMsgId(m.id)}
                            style={{
                              padding:"4px 11px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer",
                              background: on ? N.tealBg : N.navy700, color: on ? N.teal : N.textMid,
                              border:`1px solid ${on ? N.teal : N.border}`,
                            }}>
                            {m.title}
                          </button>
                        );
                      })}
                      <button onClick={addExtraMessage}
                        style={{padding:"4px 11px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",background:"transparent",color:N.sky,border:`1px dashed ${alpha(N.sky,"66")}`}}>
                        ＋ Add message
                      </button>
                    </div>

                    {/* Extra message: title + who it goes to */}
                    {activeExtra && (
                      <div style={{background:N.cardBg,border:`1px solid ${N.border}`,borderRadius:8,padding:"10px 12px",marginBottom:14}}>
                        <label className="nk-label">Message title</label>
                        <div style={{display:"flex",gap:6,marginBottom:10}}>
                          <input className="nk-input" style={{flex:1}} value={activeExtra.title} maxLength={60}
                            onChange={e=>updateExtraMessage(activeExtra.id, { title: e.target.value })} />
                          <button className="nk-btn nk-btn-ghost" style={{padding:"4px 10px",fontSize:11,color:N.red}}
                            onClick={()=>deleteExtraMessage(activeExtra)} title="Delete this message">🗑</button>
                        </div>
                        <label className="nk-label">Send to</label>
                        <div style={{display:"flex",gap:5,marginBottom:8}}>
                          {[["contacts","👥 Event contacts"],["upload","📄 Uploaded list"]].map(([src,label]) => {
                            const on = activeExtra.source === src;
                            return (
                              <button key={src}
                                onClick={()=>{ if (src === "contacts" && !on) setMessageList(activeExtra, { source:"contacts" }); }}
                                disabled={src === "upload" && !on}
                                title={src === "upload" && !on ? "Upload a file or use the VCard list below" : undefined}
                                style={{
                                  flex:1, padding:"5px 8px", borderRadius:6, fontSize:11, fontWeight:600,
                                  cursor: on || src === "upload" ? "default" : "pointer",
                                  background: on ? N.tealBg : N.navy700, color: on ? N.teal : N.textDim,
                                  border:`1px solid ${on ? N.teal : N.border}`,
                                }}>
                                {label}
                              </button>
                            );
                          })}
                        </div>
                        {activeExtra.source === "upload" && (
                          <div style={{fontSize:11,color:N.textMid,marginBottom:8}}>
                            📄 {activeExtra.fileName || "List"} — {activeExtra.recipients.length} recipients
                          </div>
                        )}
                        <div style={{display:"flex",gap:6}}>
                          <label className="nk-btn nk-btn-ghost" style={{flex:1,fontSize:11,padding:"6px 8px",textAlign:"center",cursor:"pointer"}}>
                            <input type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={onMessageListUpload} />
                            ⬆ {activeExtra.source === "upload" ? "Replace list" : "Upload list"}
                          </label>
                          <button className="nk-btn nk-btn-ghost" style={{flex:1,fontSize:11,padding:"6px 8px"}}
                            disabled={!vcardContacts.length}
                            title={vcardContacts.length ? `Use the ${vcardContacts.length} contacts loaded in the VCard tab` : "Upload a list in the VCard tab first"}
                            onClick={()=>setMessageList(activeExtra, { source:"upload", rows: vcardContacts, columns: vcardColumns, fileName:"VCard tab list" })}>
                            📇 Use VCard list
                          </button>
                        </div>
                        <p style={{fontSize:10,color:N.textDim,marginTop:8,lineHeight:1.6}}>
                          Excel/CSV with a Name and Phone column. Every other column (Table, Amount…) becomes a {"{placeholder}"} for this message.
                        </p>
                      </div>
                    )}

                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                      <div className="nk-sec nk-sec-teal" style={{margin:0}}>{activeExtra ? activeExtra.title : "SMS Message"}</div>
                      {savedEventId && (
                        activeExtra
                          ? <span style={{fontSize:10,fontFamily:"JetBrains Mono, monospace",color: extraMsgsSaved ? N.green : N.textDim, transition:"color 0.3s"}}>
                              {extraMsgsSaved ? "✓ saved" : "auto-saves"}
                            </span>
                          : <span style={{fontSize:10,fontFamily:"JetBrains Mono, monospace",color: smsDraftSaved ? N.green : N.textDim, transition:"color 0.3s"}}>
                              {smsDraftSaved ? "✓ draft saved" : "draft auto-saves"}
                            </span>
                      )}
                    </div>
                    <p style={{fontSize:11,color:N.textDim,marginBottom:8,lineHeight:1.6}}>
                      Separate from WhatsApp — sent as plain SMS.
                    </p>
                    <textarea ref={smsTextareaRef} className="nk-input nk-textarea" value={activeBody} onChange={e=>setActiveBody(e.target.value)} rows={5}
                      placeholder={activeExtra ? "e.g. Habari {name}, kumbuka sherehe ni kesho…" : undefined} />
                    <div style={{display:"flex",alignItems:"center",gap:10,marginTop:8,marginBottom:14}}>
                      {!activeExtra && (
                        <button
                          className="nk-btn nk-btn-teal"
                          style={{fontSize:11,padding:"6px 14px"}}
                          onClick={saveSmsMessage}
                          disabled={smsMsgSaving || !savedEventId || smsMessage===smsPersistedMsg.current}>
                          {smsMsgSaving?"⏳ Saving…":"💾 Save Template"}
                        </button>
                      )}
                      {!activeExtra && savedEventId && smsMessage!==smsPersistedMsg.current && (
                        <span style={{fontSize:11,color:N.amber}}>● Unsaved changes</span>
                      )}
                      {!savedEventId && (
                        <span style={{fontSize:11,color:N.textDim}}>Save the event first to persist {activeExtra ? "this message" : "this template"}</span>
                      )}
                    </div>
                    {/* Clickable column chips — insert the placeholder at the cursor */}
                    <div style={{marginBottom:14}}>
                      <div style={{fontSize:10,color:N.textDim,marginBottom:6}}>Click to insert variable:</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                        {activeColumns.map(col => (
                          <button key={col}
                            onClick={() => {
                              const ta  = smsTextareaRef.current;
                              const ph  = `{${col}}`;
                              if (!ta) { setActiveBody(m => m + ph); return; }
                              const s   = ta.selectionStart;
                              const e2  = ta.selectionEnd;
                              const nxt = activeBody.slice(0,s) + ph + activeBody.slice(e2);
                              setActiveBody(nxt);
                              setTimeout(() => { ta.focus(); ta.setSelectionRange(s+ph.length, s+ph.length); }, 0);
                            }}
                            style={{
                              padding:"3px 10px", borderRadius:5, fontSize:11,
                              fontFamily:"JetBrains Mono, monospace", cursor:"pointer",
                              background:N.navy700, color:N.sky, border:`1px solid ${alpha(N.sky,"33")}`,
                            }}>
                            {`{${col}}`}
                          </button>
                        ))}
                      </div>
                    </div>
                    {(()=>{
                      const sample   = buildSmsMsg(activeRecipients[0]||{}, activeBody);
                      const len      = sample.length;
                      const parts    = len === 0 ? 1 : len <= 160 ? 1 : Math.ceil(len / 153);
                      const contacts = activeRecipients.filter(r=>r.phone).length;
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
                    <div style={{background:N.tealBg,border:`1.5px solid ${alpha(N.teal,"55")}`,borderRadius:10,padding:"18px 20px",marginBottom:14,textAlign:"center"}}>
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
                    <button className="nk-btn nk-btn-teal nk-btn-full" onClick={()=>sendAllSms(activeMsgId)} disabled={smsSending}>
                      {smsSending?"⏳ Sending…":`💬 Send ${activeExtra ? `"${activeExtra.title}"` : "SMS"} to All (${activeRecipients.filter(r=>r.phone).length})`}
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
                                {buildSmsMsg(activeRecipients[0]||{name:"Mwanakadi",cardType:"VIP"}, activeBody)}
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
                    <div className="nk-sec nk-sec-teal">SMS Preview per Recipient{activeExtra ? ` — ${activeExtra.title}` : ""}</div>
                    {!smsSending && smsReportReady && (
                      <button className="nk-btn nk-btn-full" onClick={downloadSmsReport}
                        style={{background:N.tealBg,color:N.teal,border:`1px solid ${alpha(N.teal,"33")}`,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                        <span style={{fontSize:16}}>⬇</span> Download SMS Report (.xlsx)
                      </button>
                    )}
                    <div className="nk-table-wrap">
                      <table className="nk-table">
                        <thead><tr>{["#","Name","Phone","SMS Preview","Status",""].map(h=><th key={h}>{h}</th>)}</tr></thead>
                        <tbody>
                          {activeRecipients.map((rec,i)=>(
                            <tr key={i}>
                              <td style={{color:N.accent,fontFamily:"JetBrains Mono, monospace",fontSize:12}}>#{i+1}</td>
                              <td style={{fontWeight:600}}>{rec.name}</td>
                              <td style={{fontFamily:"JetBrains Mono, monospace",fontSize:12,color:N.textMid}}>
                                {rec.phone?`+${normalisePhone(rec.phone)}`:<span style={{color:N.textDim}}>—</span>}
                              </td>
                              <td style={{fontSize:11,color:N.textMid,maxWidth:260}}>
                                <div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{buildSmsMsg(rec, activeBody)}</div>
                              </td>
                              <td>
                                <span className={`nk-badge ${rec.smsStatus===SMS.delivered?"badge-yes":rec.smsStatus===SMS.sent?"badge-sent":rec.smsStatus===SMS.failed?"badge-no":"badge-idle"}`}>
                                  {rec.smsStatus===SMS.delivered?"✓ Delivered":rec.smsStatus===SMS.sent?"↑ Sent":rec.smsStatus===SMS.failed?"✗ Failed":"○ Pending"}
                                </span>
                              </td>
                              <td>{rec.phone?<Sb bg={N.tealBg} col={N.teal} border={alpha(N.teal,"44")} onClick={()=>sendSmsToOne(i, activeMsgId)}>💬 Send</Sb>:<span style={{fontSize:11,color:N.textDim}}>—</span>}</td>
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
            {/* ─── WHATSAPP ─── */}
            {tab === "whatsapp" && (
              <div className="nk-page" style={{padding:"0 0 40px"}}>
                <div style={{display:"flex",gap:24,alignItems:"flex-start"}}>

                  {/* Left: step controls */}
                  <div style={{flex:"0 0 260px"}}>
                    {/* Step 1 */}
                    <div className="nk-sec" style={{color:N.sky}}>Step 1 — Upload Cards</div>
                    <div className="nk-chip" style={{marginBottom:10,fontSize:11,lineHeight:1.8}}>
                      Renders each personalized card<br/>
                      and uploads to Supabase Storage<br/>
                      to get a public image URL.<br/>
                      <span style={{color:N.green}}>
                        {records.filter(r=>r.uploadStatus==="uploaded").length} / {records.length} uploaded
                      </span>
                    </div>
                    <button className="nk-btn nk-btn-primary nk-btn-full" style={{marginBottom:20}}
                      onClick={uploadAllCards} disabled={uploadingCards}>
                      {uploadingCards ? "⏳ Uploading…" : `☁ Upload All Cards (${records.length})`}
                    </button>

                    {/* Template */}
                    <div className="nk-sec" style={{color:N.amber}}>WhatsApp Template</div>
                    <label className="nk-label">Template Name</label>
                    <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                      {["Mwaliko","Mchango","ImageTemp"].map(t => (
                        <button key={t}
                          onClick={() => setWaTemplate(t)}
                          style={{
                            padding:"6px 14px", borderRadius:6, fontSize:12, fontWeight:600, cursor:"pointer",
                            border: waTemplate===t ? `1.5px solid ${N.amber}` : `1.5px solid ${N.navy500}`,
                            background: waTemplate===t ? N.amberBg : N.navy700,
                            color: waTemplate===t ? N.amber : N.textMid,
                            transition:"all .15s",
                          }}>
                          {t}
                        </button>
                      ))}
                    </div>
                    <input
                      className="nk-input"
                      value={waTemplate}
                      onChange={e => setWaTemplate(e.target.value)}
                      placeholder="or type a custom template…"
                      style={{marginBottom:20,fontSize:12}}
                    />

                    {/* Step 2 */}
                    <div className="nk-sec" style={{color:N.green}}>Step 2 — Send via WhatsApp</div>
                    <div className="nk-chip" style={{marginBottom:10,fontSize:11,lineHeight:1.8}}>
                      Template: <span style={{color:N.amber}}>{waTemplate||"—"}</span><br/>
                      Account: <span style={{color:N.sky}}>Nikadi</span><br/>
                      Delay: <span style={{color:N.sky}}>1 s / number</span><br/>
                      <span style={{color:N.green}}>
                        {records.filter(r=>r.phone&&r.cardUrl).length} ready to send
                      </span>
                    </div>
                    <button className="nk-btn nk-btn-success nk-btn-full"
                      onClick={sendWaAll}
                      disabled={bulkSending||!records.filter(r=>r.phone&&r.cardUrl).length}>
                      {bulkSending ? "⏳ Sending…" : `📲 Send All (${records.filter(r=>r.phone&&r.cardUrl).length})`}
                    </button>
                  </div>

                  {/* Right: table */}
                  <div style={{flex:1}}>
                    {/* Download report — available once any WhatsApp send has finished (it reads the
                        records, not the log, so it stays after the log clears itself) */}
                    {!bulkSending && waReportReady && (
                      <button className="nk-btn nk-btn-full" onClick={downloadWaReport}
                        style={{background:N.greenBg,color:N.green,border:`1px solid ${alpha(N.green,"33")}`,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                        <span style={{fontSize:16}}>⬇</span> Download WA Report (.xlsx)
                      </button>
                    )}
                    {/* Records table */}
                    <div className="nk-table-wrap">
                      <table className="nk-table">
                        <thead><tr>{["#","Name","Phone","Upload","WA","Actions"].map(h=><th key={h}>{h}</th>)}</tr></thead>
                        <tbody>
                          {records.map((rec,i)=>(
                            <tr key={i}>
                              <td style={{color:N.accent,fontFamily:"JetBrains Mono, monospace",fontSize:12}}>#{i+1}</td>
                              <td style={{fontWeight:600}}>{rec.name}</td>
                              <td style={{fontFamily:"JetBrains Mono, monospace",fontSize:12,color:N.textMid}}>
                                {rec.phone ? `+${normalisePhone(rec.phone)}` : <span style={{color:N.textDim}}>—</span>}
                              </td>
                              <td>
                                <span className={`nk-badge ${rec.uploadStatus==="uploaded"?"badge-yes":rec.uploadStatus==="uploading"?"badge-testing":rec.uploadStatus==="failed"?"badge-no":"badge-idle"}`}>
                                  {rec.uploadStatus==="uploaded"?"✓ Ready":rec.uploadStatus==="uploading"?"⏳ Uploading":rec.uploadStatus==="failed"?"✗ Failed":"○ Pending"}
                                </span>
                              </td>
                              <td><WaBadge status={rec.waStatus||WA.idle} reason={rec.waReason} /></td>
                              <td>
                                <div style={{display:"flex",gap:5}}>
                                  <Sb bg={N.navy600} col={N.sky} border={alpha(N.sky,"44")}
                                    onClick={()=>uploadCardSingle(i)}
                                    disabled={rec.uploadStatus==="uploading"}>
                                    {rec.uploadStatus==="uploading"?"⏳":"☁"} Upload
                                  </Sb>
                                  {rec.phone && rec.cardUrl && (
                                    <Sb bg={N.greenBg} col={N.green}
                                      onClick={()=>sendWaSingle(i)}
                                      disabled={rec.waStatus===WA.sending}>
                                      {rec.waStatus===WA.sending?"⏳":"📲"} Send
                                    </Sb>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === "reports" && (
              <div className="nk-page" style={{padding:"0 0 40px"}}>
                {/* Header */}
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:12}}>
                  <div>
                    <div style={{fontSize:18,fontWeight:700,color:N.text}}>{eventData.username||"Event"} — Send Report</div>
                    <div style={{fontSize:12,color:N.textDim,marginTop:2}}>{records.length} recipients · {new Date().toLocaleDateString("en-GB")}</div>
                  </div>
                  <button className="nk-btn nk-btn-success" onClick={downloadFullReport}
                    style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:16}}>⬇</span> Download Report (.xlsx)
                  </button>
                </div>

                {/* Stats */}
                <div className="nk-stats" style={{marginBottom:20}}>
                  {[
                    ["Total",        records.length,                                                                        N.textMid],
                    ["WA Sent",      records.filter(r=>r.waStatus===WA.sent).length,                                       N.green],
                    ["WA Invalid",   records.filter(r=>r.waStatus===WA.invalid).length,                                    N.amber],
                    ["WA Not Sent",  records.filter(r=>r.waStatus===WA.notSent||r.waStatus===WA.idle).length,              N.textDim],
                    ["SMS Sent",     records.filter(r=>r.smsStatus===SMS.sent||r.smsStatus===SMS.delivered).length,        N.teal],
                    ["SMS Pending",  records.filter(r=>r.smsStatus===SMS.pending).length,                                  N.textDim],
                  ].map(([l,v,c])=>(
                    <div key={l} className="nk-stat" style={{borderColor:alpha(c,"33")}}>
                      <div className="nk-stat-num" style={{color:c}}>{v}</div>
                      <div className="nk-stat-label">{l}</div>
                    </div>
                  ))}
                </div>

                {/* Table */}
                <div className="nk-table-wrap">
                  <table className="nk-table">
                    <thead>
                      <tr>{["#","Name","Card Type","Phone","WA Status","SMS Status"].map(h=><th key={h}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {records.map((rec,i)=>{
                        const smsColor = rec.smsStatus===SMS.delivered?N.green:rec.smsStatus===SMS.sent?N.teal:rec.smsStatus===SMS.failed?N.red:N.textDim;
                        return (
                          <tr key={i}>
                            <td style={{color:N.accent,fontFamily:"JetBrains Mono, monospace",fontSize:12}}>#{i+1}</td>
                            <td style={{fontWeight:600}}>{rec.name}</td>
                            <td style={{fontSize:12,color:N.textMid}}>{rec.cardType}</td>
                            <td style={{fontFamily:"JetBrains Mono, monospace",fontSize:12,color:N.textMid}}>
                              {rec.phone ? `+${normalisePhone(rec.phone)}` : <span style={{color:N.textDim}}>—</span>}
                            </td>
                            <td>
                              <WaBadge status={rec.waStatus||WA.idle} />
                            </td>
                            <td>
                              <span style={{fontSize:12,color:smsColor,fontWeight:600}}>
                                {rec.smsStatus===SMS.delivered?"✓ Delivered":rec.smsStatus===SMS.sent?"↑ Sent":rec.smsStatus===SMS.failed?"✗ Failed":"○ Pending"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ─── HISTORY ─── */}
            {tab === "history" && (()=>{
              const shown    = filterHistory(historyRows, historyFilter);
              const sum      = summariseHistory(historyRows);
              const tone     = { good:N.green, info:N.sky, warn:N.amber, bad:N.red };
              const toneBg   = { good:N.greenBg, info:N.navy700, warn:N.amberBg, bad:N.redBg };
              const fmt      = (t) => t ? new Date(t).toLocaleString("en-GB", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit" }) : "";
              const setF     = (patch) => setHistoryFilter(f => ({ ...f, ...patch }));
              const filtered = historyFilter.channel !== "all" || historyFilter.status !== "all" || !!historyFilter.q;
              return (
              <div className="nk-page" style={{padding:"0 0 40px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:12}}>
                  <div>
                    <div style={{fontSize:18,fontWeight:700,color:N.text}}>{eventData.username||"Event"} — History</div>
                    <div style={{fontSize:12,color:N.textDim,marginTop:2}}>
                      {savedEventId
                        ? <>Every card and SMS sent for this event, with results{sum.lastAt ? <> · last activity {fmt(sum.lastAt)}</> : null}</>
                        : "Open or save an event to see its history"}
                    </div>
                  </div>
                  {savedEventId && (
                    <div style={{display:"flex",gap:8}}>
                      <button className="nk-btn nk-btn-ghost" onClick={()=>loadHistory()} disabled={historyLoading}>
                        {historyLoading ? "⏳" : "↻"} Refresh
                      </button>
                      <button className="nk-btn nk-btn-success" onClick={downloadHistory} disabled={!shown.length}>
                        ⬇ Export (.xlsx)
                      </button>
                    </div>
                  )}
                </div>

                {!savedEventId ? (
                  <div style={{textAlign:"center",padding:60,color:N.textDim}}>
                    <div style={{fontSize:48,marginBottom:12}}>🕘</div>
                    <p>No event open. Pick one in the Events tab.</p>
                  </div>
                ) : (
                  <>
                    <div className="nk-stats" style={{marginBottom:16}}>
                      {[
                        ["Cards sent (WA)",  sum.cardsSent,  N.green],
                        ["WA problems",      sum.waProblems, N.amber],
                        ["SMS sent",         sum.smsSent,    N.teal],
                        ["SMS failed",       sum.smsFailed,  N.red],
                        ["Cards uploaded",   sum.uploads,    N.sky],
                      ].map(([l,v,c])=>(
                        <div key={l} className="nk-stat" style={{borderColor:alpha(c,"33")}}>
                          <div className="nk-stat-num" style={{color:c}}>{v}</div>
                          <div className="nk-stat-label">{l}</div>
                        </div>
                      ))}
                    </div>
                    {historyHasMore && (
                      <div style={{fontSize:11,color:N.textDim,marginBottom:10}}>
                        Counts cover the {historyRows.length} most recent entries — load older entries below for the full picture.
                      </div>
                    )}

                    {/* Filters */}
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12,alignItems:"center"}}>
                      <input className="nk-input" style={{flex:"1 1 220px",maxWidth:320}} placeholder="Search name, phone, message, user…"
                        value={historyFilter.q} onChange={e=>setF({ q:e.target.value })} />
                      <select className="nk-input" style={{width:150}} value={historyFilter.channel} onChange={e=>setF({ channel:e.target.value })}>
                        <option value="all">All channels</option>
                        {Object.entries(HISTORY_CHANNELS).map(([k,c])=><option key={k} value={k}>{c.icon} {c.label}</option>)}
                      </select>
                      <select className="nk-input" style={{width:150}} value={historyFilter.status} onChange={e=>setF({ status:e.target.value })}>
                        <option value="all">All results</option>
                        {Object.entries(HISTORY_STATUSES).map(([k,st])=><option key={k} value={k}>{st.label}</option>)}
                      </select>
                      {filtered && (
                        <button className="nk-btn nk-btn-ghost" style={{fontSize:11,padding:"6px 10px"}}
                          onClick={()=>setHistoryFilter({ channel:"all", status:"all", q:"" })}>✕ Clear</button>
                      )}
                      <span style={{fontSize:11,color:N.textDim,marginLeft:"auto"}}>
                        {shown.length}{filtered ? ` of ${historyRows.length}` : ""} entr{shown.length===1?"y":"ies"}
                      </span>
                    </div>

                    {/* Log table */}
                    <div className="nk-table-wrap">
                      <table className="nk-table">
                        <thead><tr>{["Time","Channel","Action","Recipient","Message / Template","Result","By","Detail"].map(h=><th key={h}>{h}</th>)}</tr></thead>
                        <tbody>
                          {shown.map(r => {
                            const st = HISTORY_STATUSES[r.status] || { label:r.status, tone:"info" };
                            const ch = HISTORY_CHANNELS[r.channel] || { icon:"•", label:r.channel };
                            return (
                              <tr key={r.id}>
                                <td style={{fontFamily:"JetBrains Mono, monospace",fontSize:11,color:N.textMid,whiteSpace:"nowrap"}}>{fmt(r.created_at)}</td>
                                <td style={{fontSize:12,whiteSpace:"nowrap"}}>{ch.icon} {ch.label}</td>
                                <td style={{fontSize:12,color:N.textMid,whiteSpace:"nowrap"}}>{HISTORY_ACTIONS[r.action] || r.action}</td>
                                <td>
                                  {r.recipient_name || r.recipient_phone ? (
                                    <button title="Show only this contact's history"
                                      onClick={()=>setF({ q: r.recipient_phone || r.recipient_name })}
                                      style={{background:"none",border:"none",padding:0,cursor:"pointer",textAlign:"left",color:N.text}}>
                                      <div style={{fontWeight:600,fontSize:13,whiteSpace:"nowrap"}}>{r.recipient_name || "—"}</div>
                                      {r.recipient_phone && <div style={{fontFamily:"JetBrains Mono, monospace",fontSize:11,color:N.textDim}}>+{r.recipient_phone}</div>}
                                    </button>
                                  ) : <span style={{color:N.textDim}}>—</span>}
                                </td>
                                <td style={{fontSize:12,color:N.textMid}}>{r.message_title || "—"}</td>
                                <td>
                                  <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:5,whiteSpace:"nowrap",
                                    color:tone[st.tone], background:toneBg[st.tone], border:`1px solid ${alpha(tone[st.tone],"44")}`}}>
                                    {st.label}
                                  </span>
                                </td>
                                <td style={{fontSize:11,color:N.textDim,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.user_email||""}>{r.user_email || "—"}</td>
                                <td style={{fontSize:11,color:N.textMid,maxWidth:280,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.detail||""}>{r.detail || ""}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {!shown.length && (
                        <div style={{textAlign:"center",padding:40,color:N.textDim,fontSize:13}}>
                          {historyLoading ? "Loading history…"
                            : historyRows.length ? "No entries match these filters."
                            : "Nothing recorded yet. Sends, uploads and event changes will appear here."}
                        </div>
                      )}
                    </div>
                    {historyHasMore && (
                      <button className="nk-btn nk-btn-ghost nk-btn-full" style={{marginTop:12}} onClick={()=>loadHistory(true)} disabled={historyLoading}>
                        {historyLoading ? "⏳ Loading…" : "Load older entries"}
                      </button>
                    )}
                  </>
                )}
              </div>
              );
            })()}


            {tab === "batch" && (
              <div className="nk-page" style={{padding:"0 0 40px"}}>
                <div className="nk-stats">
                  {[
                    ["Total",      records.length,  N.textMid],
                    ["WA Sent",    waSentCount,    N.green],
                    ["WA Invalid", waInvalidCount, N.amber],
                    ["SMS Sent",   smsSentCount,    N.teal],
                    ["Pending WA", records.filter(r=>r.phone&&r.waStatus===WA.idle).length, N.textDim],
                  ].map(([l,v,c])=>(
                    <div key={l} className="nk-stat" style={{borderColor:alpha(c,"33")}}>
                      <div className="nk-stat-num" style={{color:c}}>{v}</div>
                      <div className="nk-stat-label">{l}</div>
                    </div>
                  ))}
                </div>
                <div className="nk-table-wrap">
                  <table className="nk-table">
                    <thead><tr>{["#","Name","Card Type","Phone","WA Status","SMS","Actions"].map(h=><th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {records.map((rec,i)=>(
                        <RecordRow key={i} rec={rec} idx={i}
                          onEdit={editRecord} onUpload={uploadCardWithToast} onSendWa={sendWaSingle} onDownload={downloadCard}
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
                  <label className="nk-label">Font Family</label>
                  <select
                    className="nk-select"
                    value={selectedEl.fontFamily||"Plus Jakarta Sans"}
                    onChange={e=>updateEl("fontFamily",e.target.value)}
                    style={{fontFamily:`'${selectedEl.fontFamily||"Plus Jakarta Sans"}', sans-serif`,marginBottom:10}}
                  >
                    {FONT_OPTIONS.map(f=>(
                      <option key={f.value} value={f.value} style={{fontFamily:`'${f.value}', sans-serif`}}>
                        {f.label}
                      </option>
                    ))}
                  </select>
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
                        style={{flex:1,padding:"7px 0",borderRadius:8,border:`1.5px solid ${(selectedEl.align||"left")===a?N.accent:N.border}`,background:(selectedEl.align||"left")===a?alpha(N.accent,"22"):"transparent",color:(selectedEl.align||"left")===a?N.sky:N.textDim,cursor:"pointer",fontSize:16,fontFamily:"inherit"}}>
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

              {activeRecord.phone && (
                <button className="nk-btn nk-btn-success nk-btn-full" onClick={()=>sendWaSingle(activeIdx)} disabled={activeRecord.waStatus===WA.sending}>
                  {activeRecord.waStatus===WA.sending ? "⏳ Sending…" : activeRecord.waStatus===WA.sent ? "✓ WA Sent" : "📲 Send via WhatsApp"}
                </button>
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
