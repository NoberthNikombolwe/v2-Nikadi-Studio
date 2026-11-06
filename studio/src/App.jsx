import Logo from "./Logo";
import { useState, useRef, useCallback, useEffect, useId, Children, isValidElement, Fragment, createContext, useContext } from "react";
import { supabase } from "./lib/supabase";
import { normalisePhone, isValidPhone } from "./lib/phone";
import { selectRecipients, dropDuplicates, describeSkipped } from "./lib/recipients";
import { fillTemplate, normaliseSheetRows, recipientKey, applyMessageStatuses, sanitiseMessages } from "./lib/messages";
import LoginPage from "./LoginPage";
import Icon from "./Icon";
import ScanPanel from "./ScanPanel";
import { TASK_SUGGESTIONS, groupAssignments, initials, eventsAssignedTo, assignableFor, validateAssignment } from "./lib/assignments";
import { ROLES, ROLE_LABEL, MODULES, DEFAULT_MATRIX, can, visibleNav, matrixFromRows, rowsForRole, validateInvite, TAB_MODULE } from "./lib/permissions";
import { DEFAULT_SETTINGS, settingsFromRows, resolveChoice, validateTemplate, validateSenderId } from "./lib/settings";
import { peopleForCardType, peopleLabel, scanTotals, validateCardRule, scanStatus, remaining as placesLeft, filterGuests, guestCounts, cardSource } from "./lib/cardRules";
import { buildQrPayload, matchByName, SCAN_REASON, newScanCode } from "./lib/scan";
import { CALL_STATUSES, callOptions, nextCallStatus, summariseCalls, filterCalls } from "./lib/calls";
import { GUIDE_STAGES, GUIDE_STEPS, GUIDE_LINKS, stepsOfStage, guideProgress } from "./lib/guide";
import { ACCOUNT_TYPES, TXN_KINDS, TXN_CATEGORIES, validateTransaction, txnToRow, validateAccount, summariseTransactions, marginTone, formatPct,
         summariseByAccount, summariseByCategory, groupByEvent, filterTransactions, sortTransactions, transactionExportRows } from "./lib/finance";
import { N, alpha, getThemePref, applyTheme, nextThemePref } from "./lib/theme";
import { PACKAGE_OPTIONS, EVENT_TYPES, TZ_REGIONS, LEAD_STATUSES, OPEN_STATUSES, FOLLOWUP_METHODS, parsePrice, formatTsh, validateLead, validateCustomer,
         leadToRow, eventFromLead, matchCustomer, localDate, followupDue, filterLeads, sortLeads, summariseLeads } from "./lib/crm";
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
     CRM          — useCrm() + <LeadsTab>, <CustomersTab>, <LeadModal>,
                    <CustomerModal>, <EventOverview>: leads → follow-ups →
                    customers → events
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
    border-bottom: 1px solid ${N.border}; padding: 0 28px; flex-wrap: wrap; position: relative; z-index: 90;
  }
  /* Collapsed nav groups: a button whose sub-menu opens on hover, keyboard focus or tap */
  .nk-navdrop { position: relative; display: flex; }
  .nk-navdrop-caret { opacity: .6; transition: transform .15s; }
  .nk-navdrop:hover .nk-navdrop-caret, .nk-navdrop:focus-within .nk-navdrop-caret, .nk-navdrop.open .nk-navdrop-caret { transform: rotate(180deg); }
  .nk-navdrop-menu {
    position: absolute; top: 100%; left: 0; min-width: 200px; padding: 6px; z-index: 300;
    background: ${N.navy800}; border: 1px solid ${N.border}; border-radius: 12px; box-shadow: 0 12px 32px var(--nk-shadow);
    opacity: 0; visibility: hidden; transform: translateY(-4px); transition: opacity .15s, transform .15s, visibility .15s;
  }
  .nk-navdrop:hover .nk-navdrop-menu, .nk-navdrop:focus-within .nk-navdrop-menu, .nk-navdrop.open .nk-navdrop-menu {
    opacity: 1; visibility: visible; transform: translateY(0);
  }
  .nk-navdrop-item {
    width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 8px; border: none;
    background: transparent; color: ${N.textMid}; font: 600 13px 'Plus Jakarta Sans', sans-serif; cursor: pointer; text-align: left; white-space: nowrap;
  }
  .nk-navdrop-item:hover, .nk-navdrop-item:focus-visible { background: ${N.navy700}; color: ${N.text}; }
  .nk-tab {
    padding: 14px 20px; font-size: 13px; font-weight: 600;
    color: ${N.textDim}; border: none; background: none; cursor: pointer;
    border-bottom: 3px solid transparent; margin-bottom: -1px;
    transition: all 0.2s; font-family: 'Plus Jakarta Sans', sans-serif;
    display: flex; align-items: center; gap: 7px;
    white-space: nowrap; flex-shrink: 0;
  }
  .nk-tab:hover { color: ${N.text}; background: ${alpha(N.accent,"0d")}; }
  .nk-spin { animation: nkSpin 0.9s linear infinite; }
  @keyframes nkSpin { to { transform: rotate(360deg); } }
  .nk-btn .nk-icon, .nk-btn-sm .nk-icon, .nk-tab .nk-icon { width: 1.15em; height: 1.15em; }
  .nk-empty { text-align: center; padding: 48px 20px; color: ${N.textDim}; }
  .nk-empty-icon { width: 64px; height: 64px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 28px; margin-bottom: 14px; }
  .nk-empty-title { font-weight: 700; font-size: 14px; color: ${N.text}; margin-bottom: 4px; }
  .nk-empty-text { font-size: 12px; max-width: 380px; margin: 0 auto; line-height: 1.5; }
  .nk-tab-sep { width: 1px; align-self: center; height: 20px; background: ${N.border}; margin: 0 6px; flex-shrink: 0; }
  /* Keyboard users always see where focus is */
  .nk-tab:focus-visible, .nk-btn:focus-visible, .nk-stat:focus-visible, .nk-modal-close:focus-visible,
  .nk-input:focus-visible, .nk-select:focus-visible, button:focus-visible {
    outline: 2px solid ${N.accent}; outline-offset: 2px;
  }
  .nk-link { background: none; border: none; padding: 0; color: ${N.sky}; text-decoration: underline; cursor: pointer; font: inherit; }
  .nk-table th.num, .nk-table td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .nk-table tbody tr { transition: background 0.15s; }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }
  /* ── Navigation groups ── */
  .nk-tab-group { display: flex; align-items: stretch; flex-shrink: 0; }
  .nk-tab-group-label {
    align-self: center; font-size: 9px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase;
    color: ${N.textDim}; opacity: .7; padding: 0 4px 0 8px;
  }
  .nk-count { margin-left: 4px; background: ${N.red}; color: #fff; border-radius: 10px; padding: 0 6px; font-size: 10px; font-weight: 800; line-height: 16px; }
  .nk-menu-btn {
    display: none; width: 40px; height: 40px; border-radius: 10px; border: 1.5px solid ${N.border};
    background: transparent; color: ${N.text}; cursor: pointer; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0;
  }
  .nk-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; vertical-align: bottom; max-width: 100%; }
  .nk-drawer-overlay { position: fixed; inset: 0; z-index: 600; background: rgba(0,0,0,.55); animation: fadeIn .15s ease; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .nk-drawer {
    position: absolute; top: 0; bottom: 0; left: 0; width: min(320px, 86vw); background: ${N.navy800};
    border-right: 1px solid ${N.border}; display: flex; flex-direction: column; overflow-y: auto;
    padding: calc(env(safe-area-inset-top, 0px) + 14px) 12px calc(env(safe-area-inset-bottom, 0px) + 12px);
    animation: drawerIn .2s ease; box-shadow: 8px 0 40px var(--nk-shadow);
  }
  @keyframes drawerIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }
  .nk-drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 0 4px 12px; }
  .nk-drawer-event { display: flex; align-items: center; gap: 8px; font-size: 12px; color: ${N.textMid}; background: ${N.navy700}; border: 1px solid ${N.border}; border-radius: 10px; padding: 8px 10px; margin: 0 4px 8px; min-width: 0; }
  .nk-drawer-group { padding: 6px 0; border-bottom: 1px solid ${N.border}; }
  .nk-drawer-label { font-size: 10px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; color: ${N.textDim}; padding: 8px 12px 4px; }
  .nk-drawer-item {
    width: 100%; display: flex; align-items: center; gap: 12px; padding: 11px 12px; min-height: 44px; border-radius: 10px;
    border: none; background: transparent; color: ${N.textMid}; font: 600 14px 'Plus Jakarta Sans', sans-serif; cursor: pointer; text-align: left;
  }
  .nk-drawer-item:hover { background: ${N.navy700}; color: ${N.text}; }
  .nk-drawer-item.active { background: ${alpha(N.accent,"1f")}; color: ${N.sky}; }
  .nk-drawer-foot { margin-top: auto; padding-top: 8px; }
  .nk-span2 { grid-column: span 2; }
  .nk-avatars { display: inline-flex; align-items: center; }
  .nk-avatar {
    width: 28px; height: 28px; border-radius: 50%; display: inline-grid; place-items: center; flex-shrink: 0;
    font-size: 10px; font-weight: 800; color: ${N.sky}; background: ${alpha(N.sky,"1f")};
    border: 2px solid ${N.navy800}; margin-left: -6px; letter-spacing: .3px;
  }
  .nk-avatars .nk-avatar:first-child { margin-left: 0; }
  .nk-avatar-more { color: ${N.textMid}; background: ${N.navy700}; }
  /* ── No-access screen ── */
  .nk-noaccess {
    min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
    padding: calc(env(safe-area-inset-top, 0px) + 24px) 16px calc(env(safe-area-inset-bottom, 0px) + 24px);
    background: radial-gradient(ellipse at top, ${alpha(N.accent,"22")}, transparent 60%), ${N.navy900};
  }
  .nk-noaccess-card {
    width: 100%; max-width: 480px; background: ${N.navy800}; border: 1px solid ${N.border}; border-radius: 20px;
    padding: 28px; box-shadow: 0 24px 64px var(--nk-shadow); text-align: center; animation: modalIn .25s ease;
  }
  .nk-noaccess-brand { display: flex; align-items: center; justify-content: center; gap: 10px; text-align: left; margin-bottom: 24px; }
  .nk-noaccess-lock {
    width: 72px; height: 72px; margin: 0 auto 14px; border-radius: 50%; display: grid; place-items: center; font-size: 32px;
    color: ${N.amber}; background: ${alpha(N.amber,"1a")}; box-shadow: 0 0 0 8px ${alpha(N.amber,"0d")};
  }
  .nk-noaccess-title { font-size: 22px; font-weight: 800; color: ${N.text}; margin-bottom: 8px; }
  .nk-noaccess-lead { font-size: 14px; color: ${N.textMid}; line-height: 1.55; max-width: 380px; margin: 0 auto 20px; }
  .nk-noaccess-account {
    display: flex; align-items: center; gap: 12px; text-align: left; padding: 12px; margin-bottom: 20px;
    background: ${N.navy700}; border: 1px solid ${N.border}; border-radius: 14px;
  }
  .nk-noaccess-avatar { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
  .nk-noaccess-avatar-empty { display: grid; place-items: center; background: ${N.navy600}; color: ${N.textMid}; font-size: 18px; }
  .nk-noaccess-steps { list-style: none; text-align: left; display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
  .nk-noaccess-steps li { display: flex; gap: 12px; align-items: flex-start; }
  .nk-noaccess-step-no {
    width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0; display: grid; place-items: center;
    font-size: 12px; font-weight: 800; color: ${N.sky}; background: ${alpha(N.sky,"1a")}; border: 1px solid ${alpha(N.sky,"44")};
  }
  .nk-noaccess-step-title { font-weight: 700; font-size: 13px; color: ${N.text}; display: flex; align-items: center; gap: 6px; }
  .nk-noaccess-step-text { font-size: 12px; color: ${N.textDim}; margin-top: 2px; line-height: 1.45; }
  .nk-noaccess-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
  .nk-noaccess-actions .nk-btn { flex: 1 1 180px; min-height: 44px; }
  .nk-noaccess-foot { font-size: 12px; color: ${N.textDim}; text-align: center; max-width: 420px; }
  @media (max-width: 480px) { .nk-noaccess-card { padding: 22px 18px; border-radius: 16px; } .nk-noaccess-title { font-size: 19px; } }
  /* ── Guide ── */
  .nk-guide-progress { background: ${N.navy800}; border: 1px solid ${N.border}; border-radius: 14px; padding: 16px 18px; margin-bottom: 18px; display: flex; flex-direction: column; gap: 10px; }
  .nk-guide-bar { height: 8px; border-radius: 4px; background: ${N.navy700}; overflow: hidden; }
  .nk-guide-bar > div { height: 100%; border-radius: 4px; background: linear-gradient(90deg, ${N.accent}, ${N.green}); transition: width .6s ease; }
  .nk-guide-map { display: flex; align-items: stretch; gap: 0; margin-bottom: 18px; }
  .nk-guide-stage-wrap { display: flex; align-items: stretch; flex: 1 1 0; min-width: 0; }
  .nk-guide-stage { flex: 1; min-width: 0; background: ${N.navy800}; border: 1px solid ${N.border}; border-top: 3px solid var(--c); border-radius: 14px; padding: 14px; }
  .nk-guide-stage-head { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 12px; min-height: 52px; }
  .nk-guide-stage-no { width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0; display: grid; place-items: center; font-weight: 800; font-size: 12px; color: #fff; background: var(--c); }
  .nk-guide-stage-title { font-weight: 800; font-size: 14px; color: ${N.text}; }
  .nk-guide-stage-blurb { font-size: 11px; color: ${N.textDim}; line-height: 1.4; margin-top: 2px; }
  .nk-guide-arrow { display: grid; place-items: center; padding: 0 6px; color: ${N.textDim}; font-size: 18px; flex-shrink: 0; }
  .nk-guide-step {
    display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; cursor: pointer; font-family: inherit;
    background: ${N.navy700}; border: 1px solid ${N.border}; border-radius: 10px; padding: 10px; color: ${N.text};
    transition: transform .15s, border-color .15s, box-shadow .15s;
  }
  .nk-guide-step:hover { transform: translateY(-2px); border-color: var(--c); box-shadow: 0 6px 18px var(--nk-shadow); }
  .nk-guide-step.is-next { border-color: var(--c); box-shadow: 0 0 0 3px ${alpha(N.accent,"22")}; }
  .nk-guide-num { width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0; display: grid; place-items: center; font-size: 11px; font-weight: 800; border: 1.5px solid ${N.border}; color: ${N.textMid}; }
  .nk-guide-ico { color: var(--c); font-size: 16px; display: grid; place-items: center; flex-shrink: 0; }
  .nk-guide-title { display: block; font-weight: 700; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nk-guide-where { display: block; font-size: 11px; color: ${N.textDim}; }
  .nk-guide-links { background: ${N.navy800}; border: 1px solid ${N.border}; border-radius: 14px; padding: 16px 18px; }
  .nk-guide-links-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px; }
  .nk-guide-link { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .nk-guide-node { padding: 5px 10px; border-radius: 8px; background: ${N.navy700}; border: 1px solid ${N.border}; font-size: 12px; font-weight: 700; color: ${N.text}; white-space: nowrap; }
  .nk-guide-edge { flex: 1; display: flex; align-items: center; gap: 4px; color: ${N.textDim}; font-size: 11px; min-width: 0; }
  .nk-guide-edge > span { flex: 1; text-align: center; border-bottom: 1px dashed ${N.border}; padding-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nk-guide-block { background: ${N.navy700}; border: 1px solid ${N.border}; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; font-size: 13px; color: ${N.textMid}; line-height: 1.55; }
  .nk-guide-block-label { font-size: 10px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: ${N.textDim}; margin-bottom: 4px; }
  .nk-guide-welcome { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .nk-guide-welcome-item { display: flex; gap: 10px; align-items: flex-start; padding: 12px; border-radius: 12px; background: ${N.navy700}; border: 1px solid ${N.border}; border-left: 3px solid var(--c); }
  @media (max-width: 1100px) {
    .nk-guide-map { flex-direction: column; }
    .nk-guide-stage-wrap { flex-direction: column; }
    .nk-guide-arrow { padding: 6px 0; transform: rotate(90deg); }
    .nk-guide-stage-head { min-height: 0; }
  }
  @media (max-width: 640px) { .nk-guide-welcome { grid-template-columns: 1fr; } .nk-guide-links-grid { grid-template-columns: 1fr; } }
  .nk-overlay.nk-raise { z-index: 550; }
  .nk-overlay.nk-top { z-index: 700; }
  .nk-detail { position: relative; }
  .nk-detail-close { position: absolute; top: 16px; right: 16px; z-index: 2; background: ${N.navy800}; }
  .nk-detail-body { padding: 24px 28px 28px; }
  .nk-detail-body > div:first-child { padding-right: 44px; }
  @media (max-width: 640px) { .nk-detail-body { padding: 18px 16px 22px; } .nk-detail-close { top: 12px; right: 12px; } }
  .nk-table-wrap { overflow-x: auto !important; -webkit-overflow-scrolling: touch; }

  /* ── Large tablets / small laptops ── */
  @media (max-width: 1200px) {
    .nk-hide-lg { display: none !important; }
    .nk-tab { padding: 14px 12px; }
    .nk-tab-group-label { display: none; }
  }
  /* ── Tablets: drawer navigation, stacked layouts ── */
  @media (max-width: 900px) {
    .nk-hide-md { display: none !important; }
    .nk-menu-btn { display: inline-flex; }
    .nk-tabs { display: none; }
    .nk-header { padding: 0 14px; gap: 10px; height: 58px; }
    .nk-header-actions { gap: 8px; }
    .nk-body { flex-direction: column; overflow: visible; }
    .nk-sidebar, .nk-sidebar-right { width: 100%; min-width: 0; border-right: none; border-left: none; border-bottom: 1px solid ${N.border}; overflow: visible; }
    .nk-main, .nk-main-wide { padding: 18px 14px; overflow: visible; }
    .nk-split > *:not(.nk-overlay) { flex: 1 1 100% !important; max-width: 100% !important; position: static !important; max-height: none !important; min-width: 0; }
    .nk-banner { margin: 10px 14px 0 !important; }
    .nk-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
    .nk-stat { min-width: 0; padding: 12px; }
  }
  /* ── Phones ── */
  @media (max-width: 640px) {
    .nk-btn-label { display: none; }
    .nk-header .nk-btn { padding: 0; width: 40px; }
    .nk-logo-name { font-size: 16px; }
    .nk-btn { min-height: 40px; }
    .nk-form-grid { grid-template-columns: 1fr; }
    .nk-span2 { grid-column: auto; }
    .nk-overlay { padding: 0; align-items: flex-end; }
    .nk-modal { max-width: 100% !important; max-height: 94vh; border-radius: 18px 18px 0 0; padding-bottom: env(safe-area-inset-bottom, 0px); }
    .nk-modal-head { padding: 18px 18px 0; margin-bottom: 14px; }
    .nk-modal-body { padding: 0 18px 18px; }
    .nk-modal-foot { padding: 0 18px 18px; flex-wrap: wrap; }
    .nk-modal-foot .nk-btn, .nk-dialog-actions .nk-btn { flex: 1 1 auto; }
    .nk-stats { grid-template-columns: 1fr 1fr; gap: 8px; }
    .nk-stat-num { font-size: 18px !important; }
    .nk-table td, .nk-table thead th { padding: 9px 10px; }
    .nk-activity { left: 12px; right: 12px; bottom: 12px; width: auto; max-width: none; }
    .nk-page h2 { font-size: 18px !important; }
    input, select, textarea { font-size: 16px !important; }   /* stops iOS zooming into fields */
  }
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
  /* One line per cell: long text is cut with "…" (full text on hover), never wrapped */
  .nk-table th, .nk-table td { white-space: nowrap; }
  .nk-table td { max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
  .nk-table td > div, .nk-table td > span:not(.nk-badge) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .nk-table td > div[style*="flex"] { overflow: visible; }
  .nk-table td:has(.nk-btn-sm), .nk-table td:has(input), .nk-table td:has(select) { max-width: none; overflow: visible; }
  .nk-table thead th { position: sticky; top: 0; z-index: 1; }
  .nk-table tbody tr:nth-child(even) { background: ${alpha(N.navy700,"22")}; }
  /* Row actions: icons only inside tables (name in tooltip + aria-label) */
  .nk-table .nk-btn-sm.has-icon .nk-sb-label { display: none; }
  .nk-table .nk-btn-sm { height: 30px; border-radius: 8px; }
  .nk-table .nk-btn-sm.has-icon, .nk-table .nk-btn-sm.icon-only { width: 30px; padding: 0; justify-content: center; font-size: 14px; }
  .nk-table .nk-btn-sm:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.15); }
  .nk-row-actions { display: flex; gap: 6px; flex-wrap: nowrap; align-items: center; }

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
// Columns the event form may write (persistEvent sends only these). The CRM links are only
// present once supabase-schema.sql has added them, so they are sent only when the form has them.
const EVENT_FORM_FIELDS     = [...Object.keys(BLANK_EVENT), "customer_id", "package_price", "region"];
const NULLABLE_EVENT_FIELDS = ["customer_id", "package_price", "region"];   // "" → NULL (uuid / numeric columns)
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
          const qrData = buildQrPayload(record || {});
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
  const qrData = buildQrPayload(record || {});
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
    idle:    { cls:"badge-idle",    icon:"circle", label:"Not Sent", extra:{} },
    sending: { cls:"badge-testing", icon:"loader", label:"Sending…", extra:{} },
    sent:    { cls:"badge-sent",    icon:"check", label:"Sent",     extra:{} },
    notSent: { cls:"badge-no",      icon:"xCircle", label:"Not Sent", extra:{background:N.redBg,color:N.red,border:`1px solid ${alpha(N.red,"44")}`} },
    invalid: { cls:"badge-testing", icon:"alert", label:"Invalid",  extra:{background:N.amberBg,color:N.amber,border:`1px solid ${alpha(N.amber,"44")}`} },
  };
  const { cls, icon, label, extra } = styles[status] || styles.idle;
  return <span className={`nk-badge ${cls}`} style={extra}><Icon n={icon} /> {label}</span>;
}

// Compact icon-style action button used inside table rows (WA/SMS/download/edit actions)
// Its text is wrapped in .nk-sb-label, which tables hide (icon-only buttons there), and
// the text + `title` become the tooltip and accessible name so the action is always described.
function Sb({ bg, col, border, children, onClick, title, disabled, label }) {
  const icons = [], text = [];
  const walk = (node) => Children.toArray(node).forEach(c => {
    if (isValidElement(c) && c.type === Fragment) walk(c.props.children);
    else if (isValidElement(c) && c.type === Icon) icons.push(c);
    else text.push(c);
  });
  walk(children);
  const plain = (n) => Children.toArray(n).map(c => typeof c === "string" || typeof c === "number" ? c : isValidElement(c) ? plain(c.props.children) : "").join("");
  const name = (label || plain(text)).trim();
  const tip  = name && title && title !== name ? `${name} — ${title}` : (name || title);
  const hasText = text.some(c => typeof c !== "string" || c.trim());
  return (
    <button type="button" className={`nk-btn-sm${icons.length ? (hasText ? " has-icon" : " icon-only") : ""}`} onClick={onClick} title={tip} aria-label={tip} disabled={disabled}
      style={{ background:bg, color:col, borderColor:border||alpha(col,"44"), opacity:disabled?0.5:1 }}>
      {icons}
      {hasText && <span className="nk-sb-label">{text}</span>}
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
            <Sb bg={N.greenBg} col={N.green} onClick={save} label="Save phone number"><Icon n="check" /></Sb>
            <Sb bg={N.redBg} col={N.red} onClick={()=>setEditing(false)} label="Cancel editing"><Icon n="x" /></Sb>
          </span>
        ) : (
          <span className="nk-phone-val">
            {rec.phone||<span style={{color:N.textDim}}>—</span>}
            <Sb bg="transparent" col={N.textDim} border={N.border} onClick={startEdit} label="Edit phone number"><Icon n="edit" /></Sb>
          </span>
        )}
      </td>
      <td><WaBadge status={rec.waStatus||WA.idle} reason={rec.waReason} /></td>
      <td>
        <span className={`nk-badge ${rec.smsStatus===SMS.delivered?"badge-yes":rec.smsStatus===SMS.sent?"badge-sent":rec.smsStatus===SMS.failed?"badge-no":"badge-idle"}`}>
          {rec.smsStatus===SMS.delivered?<><Icon n="check" /> Delivered</>:rec.smsStatus===SMS.sent?<><Icon n="arrowUp" /> Sent</>:rec.smsStatus===SMS.failed?<><Icon n="xCircle" /> Failed</>:<><Icon n="circle" /> Pending</>}
        </span>
      </td>
      <td>
        <div className="nk-row-actions">
          {!rec.phone && <Sb bg={N.redBg} col={N.red} onClick={startEdit} label="Add phone number"><Icon n="plus" /> Add number</Sb>}
          <Sb bg={rec.uploadStatus==="uploaded"?N.greenBg:N.navy600} col={rec.uploadStatus==="uploaded"?N.green:N.sky}
            title={rec.uploadStatus==="uploaded"?"Card uploaded — click to re-upload":"Upload card to Supabase Storage"}
            onClick={()=>onUpload(idx)} disabled={rec.uploadStatus==="uploading"} label={rec.uploadStatus==="uploaded" ? "Re-upload card" : "Upload card"}>
            {rec.uploadStatus==="uploading"?<><Icon n="loader" /></>:rec.uploadStatus==="uploaded"?<><Icon n="check" /></>:<><Icon n="cloud" /></>} Upload
          </Sb>
          {rec.phone && <Sb bg={N.greenBg} col={N.green} onClick={()=>onSendWa(idx)} disabled={rec.waStatus===WA.sending} label="Send card on WhatsApp">
            {rec.waStatus===WA.sending?<><Icon n="loader" /></>:<><Icon n="whatsapp" /></>} WA
          </Sb>}
          {rec.phone && <Sb bg={N.tealBg} col={N.teal} border={alpha(N.teal,"44")} onClick={()=>onSendSms(idx)} label="Send SMS"><Icon n="sms" /> SMS</Sb>}
          <Sb bg={N.navy600} col={N.sky} border={alpha(N.sky,"44")} onClick={()=>onDownload(idx)} label="Download card as PNG"><Icon n="download" /> PNG</Sb>
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
function EventModal({ initial, onSave, onClose, saving, customers = [] }) {
  const [form, setForm] = useState({ ...BLANK_EVENT, ...initial });
  const [priceError, setPriceError] = useState(null);
  // Returns a field-specific onChange handler that writes one key into the form state
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  // The package price is picked/typed as text and saved as a number (or NULL); untouched
  // CRM fields are left out so the form still works before the CRM columns exist
  const save = () => {
    if (!("package_price" in form)) { onSave(form); return; }
    const price = parsePrice(form.package_price);
    if (Number.isNaN(price) || (price !== null && price <= 0)) { setPriceError("Enter a price like 1000 or 1.2k"); return; }
    onSave({ ...form, package_price: price });
  };
  return (
    <div className="nk-overlay">
      <div className="nk-modal">
        <div className="nk-modal-head">
          <div className="nk-modal-title">{initial?.id ? "Edit Event" : "New Event"}</div>
          <button className="nk-modal-close" onClick={onClose} aria-label="Close" title="Close"><Icon n="x" /></button>
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
                {EVENT_TYPES.map(t => <option key={t}>{t}</option>)}
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
            {customers.length > 0 && (
              <div>
                <label className="nk-label">Customer</label>
                <select className="nk-select" value={form.customer_id || ""} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value || null }))}>
                  <option value="">— None —</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · +${c.phone}` : ""}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="nk-label">Region</label>
              <RegionInput value={form.region} onChange={set("region")} />
            </div>
            <div style={{ gridColumn:"span 2" }}>
              <label className="nk-label">Package (TSh)</label>
              <PackagePicker value={form.package_price == null ? "" : String(form.package_price)}
                onChange={v => { setPriceError(null); setForm(f => ({ ...f, package_price: v })); }} />
              {priceError && <div style={{fontSize:11,color:N.red,marginTop:-6,marginBottom:8}}>{priceError}</div>}
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
          <button className="nk-btn nk-btn-primary" onClick={save} disabled={saving||!form.username}>
            {saving ? <><Icon n="loader" /> Saving…</> : <><Icon n="save" /> Save Event</>}
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

// status → [icon name, colour] for each log's rows; anything not listed is still in progress (spinner)
const LOG_STYLES = {
  upload: { uploaded:["check",N.green], failed:["xCircle",N.red] },
  wa:     { sent:["check",N.green], invalid:["alert",N.amber], "not sent":["xCircle",N.red] },
  sms:    { delivered:["checks",N.green], sent:["arrowUp",N.teal], failed:["xCircle",N.red] },
};

// One titled list of activity-log rows inside the floating panel; renders nothing when empty
function LogSection({ title, color, styles, log, onClose }) {
  if (!log.length) return null;
  return (
    <div className="nk-log">
      <div className="nk-activity-head">
        <span className="nk-sec" style={{color,margin:0}}>{title}</span>
        <button className="nk-activity-close" onClick={onClose} title="Dismiss" aria-label={`Dismiss ${title}`}><Icon n="x" /></button>
      </div>
      {log.map((x,i) => {
        const [icon, col] = styles[x.status] || ["loader", N.textMid];
        return (
          <div key={i} className="nk-log-row" style={{color:col}}>
            <span><Icon n={icon} /></span>
            <span>{x.name}</span>
            <span style={{fontSize:11,color:N.textDim,textTransform:"capitalize"}}>{x.status}</span>
          </div>
        );
      })}
    </div>
  );
}

const DEFAULT_SMS_MESSAGE = "Habari {name}, kadi yako ya {cardType} ipo tayari. Imepakiwa na Nikadi Studio. Asante!";
// Main navigation, in groups. eventOnly groups work on one event, so they only appear once an event is open.
// Main navigation, in groups (tab bar on wide screens, drawer on phones / tablets)
const NAV_GROUPS = [
  { label:"Sales",   icon:"target", items:[{ id:"events", label:"Events", icon:"folder" }, { id:"leads", label:"Leads", icon:"target" }, { id:"customers", label:"Customers", icon:"users" }] },
  { label:"Studio",  icon:"palette", eventOnly:true, items:[{ id:"design", label:"Design", icon:"palette" }, { id:"vcard", label:"VCard", icon:"contact" }, { id:"sms", label:"SMS", icon:"sms" },
                            { id:"whatsapp", label:"WhatsApp", icon:"whatsapp" }, { id:"batch", label:"Batch & Send", icon:"table" }] },
  { label:"Insight", icon:"chart", eventOnly:true, items:[{ id:"reports", label:"Reports", icon:"report" }, { id:"history", label:"History", icon:"history" }] },
  { label:"Guests",  icon:"users", eventOnly:true, items:[{ id:"calls", label:"Calls", icon:"phone" }, { id:"scanner", label:"Scanner", icon:"scan" }] },
  { label:"Money",   items:[{ id:"finance", label:"Finance", icon:"wallet" }] },
  { label:"Admin",   items:[{ id:"settings", label:"Settings", icon:"settings" }] },
  { label:"Help",    items:[{ id:"guide", label:"Guide", icon:"map" }] },
];
const THEME_LABELS = { system:"System", light:"Light", dark:"Dark" };
const THEME_ICONS  = { system:"monitor", light:"sun", dark:"moon" };

// Id of an event's main SMS message (events.sms_message, statuses in event_cards.sms_status).
// Extra messages (events.sms_messages) use random ids — see src/lib/messages.js.
const MAIN_MSG = "main";

/* ══════════════════════════════════════════════════════════════════════════
   CRM — leads, follow-ups, customers and the event overview
   Pure helpers (validation, prices, sorting, due dates) are in src/lib/crm.js.
   useCrm() owns the CRM data and actions; <LeadsTab>, <CustomersTab>, <LeadModal>,
   <CustomerModal> and <EventOverview> render it. Tables: leads, lead_followups,
   customers, plus events.customer_id / lead_id (supabase-schema.sql).
══════════════════════════════════════════════════════════════════════════ */
const CRM_LIMIT = 1000;   // leads / customers loaded per list (newest first)
const TONE    = { good:N.green,   info:N.sky,     warn:N.amber,   bad:N.red };
const TONE_BG = { good:N.greenBg, info:N.navy700, warn:N.amberBg, bad:N.redBg };
const DUE_LABEL = { overdue:["Overdue","bad"], today:["Today","warn"], soon:["Soon","info"] };
const BLANK_LEAD     = { name:"", phone:"", event_type:"", event_date:"", package_price:"", region:"", venue:"", description:"" };
const BLANK_CUSTOMER = { name:"", phone:"", region:"", notes:"" };

// Formats a DATE ("2026-12-20", read as a local day) or a timestamp as "20 Dec 2026"
const fmtDay = (d) => {
  if (!d) return "—";
  const x = new Date(String(d).length === 10 ? `${d}T00:00:00` : d);
  return Number.isNaN(x.getTime()) ? "—" : x.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
};
const fmtWhen    = (d) => d ? new Date(d).toLocaleString("en-GB", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }) : "";
const phoneLabel = (p) => p ? `+${normalisePhone(p)}` : "—";
const addDays    = (n) => localDate(new Date(Date.now() + n * 86400000));
const errMsg     = (e) => e?.message || String(e);

// The one empty / loading / error placeholder used across tabs: an icon in a soft circle,
// a title, a line of help and (optionally) the next action. `loading` shows a spinner;
// `compact` fits inside a card or panel.
function EmptyState({ icon = "inbox", title, text, action, loading, tone = "info", compact }) {
  const col = loading ? N.sky : TONE[tone];
  return (
    <div className="nk-empty" style={compact ? { padding:"18px 8px" } : undefined} role={loading ? "status" : undefined}>
      <div className="nk-empty-icon" style={{color:col,background:alpha(col,"1a"),...(compact ? { width:44, height:44, fontSize:20 } : {})}}>
        <Icon n={loading ? "loader" : icon} />
      </div>
      {title && <div className="nk-empty-title">{title}</div>}
      {text && <div className="nk-empty-text">{text}</div>}
      {action && <div style={{marginTop:14,display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>{action}</div>}
    </div>
  );
}

// Small coloured status label
function Pill({ tone = "info", children }) {
  return (
    <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:5,whiteSpace:"nowrap",
      color:TONE[tone], background:TONE_BG[tone], border:`1px solid ${alpha(TONE[tone],"44")}`}}>
      {children}
    </span>
  );
}

// A lead's stage as a coloured label
const LeadStatus = ({ status }) => <Pill tone={LEAD_STATUSES[status]?.tone}>{LEAD_STATUSES[status]?.label || status}</Pill>;

// Next follow-up date with an Overdue / Today / Soon label (labels only for open leads)
function DueTag({ date, open = true }) {
  if (!date) return <span style={{color:N.textDim,fontSize:12}}>—</span>;
  const [label, tone] = (open && DUE_LABEL[followupDue(date)]) || [];
  return (
    <span style={{display:"inline-flex",gap:6,alignItems:"center",fontSize:12,color:N.textMid,whiteSpace:"nowrap"}}>
      {fmtDay(date)}{label && <Pill tone={tone}>{label}</Pill>}
    </span>
  );
}

// Form field: label, the input, and an error line under it
function Field({ label, error, span, children }) {
  return (
    <div className={span ? "nk-span2" : undefined}>
      <label className="nk-label">{label}</label>
      {children}
      {error && <div style={{fontSize:11,color:N.red,marginTop:-6,marginBottom:8}}>{error}</div>}
    </div>
  );
}

// Region text box that suggests Tanzania's regions but accepts anything
function RegionInput({ value, onChange }) {
  const id = useId();
  return (
    <>
      <input className="nk-input" list={id} placeholder="e.g. Dar es Salaam" value={value ?? ""} onChange={onChange} />
      <datalist id={id}>{TZ_REGIONS.map(r => <option key={r} value={r} />)}</datalist>
    </>
  );
}

// Package price chooser: the preset prices (800 / 1k / 1.2k / 1.5k) or "Other price" with a typed amount.
// `value` is what the user picked or typed (string); clicking the selected preset clears it.
function PackagePicker({ value, onChange }) {
  const current = parsePrice(value);
  const [custom, setCustom] = useState(value !== "" && value != null && !PACKAGE_OPTIONS.includes(current));
  const chip = (on) => ({
    padding:"6px 12px", borderRadius:7, fontSize:12, fontWeight:700, cursor:"pointer",
    background: on ? N.tealBg : N.navy700, color: on ? N.teal : N.textMid, border:`1.5px solid ${on ? N.teal : N.border}`,
  });
  return (
    <div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
        {PACKAGE_OPTIONS.map(p => {
          const on = !custom && current === p;
          return (
            <button type="button" key={p} style={chip(on)} title={formatTsh(p)}
              onClick={() => { setCustom(false); onChange(on ? "" : String(p)); }}>
              {p >= 1000 ? `${p / 1000}k` : p}
            </button>
          );
        })}
        <button type="button" style={chip(custom)}
          onClick={() => { setCustom(true); if (PACKAGE_OPTIONS.includes(current)) onChange(""); }}>
          <Icon n="plus" /> Other price
        </button>
      </div>
      {custom && (
        <input className="nk-input" autoFocus placeholder="Amount in TSh, e.g. 2000 or 2.5k"
          value={value ?? ""} onChange={e => onChange(e.target.value)} />
      )}
    </div>
  );
}

// Create / edit a lead. Validates with validateLead before calling onSave(form).
function LeadModal({ initial, onSave, onClose, saving }) {
  const [form, setForm] = useState(() =>
    Object.fromEntries(Object.keys(BLANK_LEAD).map(k => [k, initial?.[k] == null ? "" : String(initial[k])])));
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const save = () => {
    const errs = validateLead(form);
    setErrors(errs);
    if (!Object.keys(errs).length) onSave(form);
  };
  return (
    <div className="nk-overlay">
      <div className="nk-modal">
        <div className="nk-modal-head">
          <div className="nk-modal-title">{initial?.id ? "Edit Lead" : "New Lead"}</div>
          <button className="nk-modal-close" onClick={onClose} aria-label="Close" title="Close"><Icon n="x" /></button>
        </div>
        <div className="nk-modal-body">
          <div className="nk-form-grid">
            <Field label="Name *" error={errors.name}>
              <input className="nk-input" autoFocus placeholder="e.g. Amina Said" value={form.name} onChange={set("name")} />
            </Field>
            <Field label="Phone Number *" error={errors.phone}>
              <input className="nk-input" placeholder="0712 345 678" value={form.phone} onChange={set("phone")} />
            </Field>
            <Field label="Event Type">
              <select className="nk-select" value={form.event_type} onChange={set("event_type")}>
                <option value="">— Select —</option>
                {EVENT_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Event Date" error={errors.event_date}>
              <input type="date" className="nk-input" value={form.event_date} onChange={set("event_date")} />
            </Field>
            <Field label="Package (TSh)" error={errors.package_price} span>
              <PackagePicker value={form.package_price} onChange={v => setForm(f => ({ ...f, package_price: v }))} />
            </Field>
            <Field label="Region">
              <RegionInput value={form.region} onChange={set("region")} />
            </Field>
            <Field label="Venue">
              <input className="nk-input" placeholder="Hall / Hotel" value={form.venue} onChange={set("venue")} />
            </Field>
            <Field label="Description" span>
              <textarea className="nk-input nk-textarea" rows={3} placeholder="Guests expected, card style, budget, how they found us…"
                value={form.description} onChange={set("description")} />
            </Field>
          </div>
        </div>
        <div className="nk-modal-foot">
          <button className="nk-btn nk-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="nk-btn nk-btn-primary" onClick={save} disabled={saving}>{saving ? <><Icon n="loader" /> Saving…</> : <><Icon n="save" /> Save Lead</>}</button>
        </div>
      </div>
    </div>
  );
}

// Create / edit a customer (name required; phone optional but must be valid)
function CustomerModal({ initial, onSave, onClose, saving }) {
  const [form, setForm] = useState(() =>
    Object.fromEntries(Object.keys(BLANK_CUSTOMER).map(k => [k, initial?.[k] == null ? "" : String(initial[k])])));
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const save = () => {
    const errs = validateCustomer(form);
    setErrors(errs);
    if (!Object.keys(errs).length) onSave(form);
  };
  return (
    <div className="nk-overlay">
      <div className="nk-modal" style={{maxWidth:520}}>
        <div className="nk-modal-head">
          <div className="nk-modal-title">{initial?.id ? "Edit Customer" : "New Customer"}</div>
          <button className="nk-modal-close" onClick={onClose} aria-label="Close" title="Close"><Icon n="x" /></button>
        </div>
        <div className="nk-modal-body">
          <div className="nk-form-grid">
            <Field label="Name *" error={errors.name}>
              <input className="nk-input" autoFocus value={form.name} onChange={set("name")} />
            </Field>
            <Field label="Phone Number" error={errors.phone}>
              <input className="nk-input" placeholder="0712 345 678" value={form.phone} onChange={set("phone")} />
            </Field>
            <Field label="Region" span>
              <RegionInput value={form.region} onChange={set("region")} />
            </Field>
            <Field label="Notes" span>
              <textarea className="nk-input nk-textarea" rows={3} value={form.notes} onChange={set("notes")} />
            </Field>
          </div>
        </div>
        <div className="nk-modal-foot">
          <button className="nk-btn nk-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="nk-btn nk-btn-primary" onClick={save} disabled={saving}>{saving ? <><Icon n="loader" /> Saving…</> : <><Icon n="save" /> Save Customer</>}</button>
        </div>
      </div>
    </div>
  );
}

// CRM data and actions, used by the Leads / Customers tabs, the Events table and the
// event overview. Lists load once per sign-in (loadAll); follow-ups load per lead.
// Every write updates local state from the row the database returns.
// Without the CRM tables `error` holds the database message so the tabs can explain.
function useCrm({ enabled, showToast, askDialog, logHistory, reloadEvents }) {
  const [leads,       setLeads]       = useState([]);
  const [customers,   setCustomers]   = useState([]);
  const [eventCounts, setEventCounts] = useState({});   // customer id → number of events
  const [followups,   setFollowups]   = useState({});   // lead id → follow-ups, newest first
  const [loading,     setLoading]     = useState(false);
  const [busy,        setBusy]        = useState(false); // a write is in progress
  const [error,       setError]       = useState(null);
  const fail = (what, err) => { showToast(`${what}: ${errMsg(err)}`, "warn"); return null; };
  const putLead = (row) => setLeads(ls => ls.some(l => l.id === row.id) ? ls.map(l => l.id === row.id ? row : l) : [row, ...ls]);
  const putCustomer = (row) => setCustomers(cs => cs.some(c => c.id === row.id) ? cs.map(c => c.id === row.id ? row : c) : [row, ...cs]);

  // Number of events per customer (for the Customers list)
  const loadEventCounts = async () => {
    if (!supabase || !enabled) return;
    const { data, error: e } = await supabase.from("events").select("customer_id").not("customer_id", "is", null);
    if (e) return;
    const counts = {};
    data.forEach(r => { counts[r.customer_id] = (counts[r.customer_id] || 0) + 1; });
    setEventCounts(counts);
  };

  // Loads the newest CRM_LIMIT leads and customers
  const loadAll = async () => {
    if (!supabase || !enabled) return;
    setLoading(true);
    const [l, c] = await Promise.all([
      supabase.from("leads").select("*").order("created_at", { ascending:false }).limit(CRM_LIMIT),
      supabase.from("customers").select("*").order("created_at", { ascending:false }).limit(CRM_LIMIT),
    ]);
    setLoading(false);
    const e = l.error || c.error;
    if (e) { setError(e.message); return; }
    setError(null);
    setLeads(l.data);
    setCustomers(c.data);
    loadEventCounts();
  };

  const loadFollowups = async (leadId) => {
    if (!supabase || !leadId) return;
    const { data, error: e } = await supabase.from("lead_followups").select("*").eq("lead_id", leadId).order("created_at", { ascending:false });
    if (e) { fail("Could not load follow-ups", e); return; }
    setFollowups(f => ({ ...f, [leadId]: data }));
  };

  // Creates (no id) or updates a lead from the lead form; resolves to the saved row or null
  const saveLead = async (form, id) => {
    setBusy(true);
    const q = id ? supabase.from("leads").update(leadToRow(form)).eq("id", id) : supabase.from("leads").insert([leadToRow(form)]);
    const { data, error: e } = await q.select().single();
    setBusy(false);
    if (e) return fail("Could not save lead", e);
    putLead(data);
    showToast(id ? "Lead updated" : `Lead "${data.name}" added`, "success");
    return data;
  };

  const deleteLead = async (lead) => {
    const n = followups[lead.id]?.length;
    const ok = await askDialog({
      title: `Delete lead "${lead.name}"?`,
      body: `This permanently removes the lead${n ? ` and its ${n} follow-up${n === 1 ? "" : "s"}` : " and its follow-ups"}. ${lead.status === "qualified" ? "The customer and event it created are kept." : ""}`,
      actions: [{ value:"yes", label:"Delete lead", kind:"danger" }],
    });
    if (ok !== "yes") return false;
    const { error: e } = await supabase.from("leads").delete().eq("id", lead.id);
    if (e) { fail("Could not delete lead", e); return false; }
    setLeads(ls => ls.filter(l => l.id !== lead.id));
    showToast("Lead deleted", "success");
    return true;
  };

  // Records a follow-up and moves the lead's next follow-up date to the one given (or none).
  // A "new" lead becomes "contacted". Resolves true when saved.
  const addFollowup = async (lead, { method, note, next }) => {
    setBusy(true);
    try {
      const { data: f, error: e1 } = await supabase.from("lead_followups")
        .insert([{ lead_id: lead.id, method, note, next_followup_date: next || null }]).select().single();
      if (e1) throw e1;
      setFollowups(m => ({ ...m, [lead.id]: [f, ...(m[lead.id] || [])] }));
      const { data: l, error: e2 } = await supabase.from("leads")
        .update({ next_followup_date: next || null, ...(lead.status === "new" ? { status: "contacted" } : {}) })
        .eq("id", lead.id).select().single();
      if (e2) throw e2;
      putLead(l);
      showToast("Follow-up saved", "success");
      return true;
    } catch (e) { fail("Could not save follow-up", e); return false; }
    finally { setBusy(false); }
  };

  // Edits a follow-up. When it's the lead's newest one, its next date also becomes the
  // lead's next follow-up date (that's what drives the due list). Resolves true when saved.
  const updateFollowup = async (lead, f, { method, note, next }) => {
    setBusy(true);
    try {
      const { data: row, error: e1 } = await supabase.from("lead_followups")
        .update({ method, note, next_followup_date: next || null }).eq("id", f.id).select().single();
      if (e1) throw e1;
      const list = (followups[lead.id] || []).map(x => x.id === row.id ? row : x);
      setFollowups(m => ({ ...m, [lead.id]: list }));
      if (list[0]?.id === row.id && (lead.next_followup_date || null) !== (row.next_followup_date || null)) {
        const { data: l, error: e2 } = await supabase.from("leads").update({ next_followup_date: row.next_followup_date }).eq("id", lead.id).select().single();
        if (e2) throw e2;
        putLead(l);
      }
      showToast("Follow-up updated", "success");
      return true;
    } catch (e) { fail("Could not update follow-up", e); return false; }
    finally { setBusy(false); }
  };

  // Moves a lead to another stage ("lost" asks first; reopening goes back to "contacted")
  const setLeadStatus = async (lead, status) => {
    if (status === "lost") {
      const ok = await askDialog({
        title: `Mark "${lead.name}" as lost?`,
        body: "The lead leaves the open list. You can reopen it later — add a follow-up note to record why it was lost.",
        actions: [{ value:"yes", label:"Mark as lost", kind:"warn" }],
      });
      if (ok !== "yes") return;
    }
    const { data, error: e } = await supabase.from("leads").update({ status }).eq("id", lead.id).select().single();
    if (e) { fail("Could not update lead", e); return; }
    putLead(data);
  };

  // Qualifies a lead: links it to the customer with the same phone number (or creates one)
  // and, if chosen, creates the event from the lead's details. Retrying after a failure is
  // safe for the customer step (it's matched by phone).
  const qualifyLead = async (lead) => {
    if (busy) return null;
    const existing = matchCustomer(customers, lead.phone);
    const choice = await askDialog({
      title: `Qualify "${lead.name}" as a customer?`,
      body: (
        <>
          <div>
            {existing
              ? <>Their number matches existing customer <strong style={{color:N.text}}>{existing.name}</strong> — the lead is linked to them.</>
              : <>A new customer <strong style={{color:N.text}}>{lead.name}</strong> is created.</>}
          </div>
          <div style={{marginTop:10}}>
            <strong style={{color:N.text}}>Qualify &amp; create event</strong> also creates the event
            {lead.event_type || lead.event_date ? ` (${[lead.event_type, lead.event_date && fmtDay(lead.event_date)].filter(Boolean).join(", ")})` : ""} so you can start designing cards.
          </div>
        </>
      ),
      actions: [
        { value:"only",  label:"Qualify only",           kind:"primary" },
        { value:"event", label:"Qualify & create event", kind:"success" },
      ],
    });
    if (!choice) return null;
    setBusy(true);
    try {
      let customer = existing;
      if (!customer) {
        const { data, error: e } = await supabase.from("customers")
          .insert([{ name: lead.name, phone: lead.phone || null, region: lead.region || null }]).select().single();
        if (e) throw e;
        customer = data;
        putCustomer(data);
      }
      let event = null;
      if (choice === "event") {
        const { data, error: e } = await supabase.from("events").insert([eventFromLead(lead, customer.id)]).select().single();
        if (e) throw e;
        event = data;
        logHistory({ channel:"event", action:"create", detail:`Event created from lead: ${lead.name}` }, data.id);
        setEventCounts(c => ({ ...c, [customer.id]: (c[customer.id] || 0) + 1 }));
        reloadEvents();
      }
      const { data: upd, error: e } = await supabase.from("leads")
        .update({ status:"qualified", customer_id: customer.id, event_id: event?.id ?? lead.event_id ?? null, qualified_at: new Date().toISOString() })
        .eq("id", lead.id).select().single();
      if (e) throw e;
      putLead(upd);
      showToast(`${lead.name} is now a customer${event ? " — event created" : ""}`, "success");
      return { customer, event };
    } catch (e) { return fail("Could not qualify lead", e); }
    finally { setBusy(false); }
  };

  // Creates (no id) or updates a customer; resolves to the saved row or null
  const saveCustomer = async (form, id) => {
    setBusy(true);
    const row = { name: form.name.trim(), phone: form.phone.trim() ? normalisePhone(form.phone) : null,
                  region: form.region.trim() || null, notes: form.notes.trim() || null };
    const q = id ? supabase.from("customers").update(row).eq("id", id) : supabase.from("customers").insert([row]);
    const { data, error: e } = await q.select().single();
    setBusy(false);
    if (e) return fail("Could not save customer", e);
    putCustomer(data);
    showToast(id ? "Customer updated" : `Customer "${data.name}" added`, "success");
    return data;
  };

  const deleteCustomer = async (c) => {
    const n = eventCounts[c.id] || 0;
    const ok = await askDialog({
      title: `Delete customer "${c.name}"?`,
      body: `Their ${n ? `${n} event${n === 1 ? "" : "s"} and ` : ""}leads are kept but no longer linked to a customer.`,
      actions: [{ value:"yes", label:"Delete customer", kind:"danger" }],
    });
    if (ok !== "yes") return false;
    const { error: e } = await supabase.from("customers").delete().eq("id", c.id);
    if (e) { fail("Could not delete customer", e); return false; }
    setCustomers(cs => cs.filter(x => x.id !== c.id));
    setLeads(ls => ls.map(l => l.customer_id === c.id ? { ...l, customer_id: null } : l));
    reloadEvents();
    return true;
  };

  // A customer's events, latest event date first
  const customerEvents = async (customerId) => {
    const { data, error: e } = await supabase.from("events").select("*").eq("customer_id", customerId)
      .order("start_datetime", { ascending:false, nullsFirst:false });
    if (e) { fail("Could not load events", e); return []; }
    return data;
  };

  return {
    leads, customers, eventCounts, followups, loading, busy, error,
    loadAll, loadEventCounts, loadFollowups, saveLead, deleteLead, addFollowup, updateFollowup, setLeadStatus, qualifyLead,
    saveCustomer, deleteCustomer, customerEvents,
  };
}

// Shown in place of a CRM tab when the tables are missing or can't be read
function CrmUnavailable({ error, onRetry }) {
  return (
    <div style={{background:N.navy800,borderRadius:16,border:`1px solid ${N.border}`}}>
      <EmptyState icon="database" tone="warn" title="Leads & customers aren't set up in the database yet"
        text={<>Run <code style={{fontFamily:"JetBrains Mono, monospace",color:N.sky}}>supabase-schema.sql</code> in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste the whole file → Run), then press Retry. Already ran it? Run <code style={{fontFamily:"JetBrains Mono, monospace",color:N.sky}}>NOTIFY pgrst, 'reload schema';</code> once and retry.<br /><span style={{fontFamily:"JetBrains Mono, monospace",fontSize:11}}>{error}</span></>}
        action={<button className="nk-btn nk-btn-ghost" onClick={onRetry}><Icon n="refresh" /> Retry</button>} />
    </div>
  );
}

// Add-a-follow-up box: how they were contacted, what was said, and when to follow up next
function FollowupComposer({ onAdd, busy }) {
  const [method, setMethod] = useState("call");
  const [note,   setNote]   = useState("");
  const [next,   setNext]   = useState("");
  const submit = async () => {
    if (!note.trim()) return;
    if (await onAdd({ method, note: note.trim(), next })) { setNote(""); setNext(""); }
  };
  const quick = [["Tomorrow", 1], ["3 days", 3], ["1 week", 7], ["2 weeks", 14]];
  return (
    <div style={{background:N.navy700,border:`1px solid ${N.border}`,borderRadius:10,padding:12,marginBottom:14}}>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
        {Object.entries(FOLLOWUP_METHODS).map(([k, m]) => (
          <button key={k} type="button" onClick={() => setMethod(k)}
            style={{padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",
              background: method === k ? N.tealBg : "transparent", color: method === k ? N.teal : N.textMid,
              border:`1px solid ${method === k ? N.teal : N.border}`}}>
            <Icon n={m.icon} /> {m.label}
          </button>
        ))}
      </div>
      <textarea className="nk-input nk-textarea" rows={2} style={{minHeight:60}} placeholder="What happened? e.g. Called — wants 300 cards, will confirm date"
        value={note} onChange={e => setNote(e.target.value)} />
      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
        <span style={{fontSize:11,color:N.textDim}}>Next follow-up:</span>
        <input type="date" className="nk-input" style={{width:150,marginBottom:0,padding:"5px 8px"}} value={next} onChange={e => setNext(e.target.value)} />
        {quick.map(([label, d]) => (
          <button key={label} type="button" className="nk-btn-sm" onClick={() => setNext(addDays(d))}
            style={{background:"transparent",color:N.sky,borderColor:alpha(N.sky,"44")}}>{label}</button>
        ))}
        <button className="nk-btn nk-btn-teal" style={{marginLeft:"auto",padding:"6px 14px",fontSize:12}} onClick={submit} disabled={busy || !note.trim()}>
          {busy ? <><Icon n="loader" /></> : <><Icon n="plus" /></>} Add follow-up
        </button>
      </div>
    </div>
  );
}

// Follow-ups, newest first
// Follow-ups, newest first. With `onEdit(f, changes)` each entry gets an Edit button that
// opens it inline (method, note, next follow-up date); onEdit resolves true when saved.
function FollowupList({ items, onEdit, busy }) {
  const [editId, setEditId] = useState(null);
  if (!items) return <EmptyState loading compact title="Loading follow-ups…" />;
  if (!items.length) return <EmptyState icon="phone" compact text="No follow-ups yet — log the first call or message above." />;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {items.map(f => {
        if (f.id === editId) return (
          <FollowupEditor key={f.id} initial={f} busy={busy} onCancel={() => setEditId(null)}
            onSave={async (changes) => { if (await onEdit(f, changes)) setEditId(null); }} />
        );
        const m = FOLLOWUP_METHODS[f.method] || FOLLOWUP_METHODS.other;
        return (
          <div key={f.id} style={{borderLeft:`3px solid ${alpha(N.teal,"66")}`,padding:"4px 0 4px 10px",display:"flex",gap:8,alignItems:"flex-start"}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,color:N.text,whiteSpace:"pre-wrap",lineHeight:1.5}}><Icon n={m.icon} /> {f.note}</div>
              <div style={{fontSize:11,color:N.textDim,marginTop:3,display:"flex",gap:10,flexWrap:"wrap"}}>
                <span>{fmtWhen(f.created_at)}</span>
                {f.created_by && <span>{f.created_by}</span>}
                {f.next_followup_date && <span style={{color:N.sky}}>Next: {fmtDay(f.next_followup_date)}</span>}
              </div>
            </div>
            {onEdit && (
              <Sb bg="transparent" col={N.textDim} border={N.border} label="Edit follow-up" onClick={() => setEditId(f.id)} disabled={busy}>
                <Icon n="edit" />
              </Sb>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Inline editor for one follow-up: how they were contacted, what was said, next date
function FollowupEditor({ initial, onSave, onCancel, busy }) {
  const [method, setMethod] = useState(initial.method || "other");
  const [note,   setNote]   = useState(initial.note || "");
  const [next,   setNext]   = useState(initial.next_followup_date || "");
  const save = () => { if (note.trim()) onSave({ method, note: note.trim(), next }); };
  return (
    <div style={{background:N.navy700,border:`1px solid ${N.accent}`,borderRadius:10,padding:12}}
      onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
        {Object.entries(FOLLOWUP_METHODS).map(([k, m]) => (
          <button key={k} type="button" onClick={() => setMethod(k)} aria-pressed={method === k}
            style={{padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5,
              background: method === k ? N.tealBg : "transparent", color: method === k ? N.teal : N.textMid,
              border:`1px solid ${method === k ? N.teal : N.border}`}}>
            <Icon n={m.icon} /> {m.label}
          </button>
        ))}
      </div>
      <textarea className="nk-input nk-textarea" rows={3} autoFocus value={note} onChange={e => setNote(e.target.value)} aria-label="Follow-up note" />
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <label style={{fontSize:11,color:N.textDim}}>Next follow-up</label>
        <input type="date" className="nk-input" style={{width:"auto",marginBottom:0}} value={next} onChange={e => setNext(e.target.value)} aria-label="Next follow-up date" />
        {next && <button type="button" className="nk-link" style={{fontSize:11}} onClick={() => setNext("")}>No date</button>}
        <div style={{marginLeft:"auto",display:"flex",gap:6}}>
          <button className="nk-btn nk-btn-ghost" style={{padding:"6px 12px",fontSize:12}} onClick={onCancel}>Cancel</button>
          <button className="nk-btn nk-btn-primary" style={{padding:"6px 12px",fontSize:12}} onClick={save} disabled={busy || !note.trim()}>
            {busy ? <Icon n="loader" /> : <Icon n="save" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

// Label + value pair in a details grid
const Info = ({ label, children }) => (
  <div>
    <div style={{fontSize:10,fontWeight:700,color:N.textDim,textTransform:"uppercase",letterSpacing:.6,marginBottom:2}}>{label}</div>
    <div style={{fontSize:13,color:N.text}}>{children || <span style={{color:N.textDim}}>—</span>}</div>
  </div>
);

// Pop-up used to view one record's details (lead, customer, finance event) over its list.
// It closes only through its ✕ button — never by clicking outside or pressing Esc.
function DetailModal({ label, onClose, children, width = 640 }) {
  return (
    <div className="nk-overlay">
      <div className="nk-modal nk-detail" style={{maxWidth:width}} role="dialog" aria-modal="true" aria-label={label}>
        <button className="nk-modal-close nk-detail-close" onClick={onClose} aria-label={`Close ${label}`} title="Close"><Icon n="x" /></button>
        <div className="nk-detail-body">{children}</div>
      </div>
    </div>
  );
}

const segStyle = (on) => ({ padding:"6px 12px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer",
  background: on ? N.navy600 : "transparent", color: on ? N.text : N.textMid, border:`1px solid ${on ? N.sky : N.border}` });

/* ══════════════════════════════════════════════════════════════════════════
   FINANCE — useFinance() + <FinanceTab>, <TxnModal>, <AccountsModal>.
   Tables: finance_accounts, event_transactions (supabase-schema.sql).
   Pure logic (validation, profit / margin, filters) is in src/lib/finance.js.
══════════════════════════════════════════════════════════════════════════ */
const FIN_LIMIT = 5000;   // transactions loaded (newest first)
const MARGIN_TONE = { good:"good", warn:"warn", bad:"bad", none:"info" };
const BLANK_ACCOUNT = { name:"", type:"bank", number:"" };

// Finance data and writes. Loads accounts + all transactions once per sign-in; every
// write updates local state from the row the database returns and is logged to the
// event's history. Without the tables `error` holds the database message.
function useFinance({ enabled, showToast, askDialog, logHistory }) {
  const [accounts, setAccounts] = useState([]);
  const [txns,     setTxns]     = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState(null);
  const [loaded,   setLoaded]   = useState(false);
  const fail = (what, err) => { showToast(`${what}: ${errMsg(err)}`, "warn"); return null; };

  const loadAll = async () => {
    if (!supabase || !enabled) return;
    setLoading(true);
    const [a, t] = await Promise.all([
      supabase.from("finance_accounts").select("*").order("name"),
      supabase.from("event_transactions").select("*").order("txn_date", { ascending:false }).limit(FIN_LIMIT),
    ]);
    setLoading(false);
    const e = a.error || t.error;
    if (e) { setError(e.message); return; }
    setError(null); setLoaded(true);
    setAccounts(a.data); setTxns(t.data);
  };

  // Records an income / expense for an event; resolves to the saved row or null
  const addTxn = async (form, ev) => {
    setBusy(true);
    const { data, error: e } = await supabase.from("event_transactions").insert([txnToRow(form, ev.id)]).select().single();
    setBusy(false);
    if (e) return fail("Could not save transaction", e);
    setTxns(ts => [data, ...ts]);
    const acc = accounts.find(a => a.id === data.account_id)?.name;
    logHistory({ channel:"finance", action:data.kind, name:data.party, title:formatTsh(data.amount),
      detail:[TXN_CATEGORIES[data.kind]?.[data.category], acc && `via ${acc}`, data.reference && `ref ${data.reference}`].filter(Boolean).join(" · ") }, ev.id);
    showToast(`${TXN_KINDS[data.kind].label} of ${formatTsh(data.amount)} recorded`, "success");
    return data;
  };

  const deleteTxn = async (t) => {
    const ok = await askDialog({
      title: `Remove this ${t.kind}?`,
      body: `${formatTsh(t.amount)} ${t.kind === "income" ? "from" : "to"} ${t.party || "—"} on ${fmtDay(t.txn_date)} is removed and the event's profit recalculated. The removal is kept in the event history.`,
      actions: [{ value:"yes", label:"Remove transaction", kind:"danger" }],
    });
    if (ok !== "yes") return false;
    const { error: e } = await supabase.from("event_transactions").delete().eq("id", t.id);
    if (e) { fail("Could not remove transaction", e); return false; }
    setTxns(ts => ts.filter(x => x.id !== t.id));
    logHistory({ channel:"finance", action:"remove", name:t.party, title:formatTsh(t.amount), detail:`${TXN_KINDS[t.kind]?.label} of ${t.txn_date} removed` }, t.event_id);
    showToast("Transaction removed", "success");
    return true;
  };

  // Creates (no id) or updates an account
  const saveAccount = async (form, id) => {
    const errs = validateAccount(form);
    if (Object.keys(errs).length) { showToast(Object.values(errs)[0], "warn"); return null; }
    setBusy(true);
    const row = { name: form.name.trim(), type: form.type || "bank", number: String(form.number || "").trim() || null };
    const q = id ? supabase.from("finance_accounts").update(row).eq("id", id) : supabase.from("finance_accounts").insert([row]);
    const { data, error: e } = await q.select().single();
    setBusy(false);
    if (e) return fail("Could not save account", e);
    setAccounts(as => (as.some(a => a.id === data.id) ? as.map(a => a.id === data.id ? data : a) : [...as, data]).sort((x, y) => x.name.localeCompare(y.name)));
    showToast(id ? "Account updated" : `Account "${data.name}" added`, "success");
    return data;
  };

  // Hides an account from new transactions (its history stays) or brings it back
  const toggleAccount = async (a) => {
    const { data, error: e } = await supabase.from("finance_accounts").update({ active: !a.active }).eq("id", a.id).select().single();
    if (e) return fail("Could not update account", e);
    setAccounts(as => as.map(x => x.id === data.id ? data : x));
  };

  // Saves changes to an existing transaction and logs what changed to the event's history
  const updateTxn = async (t, form) => {
    setBusy(true);
    const row = txnToRow(form, t.event_id);
    const { data, error: e } = await supabase.from("event_transactions").update(row).eq("id", t.id).select().single();
    setBusy(false);
    if (e) return fail("Could not update transaction", e);
    setTxns(ts => ts.map(x => x.id === data.id ? data : x));
    const accName = (id) => accounts.find(a => a.id === id)?.name || "—";
    const changes = [
      Number(t.amount) !== Number(data.amount) && `amount ${formatTsh(t.amount)} → ${formatTsh(data.amount)}`,
      t.kind !== data.kind && `type ${TXN_KINDS[t.kind]?.label} → ${TXN_KINDS[data.kind]?.label}`,
      t.txn_date !== data.txn_date && `date ${t.txn_date} → ${data.txn_date}`,
      t.account_id !== data.account_id && `account ${accName(t.account_id)} → ${accName(data.account_id)}`,
      (t.party || "") !== (data.party || "") && `party ${t.party || "—"} → ${data.party || "—"}`,
      (t.category || "") !== (data.category || "") && "category",
      (t.reference || "") !== (data.reference || "") && "reference",
      (t.note || "") !== (data.note || "") && "note",
    ].filter(Boolean);
    logHistory({ channel:"finance", action:"txn_edit", name:data.party, title:formatTsh(data.amount),
      detail: changes.length ? `Changed: ${changes.join("; ")}` : "Saved without changes" }, data.event_id);
    showToast("Transaction updated", "success");
    return data;
  };

  return { accounts, txns, loading, busy, error, loaded, loadAll, addTxn, updateTxn, deleteTxn, saveAccount, toggleAccount };
}

// Big number tile used across the Finance tab
function MoneyTile({ label, value, tone = "info", sub }) {
  return (
    <div className="nk-stat" style={{borderColor:alpha(TONE[tone],"33")}}>
      <div className="nk-stat-num" style={{color:TONE[tone],fontSize:20}}>{value}</div>
      <div className="nk-stat-label">{label}</div>
      {sub && <div style={{fontSize:11,color:N.textDim,marginTop:4}}>{sub}</div>}
    </div>
  );
}

// Margin badge: green ≥ 30 %, amber 0–30 %, red loss
const MarginPill = ({ pct }) => <Pill tone={MARGIN_TONE[marginTone(pct)]}>{formatPct(pct)}</Pill>;

// Record an income or expense for one event: amount, date, account, who sent / was paid
// Record a new income / expense, or edit one (`initial` = the transaction being edited)
function TxnModal({ kind: initialKind, initial, event, accounts, onSave, onClose, saving, onManageAccounts }) {
  // An edited transaction keeps its account in the list even if that account was deactivated since
  const active = accounts.filter(a => a.active || a.id === initial?.account_id);
  const [form, setForm] = useState(() => initial
    ? { kind: initial.kind, amount: String(initial.amount ?? ""), txn_date: initial.txn_date || localDate(), account_id: initial.account_id || "",
        party: initial.party || "", category: initial.category || (initial.kind === "income" ? "deposit" : "printing"),
        reference: initial.reference || "", note: initial.note || "" }
    : { kind: initialKind, amount:"", txn_date: localDate(), account_id: active.length === 1 ? active[0].id : "",
        party: initialKind === "income" ? (event?.username || "") : "", category: initialKind === "income" ? "deposit" : "printing", reference:"", note:"" });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const setKind = (k) => setForm(f => ({ ...f, kind:k, category: k === "income" ? "deposit" : "printing" }));
  const save = () => {
    const errs = validateTransaction(form);
    setErrors(errs);
    if (!Object.keys(errs).length) onSave(form);
  };
  const amount = parsePrice(form.amount);
  const isIncome = form.kind === "income";
  return (
    <div className="nk-overlay">
      <div className="nk-modal" style={{maxWidth:560}}>
        <div className="nk-modal-head">
          <div>
            <div className="nk-modal-title">{initial ? (isIncome ? "Edit income" : "Edit expense") : (isIncome ? "Record income" : "Record expense")}</div>
            <div style={{fontSize:12,color:N.textDim,marginTop:2}}>{event?.username}{event?.event_type ? ` · ${event.event_type}` : ""}</div>
          </div>
          <button className="nk-modal-close" aria-label="Close" onClick={onClose}><Icon n="x" /></button>
        </div>
        <div className="nk-modal-body">
          <div style={{display:"flex",gap:6,marginBottom:16}} role="tablist">
            {Object.keys(TXN_KINDS).map(k => (
              <button key={k} type="button" role="tab" aria-selected={form.kind === k} onClick={() => setKind(k)}
                style={{...segStyle(form.kind === k), flex:1, padding:"10px 12px", fontSize:13,
                  ...(form.kind === k ? { color: k === "income" ? N.green : N.red, borderColor: k === "income" ? N.green : N.red,
                    background: k === "income" ? N.greenBg : N.redBg } : {})}}>
                {k === "income" ? <><Icon n="arrowDown" /> Money in</> : <><Icon n="arrowUp" /> Money out</>}
              </button>
            ))}
          </div>
          {!active.length && (
            <div style={{padding:12,borderRadius:10,background:N.amberBg,color:N.amber,fontSize:12,marginBottom:14}}>
              <Icon n="alert" /> No accounts yet. <button type="button" className="nk-link" onClick={onManageAccounts}>Add your bank / mobile-money accounts</button> first.
            </div>
          )}
          <div className="nk-form-grid">
            <Field label="Amount (TSh) *" error={errors.amount}>
              <input className="nk-input" autoFocus inputMode="decimal" placeholder="e.g. 250000 or 250k" value={form.amount} onChange={set("amount")} />
              {Number.isFinite(amount) && amount > 0 && <div style={{fontSize:11,color:N.textDim,marginTop:-6,marginBottom:8}}>{formatTsh(amount)}</div>}
            </Field>
            <Field label="Date *" error={errors.txn_date}>
              <input type="date" className="nk-input" value={form.txn_date} onChange={set("txn_date")} />
            </Field>
            <Field label={`${TXN_KINDS[form.kind].partyLabel} *`} error={errors.party}>
              <input className="nk-input" placeholder={isIncome ? "Name of the person who paid" : "Supplier / person paid"} value={form.party} onChange={set("party")} />
            </Field>
            <Field label={isIncome ? "Into account *" : "From account *"} error={errors.account_id}>
              <select className="nk-select" value={form.account_id} onChange={set("account_id")}>
                <option value="">— Select account —</option>
                {active.map(a => <option key={a.id} value={a.id}>{a.name}{a.number ? ` (${a.number})` : ""}</option>)}
              </select>
            </Field>
            <Field label="Category">
              <select className="nk-select" value={form.category} onChange={set("category")}>
                {Object.entries(TXN_CATEGORIES[form.kind]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="Reference">
              <input className="nk-input" placeholder="Bank / M-Pesa transaction ID" value={form.reference} onChange={set("reference")} />
            </Field>
            <Field label="Note" span>
              <textarea className="nk-input nk-textarea" rows={2} value={form.note} onChange={set("note")} />
            </Field>
          </div>
        </div>
        <div className="nk-modal-foot">
          <button className="nk-btn nk-btn-ghost" onClick={onClose}>Cancel</button>
          <button className={`nk-btn ${isIncome ? "nk-btn-success" : "nk-btn-primary"}`} onClick={save} disabled={saving}>
            {saving ? <><Icon n="loader" /> Saving…</> : <><Icon n="save" /> {`${initial ? "Save changes" : `Save ${isIncome ? "income" : "expense"}`}`}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// Lists the business's money accounts with totals; add, rename or deactivate them
function AccountsModal({ fin, onClose }) {
  const [form, setForm] = useState(BLANK_ACCOUNT);
  const [editId, setEditId] = useState(null);
  const totals = summariseByAccount(fin.txns);
  const submit = async () => {
    if (await fin.saveAccount(form, editId)) { setForm(BLANK_ACCOUNT); setEditId(null); }
  };
  return (
    <div className="nk-overlay">
      <div className="nk-modal" style={{maxWidth:680}}>
        <div className="nk-modal-head">
          <div className="nk-modal-title">Money accounts</div>
          <button className="nk-modal-close" aria-label="Close" onClick={onClose}><Icon n="x" /></button>
        </div>
        <div className="nk-modal-body">
          <p style={{fontSize:12,color:N.textDim,marginBottom:12}}>The accounts money is received into and paid from — every transaction names one.</p>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end",marginBottom:16,padding:12,borderRadius:10,background:N.navy700,border:`1px solid ${N.border}`}}>
            <div style={{flex:"2 1 160px"}}>
              <label className="nk-label">Name</label>
              <input className="nk-input" style={{marginBottom:0}} placeholder="e.g. CRDB Bank" value={form.name} onChange={e => setForm(f => ({ ...f, name:e.target.value }))} />
            </div>
            <div style={{flex:"1 1 120px"}}>
              <label className="nk-label">Type</label>
              <select className="nk-select" style={{marginBottom:0}} value={form.type} onChange={e => setForm(f => ({ ...f, type:e.target.value }))}>
                {Object.entries(ACCOUNT_TYPES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
              </select>
            </div>
            <div style={{flex:"1 1 140px"}}>
              <label className="nk-label">Number</label>
              <input className="nk-input" style={{marginBottom:0}} placeholder="Account / till no." value={form.number} onChange={e => setForm(f => ({ ...f, number:e.target.value }))} />
            </div>
            <button className="nk-btn nk-btn-primary" onClick={submit} disabled={fin.busy}>{editId ? <><Icon n="save" /> Update</> : "+ Add"}</button>
            {editId && <button className="nk-btn nk-btn-ghost" onClick={() => { setEditId(null); setForm(BLANK_ACCOUNT); }}>Cancel</button>}
          </div>
          <div className="nk-table-wrap" style={{margin:0}}>
            <table className="nk-table">
              <thead><tr><th>Account</th><th className="num">In</th><th className="num">Out</th><th className="num">Net</th><th></th></tr></thead>
              <tbody>
                {fin.accounts.map(a => {
                  const t = totals[a.id] || { income:0, expense:0, net:0 };
                  return (
                    <tr key={a.id} style={a.active ? undefined : { opacity:0.55 }}>
                      <td>
                        <div style={{fontWeight:700,color:N.text}}><Icon n={ACCOUNT_TYPES[a.type]?.icon} style={{color:N.sky}} /> {a.name}{!a.active && <span style={{fontSize:11,color:N.textDim}}> · inactive</span>}</div>
                        <div style={{fontSize:11,color:N.textDim,fontFamily:"JetBrains Mono, monospace"}}>{a.number || ACCOUNT_TYPES[a.type]?.label}</div>
                      </td>
                      <td className="num" style={{color:N.green}}>{formatTsh(t.income)}</td>
                      <td className="num" style={{color:N.red}}>{formatTsh(t.expense)}</td>
                      <td className="num" style={{fontWeight:700,color:t.net < 0 ? N.red : N.text}}>{formatTsh(t.net)}</td>
                      <td style={{whiteSpace:"nowrap",textAlign:"right"}}>
                        <div className="nk-row-actions" style={{justifyContent:"flex-end"}}>
                          <Sb bg="transparent" col={N.sky} border={N.border} label={`Edit ${a.name}`} onClick={() => { setEditId(a.id); setForm({ name:a.name, type:a.type, number:a.number || "" }); }}><Icon n="edit" /> Edit</Sb>
                          <Sb bg="transparent" col={a.active ? N.amber : N.green} border={N.border} label={`${a.active ? "Deactivate" : "Activate"} ${a.name}`}
                            title={a.active ? "Hide from new transactions; history is kept" : "Allow new transactions again"} onClick={() => fin.toggleAccount(a)}>
                            <Icon n={a.active ? "ban" : "check"} /> {a.active ? "Deactivate" : "Activate"}
                          </Sb>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!fin.accounts.length && <EmptyState icon="bank" compact title="No accounts yet" text="Add the bank, mobile-money and cash accounts money moves through." />}
          </div>
        </div>
      </div>
    </div>
  );
}

// Finance tab: business-wide totals, each event's income / expense / profit / margin,
// and the selected event's transactions with who paid (or was paid) via which account
function FinanceTab({ fin, events, eventsLoaded = true, customers, selectedId, onSelect, onExport }) {
  const canDelete = useCanDelete();
  const [q,       setQ]       = useState("");
  const [range,   setRange]   = useState({ from:"", to:"" });
  const [txFilter, setTxFilter] = useState("all");
  const [adding,  setAdding]  = useState(null);   // null | "income" | "expense"
  const [editingTxn, setEditingTxn] = useState(null);   // transaction open in the edit form
  const [accountsOpen, setAccountsOpen] = useState(false);
  if (fin.error) return (
    <div style={{background:N.navy800,borderRadius:16,border:`1px solid ${N.border}`}}>
      <EmptyState icon="wallet" tone="warn" title="Finance isn't set up in the database yet"
        text={<>Run <code style={{fontFamily:"JetBrains Mono, monospace",color:N.sky}}>supabase-schema.sql</code> in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste the whole file → Run), then press Retry. Already ran it? Run <code style={{fontFamily:"JetBrains Mono, monospace",color:N.sky}}>NOTIFY pgrst, 'reload schema';</code> once and retry.<br /><span style={{fontFamily:"JetBrains Mono, monospace",fontSize:11}}>{fin.error}</span></>}
        action={<button className="nk-btn nk-btn-ghost" onClick={fin.loadAll}><Icon n="refresh" /> Retry</button>} />
    </div>
  );

  const inRange = filterTransactions(fin.txns, range);
  const total   = summariseTransactions(inRange);
  const byEvent = groupByEvent(inRange);
  const custName = Object.fromEntries(customers.map(c => [c.id, c.name]));
  const accName  = Object.fromEntries(fin.accounts.map(a => [a.id, a]));
  const needle = q.trim().toLowerCase();
  const rows = events
    .filter(ev => !needle || [ev.username, ev.event_type, ev.venue_name, custName[ev.customer_id]].filter(Boolean).join(" ").toLowerCase().includes(needle))
    .map(ev => ({ ev, s: summariseTransactions(byEvent[ev.id] || []) }))
    .sort((a, b) => (b.s.count > 0) - (a.s.count > 0) || b.s.income - a.s.income);
  const withTxns = rows.filter(r => r.s.count).length;
  const ev = events.find(e => e.id === selectedId) || null;
  const evTxns = ev ? sortTransactions(filterTransactions(byEvent[ev.id] || [], { kind: txFilter })) : [];
  const evSum  = ev ? summariseTransactions(byEvent[ev.id] || []) : null;
  const evCats = ev ? summariseByCategory(byEvent[ev.id] || []) : null;
  const ranges = [["All time", "", ""], ["This month", localDate().slice(0, 8) + "01", ""], ["Last 30 days", addDays(-30), ""], ["This year", localDate().slice(0, 4) + "-01-01", ""]];

  return (
    <div className="nk-page" style={{padding:"0 0 40px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:800,color:N.text}}>Finance</h2>
          <p style={{fontSize:12,color:N.textDim,marginTop:2}}>Every shilling in and out, per event — and what each event really earned</p>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={fin.loadAll} disabled={fin.loading} aria-label="Refresh">{fin.loading ? <><Icon n="loader" /></> : <><Icon n="undo" /></>} Refresh</button>
          <button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={() => onExport(inRange)} disabled={!inRange.length}><Icon n="download" /> Export Excel</button>
          <button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={() => setAccountsOpen(true)}><Icon n="bank" /> Accounts ({fin.accounts.filter(a => a.active).length})</button>
        </div>
      </div>

      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
        {ranges.map(([l, from, to]) => (
          <button key={l} style={segStyle(range.from === from && range.to === to)} onClick={() => setRange({ from, to })}>{l}</button>
        ))}
      </div>

      <div className="nk-stats">
        <MoneyTile label="Income"   value={formatTsh(total.income)}  tone="good" />
        <MoneyTile label="Expenses" value={formatTsh(total.expense)} tone="bad" />
        <MoneyTile label="Profit"   value={formatTsh(total.profit)}  tone={total.profit < 0 ? "bad" : "info"} />
        <MoneyTile label="Margin"   value={formatPct(total.marginPct)} tone={MARGIN_TONE[marginTone(total.marginPct)]} sub={`${withTxns} event${withTxns === 1 ? "" : "s"} · ${total.count} transaction${total.count === 1 ? "" : "s"}`} />
      </div>

      <div className="nk-split" style={{display:"flex",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
        <div style={{flex:"2 1 520px",minWidth:0}}>
          <input className="nk-input" style={{maxWidth:320,marginBottom:10}} placeholder="Search event, customer, venue…" value={q} onChange={e => setQ(e.target.value)} />
          <div className="nk-table-wrap" style={{margin:0}}>
            <table className="nk-table">
              <thead><tr><th>Event</th><th className="num">Income</th><th className="num">Expenses</th><th className="num">Profit</th><th>Margin</th></tr></thead>
              <tbody>
                {rows.map(({ ev: e, s }) => (
                  <tr key={e.id} onClick={() => onSelect(e.id)} style={{cursor:"pointer"}} className={e.id === selectedId ? "row-active" : ""}>
                    <td>
                      <div style={{fontWeight:700,color:N.text}}>{e.username}</div>
                      <div style={{fontSize:11,color:N.textDim}}>{[e.event_type, custName[e.customer_id], e.start_datetime && fmtDay(e.start_datetime)].filter(Boolean).join(" · ") || "—"}</div>
                    </td>
                    <td className="num" style={{color:s.income ? N.green : N.textDim}}>{s.income ? formatTsh(s.income) : "—"}</td>
                    <td className="num" style={{color:s.expense ? N.red : N.textDim}}>{s.expense ? formatTsh(s.expense) : "—"}</td>
                    <td className="num" style={{fontWeight:700,color:!s.count ? N.textDim : s.profit < 0 ? N.red : N.text}}>{s.count ? formatTsh(s.profit) : "—"}</td>
                    <td>{s.count ? <MarginPill pct={s.marginPct} /> : <span style={{fontSize:11,color:N.textDim}}>No entries</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (fin.loading || !eventsLoaded ? <EmptyState loading title="Loading finance…" />
              : events.length ? <EmptyState icon="search" title="No events match" text="Try another name, customer or venue."
                  action={<button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={() => setQ("")}>Clear search</button>} />
              : <EmptyState icon="folder" title="No events yet" text="Create an event in the Events tab, then record its payments here." />)}
          </div>
        </div>

        {ev && (
          <DetailModal label={`${ev.username} finance`} onClose={() => onSelect(null)} width={680}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:12}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:16,fontWeight:800,color:N.text}}>{ev.username}</div>
                <div style={{fontSize:12,color:N.textDim}}>{[ev.event_type, custName[ev.customer_id], ev.package_price && `${formatTsh(ev.package_price)} / card`].filter(Boolean).join(" · ")}</div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
              <MoneyTile label="Income"   value={formatTsh(evSum.income)}  tone="good" />
              <MoneyTile label="Expenses" value={formatTsh(evSum.expense)} tone="bad" />
              <MoneyTile label="Profit"   value={formatTsh(evSum.profit)}  tone={evSum.profit < 0 ? "bad" : "info"} />
              <MoneyTile label="Margin"   value={formatPct(evSum.marginPct)} tone={MARGIN_TONE[marginTone(evSum.marginPct)]} />
            </div>
            {evSum.income > 0 && (
              <div style={{marginBottom:14}} title="Share of income spent vs kept">
                <div style={{display:"flex",height:8,borderRadius:4,overflow:"hidden",background:N.navy700}}>
                  <div style={{width:`${Math.min(100, evSum.expense / evSum.income * 100)}%`,background:N.red}} />
                  <div style={{flex:1,background:evSum.profit >= 0 ? N.green : "transparent"}} />
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:N.textDim,marginTop:4}}>
                  <span>Spent {Math.round(Math.min(100, evSum.expense / evSum.income * 100))}%</span><span>Kept {formatPct(evSum.marginPct)}</span>
                </div>
              </div>
            )}
            <div style={{display:"flex",gap:8,marginBottom:12}}>
              <button className="nk-btn nk-btn-success" style={{flex:1}} onClick={() => setAdding("income")}>+ Income</button>
              <button className="nk-btn nk-btn-ghost" style={{flex:1,color:N.red,borderColor:alpha(N.red,"66")}} onClick={() => setAdding("expense")}>+ Expense</button>
            </div>
            {evCats && Object.keys(evCats.expense).length > 0 && (
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
                {Object.entries(evCats.expense).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
                  <span key={c} style={{fontSize:11,padding:"3px 8px",borderRadius:6,background:N.navy700,color:N.textMid,border:`1px solid ${N.border}`}}>
                    {TXN_CATEGORIES.expense[c] || c}: <strong style={{color:N.text}}>{formatTsh(v)}</strong>
                  </span>
                ))}
              </div>
            )}
            <div style={{display:"flex",gap:6,marginBottom:8}}>
              {[["all","All"],["income","Income"],["expense","Expenses"]].map(([k, l]) => <button key={k} style={segStyle(txFilter === k)} onClick={() => setTxFilter(k)}>{l}</button>)}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {evTxns.map(t => {
                const inc = t.kind === "income";
                const acc = accName[t.account_id];
                return (
                  <div key={t.id} style={{display:"flex",gap:10,alignItems:"flex-start",padding:10,borderRadius:10,background:N.navy700,border:`1px solid ${N.border}`}}>
                    <div style={{width:30,height:30,borderRadius:8,flexShrink:0,display:"grid",placeItems:"center",fontWeight:800,
                      background:inc ? N.greenBg : N.redBg,color:inc ? N.green : N.red}}>{inc ? <><Icon n="arrowDown" /></> : <><Icon n="arrowUp" /></>}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                        <span style={{fontWeight:700,color:N.text,overflow:"hidden",textOverflow:"ellipsis"}}>{t.party || "—"}</span>
                        <span style={{fontWeight:800,color:inc ? N.green : N.red,whiteSpace:"nowrap",fontVariantNumeric:"tabular-nums"}}>{TXN_KINDS[t.kind].sign}{formatTsh(t.amount)}</span>
                      </div>
                      <div style={{fontSize:11,color:N.textDim,marginTop:2}}>
                        {[fmtDay(t.txn_date), TXN_CATEGORIES[t.kind]?.[t.category] || t.category, acc && `${inc ? "into" : "from"} ${acc.name}`, t.reference && `ref ${t.reference}`].filter(Boolean).join(" · ")}
                      </div>
                      {t.note && <div style={{fontSize:12,color:N.textMid,marginTop:4}}>{t.note}</div>}
                      {t.created_by && <div style={{fontSize:10,color:N.textDim,marginTop:2}}>by {t.created_by}</div>}
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      <button className="nk-btn nk-btn-ghost" style={{padding:"4px 8px",fontSize:12}} aria-label={`Edit ${t.kind} of ${formatTsh(t.amount)}`} title="Edit" onClick={() => setEditingTxn(t)}><Icon n="edit" /></button>
                      {canDelete && (<button className="nk-btn nk-btn-ghost" style={{padding:"4px 8px",fontSize:12,color:N.red}} aria-label={`Remove ${t.kind} of ${formatTsh(t.amount)}`} title="Remove" onClick={() => fin.deleteTxn(t)}><Icon n="trash" /></button>)}
                    </div>
                  </div>
                );
              })}
              {!evTxns.length && (
                <EmptyState icon={txFilter === "expense" ? "arrowUp" : "arrowDown"} compact
                  title={`No ${txFilter === "all" ? "transactions" : txFilter === "income" ? "income" : "expenses"} yet`}
                  text={txFilter === "expense" ? "Record printing, credit, transport and other costs with + Expense." : "Record the customer's payment with + Income."} />
              )}
            </div>
          </DetailModal>
        )}
      </div>

      {adding && ev && (
        <TxnModal kind={adding} event={ev} accounts={fin.accounts} saving={fin.busy}
          onManageAccounts={() => { setAdding(null); setAccountsOpen(true); }}
          onClose={() => setAdding(null)}
          onSave={async (form) => { if (await fin.addTxn(form, ev)) setAdding(null); }} />
      )}
      {editingTxn && (
        <TxnModal key={editingTxn.id} initial={editingTxn} event={events.find(e => e.id === editingTxn.event_id) || ev} accounts={fin.accounts} saving={fin.busy}
          onManageAccounts={() => { setEditingTxn(null); setAccountsOpen(true); }}
          onClose={() => setEditingTxn(null)}
          onSave={async (form) => { if (await fin.updateTxn(editingTxn, form)) setEditingTxn(null); }} />
      )}
      {accountsOpen && <AccountsModal fin={fin} onClose={() => setAccountsOpen(false)} />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   GUIDE — <GuideTab> (flow map, live progress for the open event, how records
   connect) and <WelcomeModal> (first sign-in). Content lives in src/lib/guide.js.
══════════════════════════════════════════════════════════════════════════ */
const TAB_LABEL = { events:"Events", leads:"Leads", customers:"Customers", design:"Design", vcard:"VCard", sms:"SMS",
  whatsapp:"WhatsApp", batch:"Batch & Send", reports:"Reports", history:"History", finance:"Finance", guide:"Guide", calls:"Calls", scanner:"Scanner", settings:"Settings" };
const stepNo = Object.fromEntries(GUIDE_STEPS.map((st, i) => [st.id, i + 1]));

// One step of the flow map: number (or tick when the open event has done it), icon, title
function GuideStep({ step, done, isNext, onOpen }) {
  const stage = GUIDE_STAGES.find(g => g.id === step.stage);
  const col = TONE[stage.tone];
  return (
    <button type="button" className={`nk-guide-step${isNext ? " is-next" : ""}`} onClick={() => onOpen(step)}
      aria-label={`Step ${stepNo[step.id]}: ${step.title}${done ? " (done)" : ""}${isNext ? " (next)" : ""}. Show details`}
      style={{"--c": col}}>
      <span className="nk-guide-num" style={done ? { background: N.green, borderColor: N.green, color: "#fff" } : undefined}>
        {done ? <Icon n="check" /> : stepNo[step.id]}
      </span>
      <span className="nk-guide-ico"><Icon n={step.icon} /></span>
      <span style={{flex:1,minWidth:0}}>
        <span className="nk-guide-title">{step.title}</span>
        <span className="nk-guide-where">{TAB_LABEL[step.tab]}{step.optional ? " · optional" : ""}{isNext ? " · next" : ""}</span>
      </span>
      <Icon n="arrowRight" style={{color:N.textDim}} />
    </button>
  );
}

// Guide tab: the whole workflow as a map, the open event's progress, and how records connect
function GuideTab({ progress, eventName, onGo }) {
  const [open, setOpen] = useState(null);   // step shown in the detail pop-up
  const idx = open ? GUIDE_STEPS.findIndex(s => s.id === open.id) : -1;
  const prev = idx > 0 ? GUIDE_STEPS[idx - 1] : null;
  const next = idx >= 0 && idx < GUIDE_STEPS.length - 1 ? GUIDE_STEPS[idx + 1] : null;
  const nextStep = GUIDE_STEPS.find(s => s.id === progress.next);
  return (
    <div className="nk-page" style={{padding:"0 0 40px"}}>
      <div style={{marginBottom:18}}>
        <h2 style={{fontSize:20,fontWeight:800,color:N.text}}>How Nikadi Studio works</h2>
        <p style={{fontSize:12,color:N.textDim,marginTop:2}}>From the first enquiry to the last shilling — click any step to see what it does and where it leads.</p>
      </div>

      <div className="nk-guide-progress">
        {eventName ? (
          <>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:11,color:N.textDim,textTransform:"uppercase",letterSpacing:.8,fontWeight:700}}>Open event</div>
                <div className="nk-ellipsis" style={{fontSize:16,fontWeight:800,color:N.text}}>{eventName}</div>
              </div>
              <div style={{fontSize:22,fontWeight:800,color:progress.pct === 100 ? N.green : N.sky}}>{progress.pct}%</div>
            </div>
            <div className="nk-guide-bar" role="progressbar" aria-valuenow={progress.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Event progress">
              <div style={{width:`${progress.pct}%`}} />
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",fontSize:12,color:N.textMid}}>
              <span>{progress.count} of {progress.total} steps done</span>
              {nextStep
                ? <button className="nk-btn nk-btn-primary" style={{fontSize:12,padding:"7px 14px"}} onClick={() => onGo(nextStep.tab)}>
                    Next: {nextStep.title} <Icon n="arrowRight" />
                  </button>
                : <span style={{color:N.green,fontWeight:700}}><Icon n="check" /> Every step done — great work!</span>}
            </div>
          </>
        ) : (
          <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
            <span className="nk-empty-icon" style={{width:44,height:44,fontSize:20,marginBottom:0,color:N.sky,background:alpha(N.sky,"1a")}}><Icon n="folder" /></span>
            <div style={{flex:"1 1 220px"}}>
              <div style={{fontWeight:700,color:N.text}}>Open an event to track its progress</div>
              <div style={{fontSize:12,color:N.textDim}}>The map below ticks off each step as the event moves along.</div>
            </div>
            <button className="nk-btn nk-btn-primary" style={{fontSize:12}} onClick={() => onGo("events")}><Icon n="folder" /> Go to Events</button>
          </div>
        )}
      </div>

      <div className="nk-guide-map">
        {GUIDE_STAGES.map((stage, si) => (
          <div key={stage.id} className="nk-guide-stage-wrap">
            <section className="nk-guide-stage" style={{"--c": TONE[stage.tone]}} aria-label={stage.label}>
              <div className="nk-guide-stage-head">
                <span className="nk-guide-stage-no">{si + 1}</span>
                <div>
                  <div className="nk-guide-stage-title">{stage.label}</div>
                  <div className="nk-guide-stage-blurb">{stage.blurb}</div>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {stepsOfStage(stage.id).map(step => (
                  <GuideStep key={step.id} step={step} done={eventName && progress.done[step.id]} isNext={eventName && progress.next === step.id} onOpen={setOpen} />
                ))}
              </div>
            </section>
            {si < GUIDE_STAGES.length - 1 && <div className="nk-guide-arrow" aria-hidden="true"><Icon n="arrowRight" /></div>}
          </div>
        ))}
      </div>

      <div className="nk-guide-links">
        <div className="nk-sec" style={{marginBottom:12}}><Icon n="link" /> How things connect</div>
        <div className="nk-guide-links-grid">
          {GUIDE_LINKS.map((l, i) => (
            <div key={i} className="nk-guide-link">
              <span className="nk-guide-node">{l.from}</span>
              <span className="nk-guide-edge"><span>{l.label}</span><Icon n="arrowRight" /></span>
              <span className="nk-guide-node">{l.to}</span>
            </div>
          ))}
        </div>
        <p style={{fontSize:12,color:N.textDim,marginTop:12,lineHeight:1.6}}>
          The <strong style={{color:N.text}}>event</strong> is the centre of everything: open one, and the Design, SMS, WhatsApp, Reports and History tabs all work on it.
          The <strong style={{color:N.text}}>Overview</strong> (eye icon in Events) shows one event's customer, lead, sending and profit together.
        </p>
      </div>

      {open && (
        <DetailModal label={open.title} onClose={() => setOpen(null)} width={560}>
          <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:16}}>
            <span className="nk-empty-icon" style={{width:52,height:52,fontSize:24,marginBottom:0,
              color:TONE[GUIDE_STAGES.find(g => g.id === open.stage).tone],background:alpha(TONE[GUIDE_STAGES.find(g => g.id === open.stage).tone],"1a")}}>
              <Icon n={open.icon} />
            </span>
            <div style={{minWidth:0}}>
              <div style={{fontSize:11,color:N.textDim,fontWeight:700,textTransform:"uppercase",letterSpacing:.8}}>
                Step {stepNo[open.id]} · {GUIDE_STAGES.find(g => g.id === open.stage).label}
              </div>
              <div style={{fontSize:18,fontWeight:800,color:N.text}}>{open.title}</div>
            </div>
          </div>
          <div className="nk-guide-block"><div className="nk-guide-block-label">What you do</div>{open.what}</div>
          <div className="nk-guide-block"><div className="nk-guide-block-label">Why it matters</div>{open.why}</div>
          {open.tips.length > 0 && (
            <div className="nk-guide-block">
              <div className="nk-guide-block-label">Tips</div>
              <ul style={{paddingLeft:18,display:"flex",flexDirection:"column",gap:4}}>{open.tips.map(t => <li key={t}>{t}</li>)}</ul>
            </div>
          )}
          <div className="nk-guide-block">
            <div className="nk-guide-block-label">Connected steps</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {prev && <button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={() => setOpen(prev)}>Before: {prev.title}</button>}
              {next && <button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={() => setOpen(next)}>After: {next.title} <Icon n="arrowRight" /></button>}
            </div>
          </div>
          <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}>
            <button className="nk-btn nk-btn-ghost" onClick={() => setOpen(null)}>Close</button>
            <button className="nk-btn nk-btn-primary" onClick={() => { setOpen(null); onGo(open.tab); }}>Go to {TAB_LABEL[open.tab]} <Icon n="arrowRight" /></button>
          </div>
        </DetailModal>
      )}
    </div>
  );
}

// Shown once after the first sign-in: the four stages in one glance
function WelcomeModal({ name, onClose, onGuide }) {
  return (
    <div className="nk-overlay nk-top">
      <div className="nk-modal" style={{maxWidth:640}} role="dialog" aria-modal="true" aria-labelledby="nk-welcome-title">
        <div className="nk-modal-head">
          <div className="nk-modal-title" id="nk-welcome-title">Welcome{name ? `, ${name.split(" ")[0]}` : ""}!</div>
          <button className="nk-modal-close" onClick={onClose} aria-label="Close welcome" title="Close"><Icon n="x" /></button>
        </div>
        <div className="nk-modal-body">
          <p style={{fontSize:13,color:N.textMid,marginBottom:16,lineHeight:1.6}}>Nikadi Studio takes an event from the first enquiry to delivered cards and a clear profit — in four stages:</p>
          <div className="nk-guide-welcome">
            {GUIDE_STAGES.map((st, i) => (
              <div key={st.id} className="nk-guide-welcome-item" style={{"--c": TONE[st.tone]}}>
                <span className="nk-guide-stage-no">{i + 1}</span>
                <div>
                  <div style={{fontWeight:800,color:N.text,fontSize:13}}>{st.label}</div>
                  <div style={{fontSize:12,color:N.textDim}}>{st.blurb}</div>
                </div>
              </div>
            ))}
          </div>
          <p style={{fontSize:12,color:N.textDim,marginTop:14}}>You can reopen the guide any time from the <Icon n="help" /> Help button at the top.</p>
        </div>
        <div className="nk-modal-foot">
          <button className="nk-btn nk-btn-ghost" onClick={onClose}>Skip for now</button>
          <button className="nk-btn nk-btn-primary" onClick={onGuide}><Icon n="map" /> Show me how it works</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ACCESS & SETTINGS — useAccess() (my role, the permission matrix and every
   Settings list), <NoAccess>, <SettingsTab>. The database enforces the same
   rules (has_perm() in supabase-roles-settings-scan.sql); the UI only hides
   what a role can't use. Pure logic: src/lib/permissions.js, settings.js, cardRules.js.
══════════════════════════════════════════════════════════════════════════ */
// Deleting records is for Super Admins only (the database enforces the same rule). Components
// read this to hide their delete buttons; <App> provides it.
const CanDeleteContext = createContext(false);
const useCanDelete = () => useContext(CanDeleteContext);

const isMissingTable = (e) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /schema cache|does not exist/i.test(e.message || ""));

function useAccess({ userId, email, showToast }) {
  const [st, setSt] = useState({ loading: true, setupMissing: false, me: null, matrix: null,
    settings: DEFAULT_SETTINGS, waTemplates: [], senderIds: [], cardRules: [] });
  const [users, setUsers] = useState(null);
  const [busy, setBusy]   = useState(false);
  const fail = (what, e) => { showToast(`${what}: ${errMsg(e)}`, "warn"); return null; };

  // My role + permissions + every settings list (all readable by any active user)
  const loadAll = async () => {
    if (!supabase || !userId) { setSt(s => ({ ...s, loading: false })); return; }
    const me = await supabase.from("app_users").select("*").eq("email", (email || "").toLowerCase()).maybeSingle();
    if (isMissingTable(me.error)) {
      // Roles not set up yet: keep the old "everyone can do everything" behaviour until the SQL is run
      setSt(s => ({ ...s, loading: false, setupMissing: true, me: { email, role: "superuser", active: true } }));
      return;
    }
    const [perms, sets, tpl, snd, rules, roleRows] = await Promise.all([
      supabase.from("role_permissions").select("*"),
      supabase.from("app_settings").select("*"),
      supabase.from("wa_templates").select("*").order("sort").order("name"),
      supabase.from("sender_ids").select("*").order("sender_id"),
      supabase.from("card_type_rules").select("*").order("sort").order("name"),
      supabase.from("app_roles").select("*").order("sort"),
    ]);
    setSt({ loading: false, setupMissing: false, me: me.data || null, roleRows: roleRows.data || [],
      matrix: perms.error ? null : matrixFromRows(perms.data),
      settings: settingsFromRows(sets.data || []), waTemplates: tpl.data || [], senderIds: snd.data || [], cardRules: rules.data || [] });
    if (me.data?.active) supabase.rpc("touch_last_seen").then(() => {}, () => {});
  };
  useEffect(() => { loadAll(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect -- loads data from the database

  const role = st.me?.active ? st.me.role : null;
  const allow = (module, level = "view") => st.setupMissing || can(st.matrix, role, module, level);

  const loadUsers = async () => {
    const { data, error } = await supabase.from("app_users").select("*").order("created_at", { ascending: true });
    if (error) return fail("Could not load users", error);
    setUsers(data);
  };

  // Generic save for the settings tables: insert (no id) or update; refreshes the lists
  const save = async (table, row, what, idKey = "id") => {
    setBusy(true);
    const id = row[idKey];
    const body = { ...row }; if (idKey === "id") delete body.id;
    const q = id && idKey === "id" ? supabase.from(table).update(body).eq("id", id) : supabase.from(table).upsert([row]);
    const { error } = await q;
    setBusy(false);
    if (error) return fail(`Could not save ${what}`, error);
    showToast(`${what[0].toUpperCase()}${what.slice(1)} saved`, "success");
    await (table === "app_users" ? loadUsers() : loadAll());
    return true;
  };
  const remove = async (table, id, what) => {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) return fail(`Could not delete ${what}`, error);
    showToast(`${what[0].toUpperCase()}${what.slice(1)} deleted`, "success");
    await loadAll();
    return true;
  };
  // Makes one row the default (clears the old default first — only one may be default)
  const makeDefault = async (table, id) => {
    setBusy(true);
    const a = await supabase.from(table).update({ is_default: false }).eq("is_default", true);
    const b = a.error ? a : await supabase.from(table).update({ is_default: true, active: true }).eq("id", id);
    setBusy(false);
    if (b.error) return fail("Could not set the default", b.error);
    await loadAll();
    return true;
  };
  const savePermissions = async (roleKey, perms) => {
    setBusy(true);
    const { error } = await supabase.from("role_permissions").upsert(rowsForRole(roleKey, perms), { onConflict: "role,module" });
    setBusy(false);
    if (error) return fail("Could not save permissions", error);
    showToast(`${ROLE_LABEL[roleKey]} permissions saved`, "success");
    await loadAll();
    return true;
  };
  const saveSetting = async (key, value) => {
    const { error } = await supabase.from("app_settings").upsert([{ key, value }]);
    if (error) return fail("Could not save setting", error);
    await loadAll();
    return true;
  };

  // Super Admin always sees every event; other roles when their "sees all events" flag is on
  const seesAllEvents = st.setupMissing || role === "superuser" || !!(st.roleRows || []).find(r => r.key === role)?.sees_all_events;
  const setSeesAll = async (roleKey, value) => {
    const { error } = await supabase.from("app_roles").update({ sees_all_events: value }).eq("key", roleKey);
    if (error) return fail("Could not change event visibility", error);
    showToast(`${ROLE_LABEL[roleKey]} now ${value ? "sees every event" : "sees only assigned events"}`, "success");
    await loadAll();
    return true;
  };

  return { ...st, role, can: allow, seesAllEvents, setSeesAll, users, busy, loadAll, loadUsers, save, remove, makeDefault, savePermissions, saveSetting };
}

// Shown when the signed-in account isn't an active user of the system
function NoAccess({ email, name, avatar, onSignOut, onRetry }) {
  const [checking, setChecking] = useState(false);
  const [copied, setCopied]     = useState(false);
  const retry = async () => { setChecking(true); try { await onRetry(); } finally { setChecking(false); } };
  const copy = async () => {
    try { await navigator.clipboard.writeText(email); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { /* clipboard blocked: the email is shown on screen to copy by hand */ }
  };
  const steps = [
    ["users", "Ask an administrator", "A Super Admin or Admin of Nikadi Studio can give you access."],
    ["settings", "They invite this email", "In Settings → Users → Invite user, with the role you need."],
    ["refresh", "Come back and check again", "Your workspace opens straight away — no need to sign in again."],
  ];
  return (
    <div className="nk-noaccess">
      <style>{CSS}</style>
      <div className="nk-noaccess-card" role="main" aria-labelledby="nk-noaccess-title">
        <div className="nk-noaccess-brand">
          <div className="nk-logo-icon"><Logo title="Nikadi" /></div>
          <div>
            <div className="nk-logo-name">Nikadi Studio</div>
            <div className="nk-logo-tag">Card Design &amp; Dispatch</div>
          </div>
        </div>

        <div className="nk-noaccess-lock" aria-hidden="true"><Icon n="lock" /></div>
        <h1 id="nk-noaccess-title" className="nk-noaccess-title">You don't have access yet</h1>
        <p className="nk-noaccess-lead">
          You're signed in, but this account hasn't been given a role in Nikadi Studio — or its access was turned off.
        </p>

        <div className="nk-noaccess-account">
          {avatar ? <img src={avatar} alt="" className="nk-noaccess-avatar" /> : <span className="nk-noaccess-avatar nk-noaccess-avatar-empty"><Icon n="user" /></span>}
          <div style={{flex:1,minWidth:0}}>
            {name && <div className="nk-ellipsis" style={{fontWeight:700,color:N.text,fontSize:14}}>{name}</div>}
            <div className="nk-ellipsis" style={{fontSize:13,color:N.textMid,fontFamily:"JetBrains Mono, monospace"}}>{email}</div>
          </div>
          <button type="button" className="nk-btn nk-btn-ghost" style={{padding:"6px 10px",fontSize:12}} onClick={copy}
            aria-label="Copy your email to send to an administrator" title="Copy email">
            <Icon n={copied ? "check" : "copy"} /> {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <ol className="nk-noaccess-steps">
          {steps.map(([ic, t, d], i) => (
            <li key={t}>
              <span className="nk-noaccess-step-no">{i + 1}</span>
              <div>
                <div className="nk-noaccess-step-title"><Icon n={ic} /> {t}</div>
                <div className="nk-noaccess-step-text">{d}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className="nk-noaccess-actions">
          <button className="nk-btn nk-btn-primary" onClick={retry} disabled={checking}>
            <Icon n={checking ? "loader" : "refresh"} /> {checking ? "Checking…" : "Check again"}
          </button>
          <button className="nk-btn nk-btn-ghost" onClick={onSignOut}>Use a different account</button>
        </div>
      </div>
      <p className="nk-noaccess-foot">Signed in with the wrong Google account? Choose <strong>Use a different account</strong> to sign out.</p>
    </div>
  );
}

const ROLE_TONE = { superuser:"bad", admin:"warn", sales_officer:"info", graphics_designer:"info", help_desk:"good", telesales:"good", finance_officer:"warn" };
const RoleBadge = ({ role }) => role ? <Pill tone={ROLE_TONE[role] || "info"}>{ROLE_LABEL[role] || role}</Pill> : null;

// Settings tab: users, roles & permissions, WhatsApp templates, sender IDs, card types, general
function SettingsTab({ access, askDialog, myEmail }) {
  const sections = [
    ["users",     "Users",                "users",    access.can("users")],
    ["perms",     "Roles & permissions",  "shield",   access.can("users")],
    ["templates", "WhatsApp templates",   "whatsapp", access.can("settings")],
    ["senders",   "Sender IDs",           "sms",      access.can("settings")],
    ["cards",     "Card types",           "contact",  access.can("settings")],
    ["general",   "General",              "settings", access.can("settings")],
  ].filter(s => s[3]);
  const [sec, setSec] = useState(sections[0]?.[0] || "users");
  if (access.setupMissing) return (
    <div className="nk-page" style={{background:N.navy800,borderRadius:16,border:`1px solid ${N.border}`}}>
      <EmptyState icon="database" tone="warn" title="Roles & settings aren't set up in the database yet"
        text={<>Run <code style={{fontFamily:"JetBrains Mono, monospace",color:N.sky}}>supabase-roles-settings-scan.sql</code> in the Supabase SQL editor, then reload. Until then everyone keeps full access.</>}
        action={<button className="nk-btn nk-btn-ghost" onClick={access.loadAll}><Icon n="refresh" /> Check again</button>} />
    </div>
  );
  return (
    <div className="nk-page" style={{padding:"0 0 40px"}}>
      <div style={{marginBottom:16}}>
        <h2 style={{fontSize:20,fontWeight:800,color:N.text}}>Settings</h2>
        <p style={{fontSize:12,color:N.textDim,marginTop:2}}>People, permissions and the data the rest of the system uses</p>
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}} role="tablist">
        {sections.map(([k, l, ic]) => (
          <button key={k} role="tab" aria-selected={sec === k} style={{...segStyle(sec === k),display:"inline-flex",alignItems:"center",gap:6}} onClick={() => setSec(k)}>
            <Icon n={ic} /> {l}
          </button>
        ))}
      </div>
      {sec === "users"     && <UsersSettings access={access} askDialog={askDialog} myEmail={myEmail} />}
      {sec === "perms"     && <PermissionsSettings access={access} />}
      {sec === "templates" && <TemplatesSettings access={access} askDialog={askDialog} />}
      {sec === "senders"   && <SendersSettings access={access} askDialog={askDialog} />}
      {sec === "cards"     && <CardTypeSettings access={access} askDialog={askDialog} />}
      {sec === "general"   && <GeneralSettings access={access} />}
    </div>
  );
}

const card = { background:N.navy800, border:`1px solid ${N.border}`, borderRadius:14, padding:16, marginBottom:16 };

function UsersSettings({ access, askDialog, myEmail }) {
  const [editing, setEditing] = useState(null);   // null | {} (invite) | user row
  const [q, setQ] = useState("");
  useEffect(() => { access.loadUsers(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const iAmSuper = access.role === "superuser";
  const canEdit = access.can("users", "edit");
  const list = (access.users || []).filter(u => !q.trim() || [u.email, u.full_name, ROLE_LABEL[u.role]].filter(Boolean).join(" ").toLowerCase().includes(q.trim().toLowerCase()));
  const counts = (access.users || []).reduce((m, u) => (u.active ? { ...m, [u.role]: (m[u.role] || 0) + 1 } : m), {});
  const toggle = async (u) => {
    if (u.active && (await askDialog({ title: `Deactivate ${u.full_name || u.email}?`, body: "They are signed out of everything on their next action and can't sign in again until reactivated. Their history is kept.",
      actions: [{ value: "yes", label: "Deactivate", kind: "danger" }] })) !== "yes") return;
    await access.save("app_users", { email: u.email, role: u.role, active: !u.active }, "user", "email");
  };
  return (
    <>
      <div className="nk-stats">
        {ROLES.map(r => <div key={r.key} className="nk-stat"><div className="nk-stat-num" style={{color:TONE[ROLE_TONE[r.key]],fontSize:20}}>{counts[r.key] || 0}</div><div className="nk-stat-label">{r.label}</div></div>)}
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:10}}>
        <input className="nk-input" style={{flex:"1 1 220px",maxWidth:320,marginBottom:0}} placeholder="Search name, email or role…" value={q} onChange={e => setQ(e.target.value)} />
        <span style={{marginLeft:"auto"}} />
        {canEdit && <button className="nk-btn nk-btn-primary" onClick={() => setEditing({})}><Icon n="plus" /> Invite user</button>}
      </div>
      <div className="nk-table-wrap">
        <table className="nk-table">
          <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last seen</th><th>Invited by</th>{canEdit && <th></th>}</tr></thead>
          <tbody>
            {list.map(u => {
              const locked = u.role === "superuser" && !iAmSuper;
              return (
                <tr key={u.email} style={u.active ? undefined : { opacity: .55 }}>
                  <td><div style={{fontWeight:700,color:N.text}}>{u.full_name || "—"}{u.email === myEmail && <span style={{color:N.textDim,fontWeight:500}}> (you)</span>}</div>
                      <div style={{fontSize:11,color:N.textDim}}>{u.email}</div></td>
                  <td><RoleBadge role={u.role} /></td>
                  <td>{u.active ? (u.user_id ? <Pill tone="good">Active</Pill> : <Pill tone="info">Invited</Pill>) : <Pill tone="bad">Deactivated</Pill>}</td>
                  <td style={{fontSize:12,color:N.textMid}}>{u.last_seen_at ? fmtWhen(u.last_seen_at) : "Never"}</td>
                  <td style={{fontSize:12,color:N.textDim}}>{u.invited_by || "—"}</td>
                  {canEdit && (
                    <td><div className="nk-row-actions">
                      <Sb bg="transparent" col={N.sky} border={N.border} label={`Change role of ${u.email}`} disabled={locked}
                        title={locked ? "Only a Super Admin can change a Super Admin" : undefined} onClick={() => setEditing(u)}><Icon n="edit" /> Edit</Sb>
                      <Sb bg="transparent" col={u.active ? N.red : N.green} border={N.border} disabled={locked || u.email === myEmail}
                        label={`${u.active ? "Deactivate" : "Reactivate"} ${u.email}`} title={u.email === myEmail ? "You can't deactivate yourself" : undefined}
                        onClick={() => toggle(u)}><Icon n={u.active ? "ban" : "check"} /> {u.active ? "Deactivate" : "Reactivate"}</Sb>
                    </div></td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!access.users ? <EmptyState loading title="Loading users…" /> : !list.length && <EmptyState icon="users" title="No users match" />}
      </div>
      {editing && <UserModal initial={editing} iAmSuper={iAmSuper} busy={access.busy} onClose={() => setEditing(null)}
        onSave={async (form) => { if (await access.save("app_users", form, editing.email ? "user" : "invitation", "email")) setEditing(null); }} />}
    </>
  );
}

function UserModal({ initial, iAmSuper, busy, onSave, onClose }) {
  const isNew = !initial.email;
  const [form, setForm] = useState({ email: initial.email || "", full_name: initial.full_name || "", role: initial.role || "sales_officer", active: initial.active ?? true });
  const [errors, setErrors] = useState({});
  const submit = () => {
    const e = validateInvite(form, { allowSuperuser: iAmSuper });
    setErrors(e);
    if (!Object.keys(e).length) onSave({ ...form, email: form.email.trim().toLowerCase(), full_name: form.full_name.trim() || null });
  };
  return (
    <div className="nk-overlay">
      <div className="nk-modal" style={{maxWidth:560}} role="dialog" aria-modal="true" aria-labelledby="nk-user-title">
        <div className="nk-modal-head">
          <div className="nk-modal-title" id="nk-user-title">{isNew ? "Invite a user" : "Edit user"}</div>
          <button className="nk-modal-close" onClick={onClose} aria-label="Close" title="Close"><Icon n="x" /></button>
        </div>
        <div className="nk-modal-body">
          {isNew && <p style={{fontSize:12,color:N.textDim,marginBottom:14}}>They sign in with Google using this email. Anyone not invited is refused.</p>}
          <div className="nk-form-grid">
            <Field label="Email *" error={errors.email}>
              <input className="nk-input" type="email" autoFocus={isNew} disabled={!isNew} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="name@company.com" />
            </Field>
            <Field label="Full name">
              <input className="nk-input" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Shown in the user list" />
            </Field>
          </div>
          <Field label="Role *" error={errors.role}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))",gap:8,marginBottom:10}}>
              {ROLES.filter(r => iAmSuper || r.key !== "superuser").map(r => (
                <button key={r.key} type="button" onClick={() => setForm(f => ({ ...f, role: r.key }))} aria-pressed={form.role === r.key}
                  style={{textAlign:"left",padding:10,borderRadius:10,cursor:"pointer",fontFamily:"inherit",
                    background: form.role === r.key ? alpha(N.accent,"1f") : N.navy700, border:`1.5px solid ${form.role === r.key ? N.accent : N.border}`}}>
                  <div style={{fontWeight:700,color:N.text,fontSize:13}}>{r.label}</div>
                  <div style={{fontSize:11,color:N.textDim,marginTop:2}}>{r.description}</div>
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div className="nk-modal-foot">
          <button className="nk-btn nk-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="nk-btn nk-btn-primary" onClick={submit} disabled={busy}>{busy ? <Icon n="loader" /> : <Icon n="save" />} {isNew ? "Send invitation" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

// Roles × modules grid of None / View / Edit. Super Admin is fixed to everything.
function PermissionsSettings({ access }) {
  const editable = ROLES.filter(r => r.key !== "superuser");
  const [roleKey, setRoleKey] = useState(editable[0].key);
  const current = (access.matrix || DEFAULT_MATRIX)[roleKey] || {};
  // Unsaved edits belong to one role + one saved version; switching role or saving starts fresh
  const stamp = roleKey + JSON.stringify(current);
  const [pending, setPending] = useState(null);   // { stamp, perms }
  const draft = pending?.stamp === stamp ? pending.perms : current;
  const setDraft = (next) => setPending({ stamp, perms: typeof next === "function" ? next(draft) : next });
  const canEdit = access.can("users", "edit");
  const dirty = JSON.stringify(draft) !== JSON.stringify(current);
  const levels = [["", "None"], ["V", "View"], ["E", "Edit"]];
  return (
    <div style={card}>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
        {editable.map(r => <button key={r.key} style={segStyle(roleKey === r.key)} onClick={() => setRoleKey(r.key)}>{r.label}</button>)}
        <span style={{...segStyle(false),opacity:.7,cursor:"default",display:"inline-flex",alignItems:"center",gap:6}} title="Super Admins always have every permission, including deleting data"><Icon n="lock" /> Super Admin: everything</span>
      </div>
      <div style={{background:N.navy700,border:`1px solid ${N.border}`,borderRadius:10,padding:"10px 12px",marginBottom:12}}>
        <Toggle checked={!!(access.roleRows || []).find(r => r.key === roleKey)?.sees_all_events} disabled={!canEdit}
          onChange={v => access.setSeesAll(roleKey, v)} label={<><strong style={{color:N.text}}>Sees all events</strong> — otherwise only events they're assigned to or created</>} />
      </div>
      <p style={{fontSize:12,color:N.textDim,marginBottom:12}}>{ROLES.find(r => r.key === roleKey)?.description}. <strong style={{color:N.textMid}}>View</strong> shows the module; <strong style={{color:N.textMid}}>Edit</strong> also allows changes. The database enforces this too.</p>
      <div className="nk-table-wrap">
        <table className="nk-table">
          <thead><tr><th>Module</th><th>Access</th></tr></thead>
          <tbody>
            {MODULES.map(m => (
              <tr key={m.key}>
                <td style={{fontWeight:600,color:N.text}}>{m.label}</td>
                <td><div className="nk-row-actions" role="radiogroup" aria-label={`${m.label} access`}>
                  {levels.map(([v, l]) => {
                    const on = (draft[m.key] || "") === v;
                    return (
                      <button key={v} type="button" role="radio" aria-checked={on} disabled={!canEdit}
                        onClick={() => setDraft(d => { const n = { ...d }; if (v) n[m.key] = v; else delete n[m.key]; return n; })}
                        style={{...segStyle(on), padding:"5px 12px",
                          ...(on && v === "E" ? { color:N.green, borderColor:N.green } : on && v === "V" ? { color:N.sky, borderColor:N.sky } : {})}}>
                        {l}
                      </button>
                    );
                  })}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:14}}>
          <button className="nk-btn nk-btn-ghost" disabled={!dirty} onClick={() => setDraft(current)}>Undo changes</button>
          <button className="nk-btn nk-btn-ghost" onClick={() => setDraft(DEFAULT_MATRIX[roleKey] || {})}>Reset to default</button>
          <button className="nk-btn nk-btn-primary" disabled={!dirty || access.busy} onClick={() => access.savePermissions(roleKey, draft)}><Icon n="save" /> Save {ROLE_LABEL[roleKey]}</button>
        </div>
      )}
    </div>
  );
}

// One editable list (templates / sender IDs / card types) with an inline add/edit form
function ListEditor({ title, hint, rows, columns, blank, renderForm, validate, onSave, onDelete, onDefault, canEdit, busy, rowKey = "id", rowLabel }) {
  const canDelete = useCanDelete();
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const submit = async () => {
    const e = validate(form);
    setErrors(e);
    if (!Object.keys(e).length && await onSave(form)) setForm(null);
  };
  return (
    <div style={card}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:12,flexWrap:"wrap"}}>
        <div><div style={{fontWeight:800,color:N.text}}>{title}</div><div style={{fontSize:12,color:N.textDim,marginTop:2}}>{hint}</div></div>
        {canEdit && !form && <button className="nk-btn nk-btn-primary" style={{fontSize:12}} onClick={() => { setErrors({}); setForm({ ...blank }); }}><Icon n="plus" /> Add</button>}
      </div>
      {form && (
        <div style={{background:N.navy700,border:`1px solid ${N.accent}`,borderRadius:12,padding:14,marginBottom:12}}>
          {renderForm(form, setForm, errors)}
          <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
            <button className="nk-btn nk-btn-ghost" onClick={() => setForm(null)}>Cancel</button>
            <button className="nk-btn nk-btn-primary" onClick={submit} disabled={busy}><Icon n="save" /> Save</button>
          </div>
        </div>
      )}
      <div className="nk-table-wrap">
        <table className="nk-table">
          <thead><tr>{columns.map(c => <th key={c.h} className={c.num ? "num" : undefined}>{c.h}</th>)}{canEdit && <th></th>}</tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r[rowKey]} style={r.active === false ? { opacity: .55 } : undefined}>
                {columns.map(c => <td key={c.h} className={c.num ? "num" : undefined}>{c.cell(r)}</td>)}
                {canEdit && (
                  <td><div className="nk-row-actions">
                    {onDefault && !r.is_default && <Sb bg="transparent" col={N.amber} border={N.border} label={`Make ${rowLabel(r)} the default`} onClick={() => onDefault(r)}><Icon n="check" /> Default</Sb>}
                    <Sb bg="transparent" col={N.sky} border={N.border} label={`Edit ${rowLabel(r)}`} onClick={() => { setErrors({}); setForm({ ...r }); }}><Icon n="edit" /> Edit</Sb>
                    {canDelete && (<Sb bg="transparent" col={N.red} border={N.border} label={`Delete ${rowLabel(r)}`} onClick={() => onDelete(r)}><Icon n="trash" /> Delete</Sb>)}
                  </div></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <EmptyState icon="inbox" compact title="Nothing here yet" text={canEdit ? "Add the first one with + Add." : ""} />}
      </div>
    </div>
  );
}

const Toggle = ({ checked, onChange, label, disabled }) => (
  <label style={{display:"inline-flex",alignItems:"center",gap:8,fontSize:13,color:N.textMid,cursor:disabled ? "default" : "pointer",marginBottom:10}}>
    <input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)} style={{width:18,height:18,accentColor:"var(--nk-accent)"}} /> {label}
  </label>
);

const confirmDelete = async (askDialog, what) => (await askDialog({ title: `Delete ${what}?`, body: "This can't be undone.", actions: [{ value: "yes", label: "Delete", kind: "danger" }] })) === "yes";

function TemplatesSettings({ access, askDialog }) {
  const canEdit = access.can("settings", "edit");
  return (
    <ListEditor title="WhatsApp templates" canEdit={canEdit} busy={access.busy} rows={access.waTemplates} rowLabel={t => t.name}
      hint="Templates registered with the WhatsApp provider. The default is preselected; each event can choose its own in the WhatsApp tab."
      blank={{ name: "", label: "", account: "", has_image_header: true, preview: "", active: true, sort: access.waTemplates.length + 1 }}
      columns={[
        { h: "Template", cell: t => <><div style={{fontWeight:700,color:N.text,fontFamily:"JetBrains Mono, monospace"}}>{t.name}</div><div style={{fontSize:11,color:N.textDim}}>{t.label || "—"}</div></> },
        { h: "Account",  cell: t => t.account || <span style={{color:N.textDim}}>{access.settings.wa_account} (default)</span> },
        { h: "Card image", cell: t => t.has_image_header ? <Pill tone="good">Yes</Pill> : <Pill tone="info">No</Pill> },
        { h: "Status",   cell: t => <>{t.is_default && <Pill tone="warn">Default</Pill>} {t.active ? <Pill tone="good">Active</Pill> : <Pill tone="bad">Off</Pill>}</> },
      ]}
      validate={f => validateTemplate(f, access.waTemplates)}
      onSave={f => access.save("wa_templates", { id: f.id, name: f.name.trim(), label: f.label?.trim() || null, account: f.account?.trim() || null,
        has_image_header: !!f.has_image_header, preview: f.preview?.trim() || null, active: !!f.active, sort: Number(f.sort) || 0 }, "template")}
      onDelete={async t => (await confirmDelete(askDialog, `template ${t.name}`)) && access.remove("wa_templates", t.id, "template")}
      onDefault={t => access.makeDefault("wa_templates", t.id)}
      renderForm={(f, set, e) => (
        <>
          <div className="nk-form-grid">
            <Field label="Template name *" error={e.name}><input className="nk-input" autoFocus value={f.name} onChange={x => set(v => ({ ...v, name: x.target.value }))} placeholder="Exactly as registered, e.g. Mwaliko" /></Field>
            <Field label="Label"><input className="nk-input" value={f.label || ""} onChange={x => set(v => ({ ...v, label: x.target.value }))} placeholder="Shown to staff" /></Field>
            <Field label="Provider account"><input className="nk-input" value={f.account || ""} onChange={x => set(v => ({ ...v, account: x.target.value }))} placeholder={`Default: ${access.settings.wa_account}`} /></Field>
            <Field label="Order"><input className="nk-input" type="number" value={f.sort ?? 0} onChange={x => set(v => ({ ...v, sort: x.target.value }))} /></Field>
            <Field label="Preview text" span><textarea className="nk-input nk-textarea" rows={2} value={f.preview || ""} onChange={x => set(v => ({ ...v, preview: x.target.value }))} placeholder="What the guest reads (for reference)" /></Field>
          </div>
          <Toggle checked={f.has_image_header} onChange={c => set(v => ({ ...v, has_image_header: c }))} label="Sends the guest's card image" />{" "}
          <Toggle checked={f.active} onChange={c => set(v => ({ ...v, active: c }))} label="Active" />
        </>
      )} />
  );
}

function SendersSettings({ access, askDialog }) {
  const canEdit = access.can("settings", "edit");
  return (
    <ListEditor title="SMS sender IDs" canEdit={canEdit} busy={access.busy} rows={access.senderIds} rowLabel={s => s.sender_id}
      hint="The name guests see as the SMS sender (must be approved by the SMS provider). Each event can choose its own in the SMS tab."
      blank={{ sender_id: "", label: "", active: true }}
      columns={[
        { h: "Sender ID", cell: s => <span style={{fontWeight:700,color:N.text,fontFamily:"JetBrains Mono, monospace"}}>{s.sender_id}</span> },
        { h: "Label",     cell: s => s.label || "—" },
        { h: "Status",    cell: s => <>{s.is_default && <Pill tone="warn">Default</Pill>} {s.active ? <Pill tone="good">Active</Pill> : <Pill tone="bad">Off</Pill>}</> },
      ]}
      validate={f => validateSenderId(f, access.senderIds)}
      onSave={f => access.save("sender_ids", { id: f.id, sender_id: f.sender_id.trim(), label: f.label?.trim() || null, active: !!f.active }, "sender ID")}
      onDelete={async s => (await confirmDelete(askDialog, `sender ID ${s.sender_id}`)) && access.remove("sender_ids", s.id, "sender ID")}
      onDefault={s => access.makeDefault("sender_ids", s.id)}
      renderForm={(f, set, e) => (
        <>
          <div className="nk-form-grid">
            <Field label="Sender ID *" error={e.sender_id}><input className="nk-input" autoFocus maxLength={11} value={f.sender_id} onChange={x => set(v => ({ ...v, sender_id: x.target.value }))} placeholder="Up to 11 characters, e.g. NIKADI" /></Field>
            <Field label="Label"><input className="nk-input" value={f.label || ""} onChange={x => set(v => ({ ...v, label: x.target.value }))} /></Field>
          </div>
          <Toggle checked={f.active} onChange={c => set(v => ({ ...v, active: c }))} label="Active" />
        </>
      )} />
  );
}

// Card types → people admitted at the door, with a live preview of the rule
function CardTypeSettings({ access, askDialog }) {
  const canEdit = access.can("settings", "edit");
  const [tryType, setTryType] = useState("Double");
  const n = peopleForCardType(tryType, access.cardRules, access.settings);
  return (
    <>
      <div style={card}>
        <div style={{fontWeight:800,color:N.text,marginBottom:4}}>How the door counts people</div>
        <ol style={{fontSize:12,color:N.textMid,paddingLeft:18,lineHeight:1.7,marginBottom:12}}>
          <li>A card type listed below admits that many people (the name is matched ignoring capitals).</li>
          <li>{access.settings.numeric_card_types ? <>A card type that is just a number (“5”) admits that many.</> : <>Numbers as card types are <strong>off</strong>.</>}</li>
          <li>Anything else admits <strong>{peopleLabel(Number(access.settings.default_people) || 1)}</strong>.</li>
        </ol>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <label className="nk-label" style={{margin:0}} htmlFor="nk-try-type">Try a card type</label>
          <input id="nk-try-type" className="nk-input" style={{maxWidth:200,marginBottom:0}} value={tryType} onChange={e => setTryType(e.target.value)} />
          <span style={{fontSize:14,fontWeight:800,color:N.green}}><Icon n="arrowRight" /> {peopleLabel(n)}</span>
        </div>
        <div style={{display:"flex",gap:18,flexWrap:"wrap",marginTop:14}}>
          <Toggle checked={access.settings.numeric_card_types} disabled={!canEdit} onChange={c => access.saveSetting("numeric_card_types", c)} label="Numbers count as people (e.g. “5” = 5)" />
          <label style={{display:"inline-flex",alignItems:"center",gap:8,fontSize:13,color:N.textMid}}>
            Other card types admit
            <input type="number" min={1} max={100} className="nk-input" style={{width:80,marginBottom:0}} disabled={!canEdit}
              defaultValue={access.settings.default_people} onBlur={e => { const v = Math.max(1, Number(e.target.value) || 1); if (v !== Number(access.settings.default_people)) access.saveSetting("default_people", v); }} />
            people
          </label>
        </div>
        <p style={{fontSize:11,color:N.textDim,marginTop:8}}>Changes apply to every existing card at once (cards never drop below what has already been scanned).</p>
      </div>
      <ListEditor title="Card types" canEdit={canEdit} busy={access.busy} rows={access.cardRules} rowLabel={r => r.name}
        hint="Write the card type exactly as it appears in your guest lists, e.g. Single, Double, VIP Table."
        blank={{ name: "", people: 1, label: "", sort: access.cardRules.length + 1 }}
        columns={[
          { h: "Card type", cell: r => <span style={{fontWeight:700,color:N.text}}>{r.name}</span> },
          { h: "Admits", num: true, cell: r => <strong style={{color:N.green}}>{peopleLabel(r.people)}</strong> },
          { h: "Note", cell: r => r.label || "—" },
        ]}
        validate={f => validateCardRule(f, access.cardRules)}
        onSave={f => access.save("card_type_rules", { id: f.id, name: f.name.trim(), people: Number(f.people), label: f.label?.trim() || null, sort: Number(f.sort) || 0 }, "card type")}
        onDelete={async r => (await confirmDelete(askDialog, `card type ${r.name}`)) && access.remove("card_type_rules", r.id, "card type")}
        renderForm={(f, set, e) => (
          <div className="nk-form-grid">
            <Field label="Card type *" error={e.name}><input className="nk-input" autoFocus value={f.name} onChange={x => set(v => ({ ...v, name: x.target.value }))} placeholder="e.g. Double" /></Field>
            <Field label="People admitted *" error={e.people}><input className="nk-input" type="number" min={1} max={1000} value={f.people} onChange={x => set(v => ({ ...v, people: x.target.value }))} /></Field>
            <Field label="Note" span><input className="nk-input" value={f.label || ""} onChange={x => set(v => ({ ...v, label: x.target.value }))} placeholder="Optional, e.g. couple" /></Field>
          </div>
        )} />
    </>
  );
}

function GeneralSettings({ access }) {
  const canEdit = access.can("settings", "edit");
  const fields = [
    ["org_name", "Organisation name", "Shown on reports"],
    ["country_code", "Default country code", "Local numbers like 0712… get this prefix (Tanzania = 255)"],
    ["wa_account", "WhatsApp provider account", "Used by templates that don't name their own account"],
  ];
  return (
    <div style={card}>
      {fields.map(([k, l, hint]) => (
        <div key={k} style={{marginBottom:14,maxWidth:420}}>
          <label className="nk-label" htmlFor={`nk-set-${k}`}>{l}</label>
          <input id={`nk-set-${k}`} className="nk-input" disabled={!canEdit} defaultValue={access.settings[k] ?? ""}
            onBlur={e => { const v = e.target.value.trim(); if (v && v !== String(access.settings[k] ?? "")) access.saveSetting(k, v); }} />
          <div style={{fontSize:11,color:N.textDim,marginTop:-6}}>{hint}</div>
        </div>
      ))}
      <p style={{fontSize:11,color:N.textDim}}>Changes save when you leave a field.</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SCANNER & CALLS — <ScannerTab> (door check-in for signed-in staff, live
   totals, share the public scan page) and <CallsTab> (guest confirmation calls).
   Check-ins only ever go through the scan_card() database function.
══════════════════════════════════════════════════════════════════════════ */
const CARD_COLS = "id,name,card_type,phone,wa_status,sms_status,max_scans,scan_count,last_scanned_at,call_status,call_comment,call_updated_at,call_by";

// The open event's cards from the database, kept live with realtime updates
function useEventCards(eventId) {
  const [cards, setCards] = useState(null);
  const [error, setError] = useState(null);
  const load = async () => {
    if (!supabase || !eventId) { setCards(null); return; }
    const { data, error: e } = await supabase.from("event_cards").select(CARD_COLS).eq("event_id", eventId).order("name");
    if (e) { setError(e.message); setCards([]); return; }
    setError(null); setCards(data);
  };
  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect -- loads data from the database
    if (!supabase || !eventId) return;
    const ch = supabase.channel(`cards-${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_cards", filter: `event_id=eq.${eventId}` }, (p) => {
        if (p.eventType === "DELETE") { setCards(cs => cs && cs.filter(c => c.id !== p.old.id)); return; }
        const row = p.new;
        setCards(cs => !cs ? cs : cs.some(c => c.id === row.id) ? cs.map(c => c.id === row.id ? { ...c, ...row } : c) : [...cs, row]);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps
  const patch = (id, changes) => setCards(cs => cs && cs.map(c => c.id === id ? { ...c, ...changes } : c));
  return { cards, error, load, patch };
}

const NoEventOpen = ({ what, onGo }) => (
  <EmptyState icon="folder" title="No event open" text={`${what} works on one event at a time. Open the event first.`}
    action={<button className="nk-btn nk-btn-primary" onClick={() => onGo("events")}><Icon n="folder" /> Go to Events</button>} />
);

function ScannerTab({ eventId, eventRow, access, myEmail, showToast, onGo, reloadEvents, logHistory }) {
  const { cards, error, load, patch } = useEventCards(eventId);
  const [commenting, setCommenting] = useState(null);
  const canComment = access.setupMissing || access.can("calls", "edit") || access.can("scanner", "edit");
  // Saves a guest comment (same field as the Calls tab) and logs it to the event history
  const saveComment = async (c, text) => {
    const next = { call_comment: text || null, call_updated_at: new Date().toISOString(), call_by: myEmail };
    const before = { call_comment: c.call_comment, call_updated_at: c.call_updated_at, call_by: c.call_by };
    patch(c.id, next);
    const { error: e } = await supabase.from("event_cards").update(next).eq("id", c.id);
    if (e) { patch(c.id, before); showToast(`Could not save the comment: ${e.message}`, "warn"); return; }
    logHistory?.({ channel: "calls", action: "call", status: c.call_status || "ok", name: c.name, phone: c.phone, detail: `Comment: ${text || "(removed)"}` }, eventId);
    setCommenting(null);
  };
  const [recent, setRecent] = useState([]);
  const [sharing, setSharing] = useState(false);
  const canScan = access.can("scanner", "edit");
  const loadRecent = async () => {
    if (!eventId) return;
    const { data } = await supabase.from("scan_logs").select("*").eq("event_id", eventId).order("scanned_at", { ascending: false }).limit(15);
    setRecent(data || []);
  };
  useEffect(() => { loadRecent(); }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect -- loads data from the database
  if (!eventId) return <div className="nk-page"><NoEventOpen what="The scanner" onGo={onGo} /></div>;
  if (error) return (
    <div className="nk-page" style={{background:N.navy800,borderRadius:16,border:`1px solid ${N.border}`}}>
      <EmptyState icon="database" tone="warn" title="Scanning isn't set up in the database yet"
        text={<>Run <code style={{fontFamily:"JetBrains Mono, monospace",color:N.sky}}>supabase-roles-settings-scan.sql</code>, then retry.<br /><span style={{fontSize:11,fontFamily:"JetBrains Mono, monospace"}}>{error}</span></>}
        action={<button className="nk-btn nk-btn-ghost" onClick={load}><Icon n="refresh" /> Retry</button>} />
    </div>
  );
  const totals = scanTotals(cards || []);
  const counts = guestCounts(cards || []);
  const byId = Object.fromEntries((cards || []).map(c => [c.id, c]));
  const findCard = async ({ id, name, cardType }) => {
    if (id) {
      const { data } = await supabase.from("event_cards").select(CARD_COLS).eq("id", id).eq("event_id", eventId).maybeSingle();
      return data ? [data] : [];
    }
    return matchByName(cards || [], { name, cardType });
  };
  const search = async (q) => (cards || []).filter(c => String(c.name || "").toLowerCase().includes(q.toLowerCase())).slice(0, 20);
  const checkIn = async (c, count, method) => {
    const { data, error: e } = await supabase.rpc("scan_card", { p_card_id: c.id, p_method: method, p_count: count, p_scanned_by: myEmail });
    if (e) throw e;
    loadRecent();
    return data?.[0] || {};
  };
  return (
    <div className="nk-page" style={{padding:"0 0 40px",maxWidth:1200}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:16,flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:800,color:N.text}}>Door check-in</h2>
          <p style={{fontSize:12,color:N.textDim,marginTop:2}}>{eventRow?.username} · scan the QR code on each card, or search by name</p>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={() => { load(); loadRecent(); }}><Icon n="refresh" /> Refresh</button>
          {canScan && <button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={() => setSharing(true)}><Icon n="link" /> Share scan page{eventRow?.scan_code ? " (on)" : ""}</button>}
        </div>
      </div>
      <div className="nk-stats">
        <MoneyTile label="People entered" value={`${totals.entered} / ${totals.people}`} tone="good" sub={totals.people ? `${Math.round(totals.entered / totals.people * 100)}% arrived` : null} />
        <MoneyTile label="Cards fully used" value={`${totals.complete} / ${totals.cards}`} tone="info" />
        <MoneyTile label="Still expected" value={Math.max(0, totals.people - totals.entered)} tone="warn" />
        <MoneyTile label="Guests scanned" value={`${counts.scanned} / ${totals.cards}`} tone="good" sub={`${counts.waiting} not scanned yet`} />
      </div>
      {cards === null ? <EmptyState loading title="Loading guest list…" />
        : !cards.length ? <EmptyState icon="table" title="No guests saved for this event" text="Import the guest list in Design and press Save Cards to DB." action={<button className="nk-btn nk-btn-ghost" onClick={() => onGo("design")}><Icon n="palette" /> Go to Design</button>} />
        : <ScanPanel findCard={findCard} search={search} checkIn={checkIn} scannerName={myEmail} disabled={!canScan} disabledReason="Your role can view check-ins but not admit guests."
            renderBelow={({ begin, busy }) => <GuestList cards={cards} canScan={canScan} busy={busy} onCheckIn={c => begin(c, "manual")} onComment={canComment ? setCommenting : null} />} />}
      {commenting && <CommentModal card={commenting} onClose={() => setCommenting(null)} onSave={(text) => saveComment(commenting, text)} />}
      {recent.length > 0 && (
        <div className="nk-table-wrap" style={{marginTop:16}}>
          <table className="nk-table">
            <thead><tr><th>Time</th><th>Guest</th><th className="num">People</th><th>Result</th><th>By</th></tr></thead>
            <tbody>
              {recent.map(r => (
                <tr key={r.id}>
                  <td style={{fontSize:12,color:N.textDim}}>{fmtWhen(r.scanned_at)}</td>
                  <td style={{fontWeight:600}}>{byId[r.event_card_id]?.name || "Unknown card"}</td>
                  <td className="num">{r.people}</td>
                  <td>{r.accepted ? <Pill tone="good">Admitted</Pill> : <Pill tone="bad">{SCAN_REASON[r.reason] || r.reason}</Pill>}</td>
                  <td style={{fontSize:12,color:N.textDim}}>{r.scanned_by || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sharing && <ShareScanModal eventRow={eventRow} showToast={showToast} onClose={() => setSharing(false)} reloadEvents={reloadEvents} />}
    </div>
  );
}

// Scanner guest list: every saved card for the event (sent or only uploaded), with live scan
// state. Filters as you type and by state; "Check in" uses ScanPanel's flow (count prompt).
const GUEST_FILTERS = [["all", "All"], ["waiting", "Not scanned"], ["partial", "Partly in"], ["complete", "Fully in"], ["entered", "Scanned"]];
function GuestList({ cards = [], canScan, busy, onCheckIn, onComment }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState("all");
  const rows = filterGuests(cards, { q, state });
  const count = (k) => k === "all" ? cards.length : filterGuests(cards, { state: k }).length;
  const tone = { pending: "warn", partial: "info", complete: "good" };
  const word = { pending: "Not scanned", partial: "Partly in", complete: "Fully in" };
  return (
    <div style={{marginTop:16}}>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:10}}>
        <h3 style={{fontSize:15,fontWeight:800,color:N.text,marginRight:"auto"}}>Guest list</h3>
        <div style={{position:"relative",flex:"1 1 220px",maxWidth:320}}>
          <input className="nk-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by name, card type or phone" aria-label="Filter guests" style={{width:"100%"}} />
        </div>
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}} role="group" aria-label="Show guests">
        {GUEST_FILTERS.map(([k, l]) => (
          <button key={k} className={`nk-btn ${state === k ? "nk-btn-primary" : "nk-btn-ghost"}`} style={{fontSize:12,padding:"5px 10px"}}
            aria-pressed={state === k} onClick={() => setState(k)}>{l} ({count(k)})</button>
        ))}
      </div>
      {!rows.length ? <EmptyState compact icon="search" title="No guests match" text="Change the filter or clear the search." /> : (
        <div className="nk-table-wrap">
          <table className="nk-table">
            <thead><tr><th>Guest</th><th>Card type</th><th>Phone</th><th>Card</th><th className="num">Entered</th><th>Status</th><th>Comment</th><th>Last scan</th><th></th></tr></thead>
            <tbody>
              {rows.map(c => {
                const st = scanStatus(c.scan_count, c.max_scans);
                return (
                  <tr key={c.id}>
                    <td style={{fontWeight:600}}>{c.name || "—"}</td>
                    <td>{c.card_type || "—"}</td>
                    <td style={{fontSize:12,color:N.textDim}}>{c.phone || "—"}</td>
                    <td>{cardSource(c) === "sent" ? <Pill tone="good">Sent</Pill> : <Pill tone="info">Uploaded</Pill>}</td>
                    <td className="num">{c.scan_count || 0} / {c.max_scans || 1}</td>
                    <td><Pill tone={tone[st]}>{word[st]}</Pill></td>
                    <td>
                      <div className="nk-row-actions">
                        <span style={{maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:12,color:c.call_comment ? N.textMid : N.textDim}}>{c.call_comment || "—"}</span>
                        {onComment && <Sb bg="transparent" col={N.sky} border={N.border} label={`${c.call_comment ? "Edit" : "Add"} comment for ${c.name}`} onClick={() => onComment(c)}><Icon n="note" /></Sb>}
                      </div>
                    </td>
                    <td style={{fontSize:12,color:N.textDim}}>{c.last_scanned_at ? fmtWhen(c.last_scanned_at) : "—"}</td>
                    <td>{canScan && (
                      <Sb bg="transparent" col={N.green} border={N.border} label={st === "complete" ? `Everyone on ${c.name}'s card has entered` : `Check in ${c.name} (${placesLeft(c.scan_count, c.max_scans)} left)`}
                        disabled={busy || st === "complete"} onClick={() => onCheckIn(c)}><Icon n="check" /></Sb>
                    )}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// "Change template" pop-up: saved card templates as thumbnails, or upload a new image.
// "Keep my element positions" reuses the current layout instead of the template's own.
function TemplatePicker({ templates = [], currentUrl, currentImage, hasDesign, onPick, onClose }) {
  const [keepLayout, setKeepLayout] = useState(false);
  const [busy, setBusy] = useState(false);
  const pick = async (choice) => { setBusy(true); const done = await onPick(choice, { keepLayout }); if (!done) setBusy(false); };
  return (
    <DetailModal label="Change card template" onClose={onClose} width={760}>
      <div style={{fontSize:18,fontWeight:800,color:N.text,marginBottom:4}}>{hasDesign ? "Change card template" : "Choose a card template"}</div>
      <p style={{fontSize:12,color:N.textDim,marginBottom:14}}>Pick a saved design or upload a new background. The guest list, messages and statuses are not changed.</p>
      {hasDesign && (
        <label style={{display:"flex",gap:8,alignItems:"center",fontSize:13,color:N.textMid,marginBottom:14,cursor:"pointer"}}>
          <input type="checkbox" checked={keepLayout} onChange={e => setKeepLayout(e.target.checked)} />
          Keep my current element positions (name, QR, date…) instead of the template's own
        </label>
      )}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))",gap:12}}>
        <label className="nk-upload" style={{margin:0,minHeight:180,justifyContent:"center",cursor:busy ? "wait" : "pointer"}}>
          <input type="file" accept="image/*" style={{display:"none"}} disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) pick({ file: f }); }} />
          <span className="nk-upload-icon"><Icon n="upload" /></span>
          <span className="nk-upload-label">Upload new image</span>
          <span className="nk-upload-sub">PNG · JPG · SVG</span>
        </label>
        {templates.map(t => {
          const current = !!currentUrl && t.cover_image_url === currentUrl;
          return (
            <button key={t.id} type="button" disabled={busy || current} onClick={() => pick({ tpl: t })}
              title={current ? "This is the current template" : `Use "${t.name}"`}
              style={{display:"flex",flexDirection:"column",gap:6,padding:8,borderRadius:12,cursor:busy ? "wait" : current ? "default" : "pointer",textAlign:"left",fontFamily:"inherit",
                background:N.navy700,border:`2px solid ${current ? N.green : N.border}`,color:N.text}}>
              <div style={{width:"100%",aspectRatio:"3 / 4",borderRadius:8,overflow:"hidden",background:N.navy900,display:"grid",placeItems:"center"}}>
                {t.cover_image_url ? <img src={t.cover_image_url} alt="" loading="lazy" style={{width:"100%",height:"100%",objectFit:"cover"}} />
                  : <Icon n="image" size="28px" />}
              </div>
              <div style={{fontSize:12,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",width:"100%"}}>{t.name}</div>
              {current && <span style={{fontSize:10,fontWeight:700,color:N.green}}><Icon n="check" /> Current</span>}
            </button>
          );
        })}
      </div>
      {!templates.length && <p style={{fontSize:12,color:N.textDim,marginTop:12}}>No saved templates yet — upload an image, then use "Save as Template" to reuse it on other events.</p>}
      {currentImage && !currentUrl && <p style={{fontSize:11,color:N.textDim,marginTop:12}}>The current design isn't saved as a template. Save it first if you may want it back.</p>}
      {busy && <div style={{fontSize:12,color:N.textDim,marginTop:12}} role="status"><Icon n="loader" /> Loading template…</div>}
      <div style={{display:"flex",justifyContent:"flex-end",marginTop:16}}>
        <button className="nk-btn nk-btn-ghost" onClick={onClose}>Close</button>
      </div>
    </DetailModal>
  );
}

// WhatsApp tab: how much the wa-cards bucket holds (wa_cards_usage RPC) and, for Super
// Admins, clearing every stored card image (names via wa_cards_names, removed through the
// Storage API in batches of 100). Cards must be uploaded again before the next send.
const fmtBytes = (b) => !b ? "0 B" : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`;
function CardStoragePanel({ canClear, askDialog, showToast, onCleared }) {
  const [usage, setUsage] = useState(null);     // { files, bytes, oldest, newest } | null = loading
  const [error, setError] = useState(null);
  const [clearing, setClearing] = useState(null); // { done, total } while clearing
  const load = async () => {
    if (!supabase) return;
    setError(null);
    const { data, error: e } = await supabase.rpc("wa_cards_usage");
    if (e) { setUsage({}); setError(/wa_cards_usage|schema cache/i.test(e.message) ? "Run the latest supabase-schema.sql to see storage use." : e.message); return; }
    const r = data?.[0] || {};
    setUsage({ files: Number(r.files) || 0, bytes: Number(r.bytes) || 0, oldest: r.oldest, newest: r.newest });
  };
  useEffect(() => { load(); }, []);
  const clearAll = async () => {
    const ok = await askDialog({
      title: "Clear all WhatsApp card images?",
      body: `This deletes all ${usage.files} stored card image${usage.files === 1 ? "" : "s"} (${fmtBytes(usage.bytes)}) for every event. Messages already delivered are not affected, but cards must be uploaded again before sending more — and any message still waiting to be delivered may arrive without its image.`,
      actions: [{ value: "yes", label: "Clear all images", kind: "danger" }],
    });
    if (ok !== "yes") return;
    let done = 0;
    setClearing({ done, total: usage.files });
    try {
      for (let guard = 0; guard < 500; guard++) {
        const { data, error: e } = await supabase.rpc("wa_cards_names", { p_limit: 1000 });
        if (e) throw e;
        const names = (data || []).map(r => r.name);
        if (!names.length) break;
        for (let i = 0; i < names.length; i += 100) {
          const { error: re } = await supabase.storage.from("wa-cards").remove(names.slice(i, i + 100));
          if (re) throw re;
          done += Math.min(100, names.length - i);
          setClearing({ done, total: usage.files });
        }
      }
      showToast(`Cleared ${done} card image${done === 1 ? "" : "s"}`, "success");
      onCleared?.();
    } catch (e) {
      showToast(`Clearing stopped after ${done} file${done === 1 ? "" : "s"}: ${e.message}`, "warn");
    } finally { setClearing(null); load(); }
  };
  return (
    <div className="nk-chip" style={{marginTop:20,fontSize:12,lineHeight:1.7}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
        <strong style={{color:N.text,flex:1}}><Icon n="database" /> Card image storage</strong>
        <button className="nk-btn-sm icon-only" onClick={load} disabled={!!clearing} aria-label="Refresh storage size" title="Refresh storage size"
          style={{background:"transparent",color:N.sky,border:`1px solid ${N.border}`,width:26,height:26,padding:0,justifyContent:"center",borderRadius:6,cursor:"pointer"}}><Icon n="refresh" /></button>
      </div>
      {usage === null ? <div style={{color:N.textDim}}><Icon n="loader" /> Checking…</div>
        : error ? <div style={{color:N.amber}}>{error}</div>
        : <>
            <div style={{fontSize:20,fontWeight:800,color:N.text}}>{fmtBytes(usage.bytes)}</div>
            <div style={{color:N.textDim}}>{usage.files.toLocaleString()} image{usage.files === 1 ? "" : "s"} in Supabase (wa-cards)</div>
            {usage.oldest && <div style={{color:N.textDim,fontSize:11}}>Oldest {fmtWhen(usage.oldest)} · newest {fmtWhen(usage.newest)}</div>}
          </>}
      {clearing && (
        <div style={{marginTop:8}} role="status">
          <div style={{height:6,borderRadius:3,background:N.navy900,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${clearing.total ? Math.min(100, clearing.done / clearing.total * 100) : 100}%`,background:N.red,transition:"width .3s"}} />
          </div>
          <div style={{fontSize:11,color:N.textDim,marginTop:4}}><Icon n="loader" /> Deleting {clearing.done} / {clearing.total}…</div>
        </div>
      )}
      {canClear && usage?.files > 0 && !clearing && (
        <button className="nk-btn nk-btn-ghost nk-btn-full" style={{fontSize:12,marginTop:8,color:N.red,borderColor:alpha(N.red,"55")}} onClick={clearAll}>
          <Icon n="trash" /> Clear all card images
        </button>
      )}
      {!canClear && usage?.files > 0 && <div style={{fontSize:11,color:N.textDim,marginTop:6}}>Only a Super Admin can clear stored images.</div>}
    </div>
  );
}

// Turns the public, view-only report link (#/view/<id>: guests, calls + comments, card
// history; phones masked) on/off. Uses set_view_code() so Tele Sales etc. can share too.
function ShareViewModal({ eventRow, showToast, onClose, reloadEvents }) {
  const [code, setCode] = useState(eventRow?.view_code || null);
  const [busy, setBusy] = useState(false);
  const link = `${window.location.origin}${import.meta.env.BASE_URL}#/view/${eventRow?.id}`;
  const setViewCode = async (value) => {
    setBusy(true);
    const { error } = await supabase.rpc("set_view_code", { p_event: eventRow.id, p_code: value });
    setBusy(false);
    if (error) { showToast(/set_view_code|schema cache/i.test(error.message) ? "Sharing isn't set up yet — run the latest supabase-schema.sql" : `Could not update the link: ${error.message}`, "warn"); return; }
    setCode(value); reloadEvents?.();
    showToast(value ? "View-only link is on — share the link and code" : "View-only link turned off", "success");
  };
  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); showToast(`${what} copied`, "success"); }
    catch { showToast(`Copy didn't work — select the ${what.toLowerCase()} and copy it by hand`, "warn"); }
  };
  return (
    <DetailModal label="Share view-only link" onClose={onClose} width={560}>
      <div style={{fontSize:18,fontWeight:800,color:N.text,marginBottom:4}}>Share view-only link</div>
      <p style={{fontSize:12,color:N.textDim,marginBottom:16}}>Anyone with the link and code can see this event's guest list (card sent, call answers and comments, check-in) and its card history. They can't change anything, and phone numbers are partly hidden.</p>
      {code ? (
        <>
          <div className="nk-guide-block"><div className="nk-guide-block-label">Link</div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}><code style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:12,color:N.sky}}>{link}</code>
              <Sb bg="transparent" col={N.sky} border={N.border} label="Copy link" onClick={() => copy(link, "Link")}><Icon n="copy" /></Sb></div></div>
          <div className="nk-guide-block"><div className="nk-guide-block-label">Code</div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}><span style={{flex:1,fontSize:28,fontWeight:800,letterSpacing:6,fontFamily:"JetBrains Mono, monospace",color:N.text}}>{code}</span>
              <Sb bg="transparent" col={N.sky} border={N.border} label="Copy code" onClick={() => copy(code, "Code")}><Icon n="copy" /></Sb></div></div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end",marginTop:12}}>
            <button className="nk-btn nk-btn-ghost" disabled={busy} onClick={() => setViewCode(null)}><Icon n="ban" /> Turn off</button>
            <button className="nk-btn nk-btn-ghost" disabled={busy} onClick={() => setViewCode(newScanCode())} title="The old code stops working immediately"><Icon n="refresh" /> New code</button>
            <button className="nk-btn nk-btn-primary" onClick={onClose}>Done</button>
          </div>
        </>
      ) : (
        <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
          <button className="nk-btn nk-btn-ghost" onClick={onClose}>Close</button>
          <button className="nk-btn nk-btn-primary" disabled={busy} onClick={() => setViewCode(newScanCode())}><Icon n="link" /> Turn on & create code</button>
        </div>
      )}
    </DetailModal>
  );
}

// Turns the public, code-protected scan page on/off for an event and shows its link + code
function ShareScanModal({ eventRow, showToast, onClose, reloadEvents }) {
  const [code, setCode] = useState(eventRow?.scan_code || null);
  const [busy, setBusy] = useState(false);
  const link = `${window.location.origin}${import.meta.env.BASE_URL}#/scan/${eventRow?.id}`;
  const setScanCode = async (value) => {
    setBusy(true);
    const { error } = await supabase.from("events").update({ scan_code: value }).eq("id", eventRow.id);
    setBusy(false);
    if (error) { showToast(`Could not update the scan page: ${error.message}`, "warn"); return; }
    setCode(value); reloadEvents();
    showToast(value ? "Scan page is on — share the link and code with the door staff" : "Scan page turned off", "success");
  };
  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); showToast(`${what} copied`, "success"); }
    catch { showToast(`Copy didn't work — select the ${what.toLowerCase()} and copy it by hand`, "warn"); }
  };
  return (
    <DetailModal label="Share the scan page" onClose={onClose} width={560}>
      <div style={{fontSize:18,fontWeight:800,color:N.text,marginBottom:4}}>Share the scan page</div>
      <p style={{fontSize:12,color:N.textDim,marginBottom:16}}>Door staff without an account open this link on their phone and enter the code. They can only check guests in — they can't see phone numbers or anything else.</p>
      {code ? (
        <>
          <div className="nk-guide-block"><div className="nk-guide-block-label">Link</div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}><code style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:12,color:N.sky}}>{link}</code>
              <Sb bg="transparent" col={N.sky} border={N.border} label="Copy link" onClick={() => copy(link, "Link")}><Icon n="copy" /></Sb></div></div>
          <div className="nk-guide-block"><div className="nk-guide-block-label">Code</div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}><span style={{flex:1,fontSize:28,fontWeight:800,letterSpacing:6,fontFamily:"JetBrains Mono, monospace",color:N.text}}>{code}</span>
              <Sb bg="transparent" col={N.sky} border={N.border} label="Copy code" onClick={() => copy(code, "Code")}><Icon n="copy" /></Sb></div></div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end",marginTop:12}}>
            <button className="nk-btn nk-btn-ghost" disabled={busy} onClick={() => setScanCode(null)}><Icon n="ban" /> Turn off</button>
            <button className="nk-btn nk-btn-ghost" disabled={busy} onClick={() => setScanCode(newScanCode())} title="The old code stops working immediately"><Icon n="refresh" /> New code</button>
            <button className="nk-btn nk-btn-primary" onClick={onClose}>Done</button>
          </div>
        </>
      ) : (
        <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
          <button className="nk-btn nk-btn-ghost" onClick={onClose}>Close</button>
          <button className="nk-btn nk-btn-primary" disabled={busy} onClick={() => setScanCode(newScanCode())}><Icon n="link" /> Turn on & create code</button>
        </div>
      )}
    </DetailModal>
  );
}

// Guest confirmation calls: tap to call, record Picked / Busy → Coming / Not coming, add a comment
function CallsTab({ eventId, eventRow, access, myEmail, showToast, logHistory, onGo, reloadEvents }) {
  const { cards, error, load, patch } = useEventCards(eventId);
  const [filter, setFilter] = useState({ status: "all", q: "" });
  const [commenting, setCommenting] = useState(null);
  const [sharing, setSharing] = useState(false);
  const canShare = access.setupMissing || access.can("events", "edit") || access.can("calls", "edit") || access.can("history", "edit");
  const canEdit = access.can("calls", "edit");
  if (!eventId) return <div className="nk-page"><NoEventOpen what="Calls" onGo={onGo} /></div>;
  if (error) return (
    <div className="nk-page" style={{background:N.navy800,borderRadius:16,border:`1px solid ${N.border}`}}>
      <EmptyState icon="database" tone="warn" title="Call tracking isn't set up in the database yet"
        text={<>Run <code style={{fontFamily:"JetBrains Mono, monospace",color:N.sky}}>supabase-roles-settings-scan.sql</code>, then retry.</>}
        action={<button className="nk-btn nk-btn-ghost" onClick={load}><Icon n="refresh" /> Retry</button>} />
    </div>
  );
  const peopleOf = (c) => Number(c.max_scans) || peopleForCardType(c.card_type, access.cardRules, access.settings);
  const sum = summariseCalls(cards || [], peopleOf);
  const rows = filterCalls(cards || [], filter);
  const update = async (c, changes, log) => {
    const before = { call_status: c.call_status, call_comment: c.call_comment, call_updated_at: c.call_updated_at, call_by: c.call_by };
    const next = { ...changes, call_updated_at: new Date().toISOString(), call_by: myEmail };
    patch(c.id, next);
    const { error: e } = await supabase.from("event_cards").update(next).eq("id", c.id);
    if (e) { patch(c.id, before); showToast(`Could not save: ${e.message}`, "warn"); return false; }
    logHistory({ channel: "calls", action: "call", name: c.name, phone: c.phone, ...log }, eventId);
    return true;
  };
  const setStatus = (c, choice) => {
    const s = nextCallStatus(c.call_status, choice);
    update(c, { call_status: s }, { status: s || "ok", detail: s ? CALL_STATUSES[s].label : "Call status cleared" });
  };
  const exportCalls = async () => {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.json_to_sheet((cards || []).map(c => ({
      Name: c.name, "Card type": c.card_type, People: peopleOf(c), Phone: c.phone ? `+${normalisePhone(c.phone)}` : "",
      Status: c.call_status ? CALL_STATUSES[c.call_status].label : "Not called", Comment: c.call_comment || "",
      Updated: c.call_updated_at ? fmtWhen(c.call_updated_at) : "", By: c.call_by || "",
    })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Calls");
    XLSX.writeFile(wb, `${(eventRow?.username || "Event").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_")}_Calls_${localDate()}.xlsx`);
  };
  const filters = [["all", "All"], ["todo", "Not called"], ["picked", "Picked up"], ["busy", "Busy"], ["yes", "Coming"], ["no", "Not coming"]];
  return (
    <div className="nk-page" style={{padding:"0 0 40px",maxWidth:1200}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:16,flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:800,color:N.text}}>Guest calls</h2>
          <p style={{fontSize:12,color:N.textDim,marginTop:2}}>{eventRow?.username} · call each guest and record their answer</p>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={load}><Icon n="refresh" /> Refresh</button>
          <button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={exportCalls} disabled={!cards?.length}><Icon n="download" /> Export Excel</button>
          {canShare && <button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={() => setSharing(true)}><Icon n="eye" /> Share view-only{eventRow?.view_code ? " (on)" : ""}</button>}
        </div>
      </div>
      <div className="nk-stats">
        {[["Coming", `${sum.yes} · ${peopleLabel(sum.peopleYes)}`, "good", "yes"], ["Not coming", sum.no, "bad", "no"], ["Busy / no answer", sum.busy, "warn", "busy"],
          ["Picked up", sum.picked, "info", "picked"], ["Not called yet", sum.notCalled, "info", "todo"]].map(([l, v, t, st]) => (
          <button key={l} className="nk-stat" onClick={() => setFilter(f => ({ ...f, status: st }))} style={{cursor:"pointer",fontFamily:"inherit",borderColor:alpha(TONE[t],"33")}}>
            <div className="nk-stat-num" style={{color:TONE[t],fontSize:18}}>{v}</div><div className="nk-stat-label">{l}</div>
          </button>
        ))}
        <MoneyTile label="Expected at the door" value={peopleLabel(sum.peopleExpected)} tone="good" sub="Everyone except confirmed “no”" />
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:10}}>
        <input className="nk-input" style={{flex:"1 1 220px",maxWidth:320,marginBottom:0}} placeholder="Search name or phone…" value={filter.q} onChange={e => setFilter(f => ({ ...f, q: e.target.value }))} />
        {filters.map(([k, l]) => <button key={k} style={segStyle(filter.status === k)} onClick={() => setFilter(f => ({ ...f, status: k }))}>{l}</button>)}
      </div>
      <div className="nk-table-wrap">
        <table className="nk-table">
          <thead><tr><th>Guest</th><th>Phone</th><th>Answer</th><th>Comment</th><th>Updated</th></tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id}>
                <td><div style={{fontWeight:700,color:N.text}}>{c.name}</div><div style={{fontSize:11,color:N.textDim}}>{c.card_type || "—"} · {peopleLabel(peopleOf(c))}</div></td>
                <td>
                  {c.phone ? (
                    <div className="nk-row-actions">
                      <a className="nk-btn-sm icon-only" href={`tel:+${normalisePhone(c.phone)}`} aria-label={`Call ${c.name}`} title={`Call ${c.name}`}
                        style={{background:N.greenBg,color:N.green,borderColor:alpha(N.green,"44"),width:30,height:30,padding:0,justifyContent:"center",textDecoration:"none"}}><Icon n="phone" /></a>
                      <span style={{fontFamily:"JetBrains Mono, monospace",fontSize:12,color:N.textMid}}>+{normalisePhone(c.phone)}</span>
                    </div>
                  ) : <span style={{color:N.textDim,fontSize:12}}>No phone</span>}
                </td>
                <td>
                  <div className="nk-row-actions">
                    {callOptions(c.call_status).map(k => {
                      const m = CALL_STATUSES[k], on = c.call_status === k;
                      return (
                        <button key={k} type="button" disabled={!canEdit} onClick={() => setStatus(c, k)} aria-pressed={on}
                          title={on ? `${m.label} — tap again to clear` : `Mark as ${m.label.toLowerCase()}`}
                          style={{...segStyle(on), padding:"4px 10px", fontSize:11, ...(on ? { color:TONE[m.tone], borderColor:TONE[m.tone], background:TONE_BG[m.tone] } : {})}}>
                          {m.short === "Yes" || m.short === "No" ? m.label : m.short === "P" ? "Picked" : "Busy"}
                        </button>
                      );
                    })}
                  </div>
                </td>
                <td>
                  <div className="nk-row-actions">
                    <span style={{maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:12,color:c.call_comment ? N.textMid : N.textDim}}>{c.call_comment || "—"}</span>
                    {canEdit && <Sb bg="transparent" col={N.sky} border={N.border} label={`${c.call_comment ? "Edit" : "Add"} comment for ${c.name}`} onClick={() => setCommenting(c)}><Icon n="note" /></Sb>}
                  </div>
                </td>
                <td style={{fontSize:11,color:N.textDim}}>{c.call_updated_at ? <>{fmtWhen(c.call_updated_at)}<br />{c.call_by}</> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {cards === null ? <EmptyState loading title="Loading guests…" />
          : !cards.length ? <EmptyState icon="table" title="No guests saved for this event" text="Import the guest list in Design and press Save Cards to DB." />
          : !rows.length && <EmptyState icon="search" title="No guests match" action={<button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={() => setFilter({ status: "all", q: "" })}>Show everyone</button>} />}
      </div>
      {commenting && <CommentModal card={commenting} onClose={() => setCommenting(null)}
        onSave={async (text) => { if (await update(commenting, { call_comment: text || null }, { status: commenting.call_status || "ok", detail: `Comment: ${text || "(removed)"}` })) setCommenting(null); }} />}
      {sharing && <ShareViewModal eventRow={eventRow} showToast={showToast} onClose={() => setSharing(false)} reloadEvents={reloadEvents} />}
    </div>
  );
}

function CommentModal({ card: c, onSave, onClose }) {
  const [text, setText] = useState(c.call_comment || "");
  return (
    <div className="nk-overlay">
      <div className="nk-modal" style={{maxWidth:480}} role="dialog" aria-modal="true" aria-labelledby="nk-comment-title">
        <div className="nk-modal-head">
          <div className="nk-modal-title" id="nk-comment-title">Comment — {c.name}</div>
          <button className="nk-modal-close" onClick={onClose} aria-label="Close" title="Close"><Icon n="x" /></button>
        </div>
        <div className="nk-modal-body">
          <textarea className="nk-input nk-textarea" rows={4} autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="e.g. Coming with spouse; call again Friday" aria-label="Comment" />
        </div>
        <div className="nk-modal-foot">
          <button className="nk-btn nk-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="nk-btn nk-btn-primary" onClick={() => onSave(text.trim())}><Icon n="save" /> Save</button>
        </div>
      </div>
    </div>
  );
}

// Leads tab: pipeline numbers, filterable list (open leads with due follow-ups first) and
// the selected lead's details, follow-ups and actions (qualify → customer, lost, reopen)
function LeadsTab({ crm, selectedId, onSelect, onOpenEvent, onOpenCustomer }) {
  const canDelete = useCanDelete();
  const [filter,  setFilter]  = useState({ status:"open", q:"" });
  const [editing, setEditing] = useState(null);   // null | {} (new) | lead row
  const lead = crm.leads.find(l => l.id === selectedId) || null;
  useEffect(() => { if (selectedId) crm.loadFollowups(selectedId); }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (crm.error) return <CrmUnavailable error={crm.error} onRetry={crm.loadAll} />;

  const rows = sortLeads(filterLeads(crm.leads, filter));
  const sum  = summariseLeads(crm.leads);
  const customer = lead?.customer_id ? crm.customers.find(c => c.id === lead.customer_id) : null;
  const open = lead && OPEN_STATUSES.includes(lead.status);
  const onSave = async (form) => {
    const saved = await crm.saveLead(form, editing?.id);
    if (saved) { setEditing(null); onSelect(saved.id); }
  };
  const statuses = [["open","Open"],["new","New"],["contacted","Contacted"],["qualified","Customers"],["lost","Lost"],["all","All"]];

  return (
    <div className="nk-page" style={{padding:"0 0 40px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:800,color:N.text}}>Leads</h2>
          <p style={{fontSize:12,color:N.textDim,marginTop:2}}>Track enquiries, follow up, and qualify them into customers</p>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={crm.loadAll} disabled={crm.loading}>{crm.loading ? <><Icon n="loader" /></> : <><Icon n="undo" /></>} Refresh</button>
          <button className="nk-btn nk-btn-primary" onClick={() => setEditing({})}>+ New Lead</button>
        </div>
      </div>

      <div className="nk-stats">
        {[
          ["New",              sum.new,       N.sky,     "new"],
          ["Contacted",        sum.contacted, N.amber,   "contacted"],
          ["Follow-ups today", sum.dueToday,  N.amber,   "open"],
          ["Overdue",          sum.overdue,   N.red,     "open"],
          ["Became customers", sum.qualified, N.green,   "qualified"],
          ["Lost",             sum.lost,      N.textDim, "lost"],
        ].map(([l, v, c, st]) => (
          <button key={l} className="nk-stat" onClick={() => setFilter(f => ({ ...f, status: st }))}
            style={{borderColor:alpha(c,"33"),cursor:"pointer",fontFamily:"inherit"}} title={`Show ${st === "open" ? "open" : l.toLowerCase()} leads`}>
            <div className="nk-stat-num" style={{color:c}}>{v}</div>
            <div className="nk-stat-label">{l}</div>
          </button>
        ))}
      </div>

      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
        <input className="nk-input" style={{flex:"1 1 220px",maxWidth:320,marginBottom:0}} placeholder="Search name, phone, region, venue…"
          value={filter.q} onChange={e => setFilter(f => ({ ...f, q: e.target.value }))} />
        {statuses.map(([k, label]) => (
          <button key={k} style={segStyle(filter.status === k)} onClick={() => setFilter(f => ({ ...f, status: k }))}>{label}</button>
        ))}
        <span style={{fontSize:11,color:N.textDim,marginLeft:"auto"}}>{rows.length} lead{rows.length === 1 ? "" : "s"}</span>
      </div>

      <div className="nk-split" style={{display:"flex",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
        <div className="nk-table-wrap" style={{flex:"2 1 560px",margin:0}}>
          <table className="nk-table">
            <thead><tr>{["Lead","Event","Package","Region","Stage","Next follow-up"].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map(l => (
                <tr key={l.id} onClick={() => onSelect(l.id)} style={{cursor:"pointer"}} className={l.id === selectedId ? "row-active" : ""}>
                  <td>
                    <div style={{fontWeight:700,color:N.text,whiteSpace:"nowrap"}}>{l.name}</div>
                    <div style={{fontSize:11,color:N.textDim,fontFamily:"JetBrains Mono, monospace"}}>{phoneLabel(l.phone)}</div>
                  </td>
                  <td>
                    <div style={{fontSize:12,color:N.textMid}}>{l.event_type || "—"}</div>
                    {l.event_date && <div style={{fontSize:11,color:N.textDim,whiteSpace:"nowrap"}}>{fmtDay(l.event_date)}</div>}
                  </td>
                  <td style={{fontSize:12,color:N.textMid,whiteSpace:"nowrap"}}>{formatTsh(l.package_price)}</td>
                  <td style={{fontSize:12,color:N.textMid}}>{l.region || "—"}</td>
                  <td><LeadStatus status={l.status} /></td>
                  <td><DueTag date={l.next_followup_date} open={OPEN_STATUSES.includes(l.status)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            crm.loading ? <EmptyState loading title="Loading leads…" />
              : crm.leads.length ? <EmptyState icon="search" title="No leads match" text="Try another search or stage."
                  action={<button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={() => setFilter({ status:"all", q:"" })}>Show all leads</button>} />
              : <EmptyState icon="target" title="No leads yet" text="Every enquiry starts here — record it, follow up, and turn it into a customer."
                  action={<button className="nk-btn nk-btn-primary" onClick={() => setEditing({})}><Icon n="plus" /> New Lead</button>} />
          )}
        </div>

        {lead && (
          <DetailModal label={`Lead ${lead.name}`} onClose={() => onSelect(null)}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:14}}>
              <div>
                <div style={{fontSize:18,fontWeight:800,color:N.text}}>{lead.name}</div>
                <div style={{fontSize:12,color:N.textDim,fontFamily:"JetBrains Mono, monospace",marginTop:2}}>{phoneLabel(lead.phone)}</div>
              </div>
              <LeadStatus status={lead.status} />
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
              <Info label="Event type">{lead.event_type}</Info>
              <Info label="Event date">{lead.event_date && fmtDay(lead.event_date)}</Info>
              <Info label="Package">{lead.package_price != null && formatTsh(lead.package_price)}</Info>
              <Info label="Region">{lead.region}</Info>
              <Info label="Venue">{lead.venue}</Info>
              <Info label="Added">{fmtDay(lead.created_at)}{lead.created_by ? ` · ${lead.created_by}` : ""}</Info>
            </div>
            {lead.description && (
              <div style={{fontSize:13,color:N.textMid,background:N.navy700,borderRadius:8,padding:"8px 10px",marginBottom:12,whiteSpace:"pre-wrap",lineHeight:1.5}}>
                {lead.description}
              </div>
            )}

            {lead.status === "qualified" && (
              <div style={{background:N.greenBg,border:`1px solid ${alpha(N.green,"44")}`,borderRadius:10,padding:"10px 12px",marginBottom:12,fontSize:12,color:N.textMid}}>
                <div style={{color:N.green,fontWeight:700,marginBottom:6}}><Icon n="check" /> Customer since {fmtDay(lead.qualified_at)}</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {customer && <Sb bg={N.navy700} col={N.green} border={alpha(N.green,"44")} onClick={() => onOpenCustomer(customer.id)}><Icon n="user" /> {customer.name}</Sb>}
                  {lead.event_id && <Sb bg={N.navy700} col={N.sky} border={alpha(N.sky,"44")} onClick={() => onOpenEvent(lead.event_id)}><Icon n="folder" /> View event</Sb>}
                </div>
              </div>
            )}

            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:18}}>
              {open && (
                <button className="nk-btn nk-btn-success" style={{padding:"7px 14px",fontSize:12}} onClick={() => crm.qualifyLead(lead)} disabled={crm.busy}>
                  <Icon n="check" /> Qualify → Customer
                </button>
              )}
              <button className="nk-btn nk-btn-ghost" style={{padding:"7px 12px",fontSize:12}} onClick={() => setEditing(lead)}><Icon n="edit" /> Edit</button>
              {open && <button className="nk-btn nk-btn-ghost" style={{padding:"7px 12px",fontSize:12}} onClick={() => crm.setLeadStatus(lead, "lost")}><Icon n="xCircle" /> Lost</button>}
              {lead.status === "lost" && <button className="nk-btn nk-btn-ghost" style={{padding:"7px 12px",fontSize:12}} onClick={() => crm.setLeadStatus(lead, "contacted")}><Icon n="undo" /> Reopen</button>}
              {canDelete && (<button className="nk-btn nk-btn-ghost" style={{padding:"7px 12px",fontSize:12,color:N.red}}
                aria-label="Delete lead" title="Delete lead" onClick={async () => { if (await crm.deleteLead(lead)) onSelect(null); }}><Icon n="trash" /></button>)}
            </div>

            <div className="nk-sec nk-sec-teal" style={{marginBottom:8}}>Follow-ups</div>
            {open && <FollowupComposer busy={crm.busy} onAdd={(f) => crm.addFollowup(lead, f)} />}
            {open && lead.next_followup_date && (
              <div style={{fontSize:12,color:N.textMid,marginBottom:10}}>Next follow-up: <DueTag date={lead.next_followup_date} /></div>
            )}
            <FollowupList items={crm.followups[lead.id]} busy={crm.busy} onEdit={(f, changes) => crm.updateFollowup(lead, f, changes)} />
          </DetailModal>
        )}
      </div>

      {editing && <LeadModal initial={editing} saving={crm.busy} onSave={onSave} onClose={() => setEditing(null)} />}
    </div>
  );
}

// Customers tab: customer list (with event counts) and the selected customer's details,
// events (click one for the full overview) and the leads they came from
function CustomersTab({ crm, selectedId, onSelect, onOpenEvent, onOpenLead, onNewEvent, eventsVersion }) {
  const canDelete = useCanDelete();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);   // null | {} (new) | customer row
  const [loaded,  setLoaded]  = useState({ id:null, list:[] });   // events of customer `id`
  const customer = crm.customers.find(c => c.id === selectedId) || null;
  const events = loaded.id === selectedId ? loaded.list : null;    // null while loading
  useEffect(() => {
    if (!selectedId) return;
    let live = true;
    crm.customerEvents(selectedId).then(list => { if (live) setLoaded({ id: selectedId, list }); });
    return () => { live = false; };
  }, [selectedId, eventsVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  if (crm.error) return <CrmUnavailable error={crm.error} onRetry={crm.loadAll} />;

  const needle = q.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  const rows = crm.customers.filter(c => !needle
    || [c.name, c.region, c.notes].filter(Boolean).join(" ").toLowerCase().includes(needle)
    || (digits.length >= 4 && (c.phone || "").includes(normalisePhone(digits))));
  const leadsOf = customer ? crm.leads.filter(l => l.customer_id === customer.id) : [];
  const totalEvents = Object.values(crm.eventCounts).reduce((a, b) => a + b, 0);
  const onSave = async (form) => {
    const saved = await crm.saveCustomer(form, editing?.id);
    if (saved) { setEditing(null); onSelect(saved.id); }
  };

  return (
    <div className="nk-page" style={{padding:"0 0 40px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:800,color:N.text}}>Customers</h2>
          <p style={{fontSize:12,color:N.textDim,marginTop:2}}>{crm.customers.length} customer{crm.customers.length === 1 ? "" : "s"} · {totalEvents} linked event{totalEvents === 1 ? "" : "s"}</p>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={crm.loadAll} disabled={crm.loading}>{crm.loading ? <><Icon n="loader" /></> : <><Icon n="undo" /></>} Refresh</button>
          <button className="nk-btn nk-btn-primary" onClick={() => setEditing({})}>+ New Customer</button>
        </div>
      </div>

      <input className="nk-input" style={{maxWidth:320}} placeholder="Search name, phone, region…" value={q} onChange={e => setQ(e.target.value)} />

      <div className="nk-split" style={{display:"flex",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
        <div className="nk-table-wrap" style={{flex:"2 1 480px",margin:0}}>
          <table className="nk-table">
            <thead><tr>{["Customer","Region","Events","Since"].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id} onClick={() => onSelect(c.id)} style={{cursor:"pointer"}} className={c.id === selectedId ? "row-active" : ""}>
                  <td>
                    <div style={{fontWeight:700,color:N.text}}>{c.name}</div>
                    <div style={{fontSize:11,color:N.textDim,fontFamily:"JetBrains Mono, monospace"}}>{phoneLabel(c.phone)}</div>
                  </td>
                  <td style={{fontSize:12,color:N.textMid}}>{c.region || "—"}</td>
                  <td style={{fontSize:13,fontWeight:700,color:crm.eventCounts[c.id] ? N.sky : N.textDim}}>{crm.eventCounts[c.id] || 0}</td>
                  <td style={{fontSize:12,color:N.textMid,whiteSpace:"nowrap"}}>{fmtDay(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            crm.loading ? <EmptyState loading title="Loading customers…" />
              : crm.customers.length ? <EmptyState icon="search" title="No customers match" text="Try another name, phone number or region." />
              : <EmptyState icon="users" title="No customers yet" text="Qualify a lead or add a customer directly."
                  action={<button className="nk-btn nk-btn-primary" onClick={() => setEditing({})}><Icon n="plus" /> New Customer</button>} />
          )}
        </div>

        {customer && (
          <DetailModal label={`Customer ${customer.name}`} onClose={() => onSelect(null)}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:14}}>
              <div>
                <div style={{fontSize:18,fontWeight:800,color:N.text}}>{customer.name}</div>
                <div style={{fontSize:12,color:N.textDim,fontFamily:"JetBrains Mono, monospace",marginTop:2}}>{phoneLabel(customer.phone)}</div>
              </div>
              <div style={{display:"flex",gap:6}}>
                <button className="nk-btn nk-btn-ghost" style={{padding:"6px 10px",fontSize:12}} onClick={() => setEditing(customer)}><Icon n="edit" /> Edit</button>
                {canDelete && (<button className="nk-btn nk-btn-ghost" style={{padding:"6px 10px",fontSize:12,color:N.red}}
                  aria-label="Delete customer" title="Delete customer" onClick={async () => { if (await crm.deleteCustomer(customer)) onSelect(null); }}><Icon n="trash" /></button>)}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
              <Info label="Region">{customer.region}</Info>
              <Info label="Customer since">{fmtDay(customer.created_at)}</Info>
            </div>
            {customer.notes && <div style={{fontSize:13,color:N.textMid,background:N.navy700,borderRadius:8,padding:"8px 10px",marginBottom:12,whiteSpace:"pre-wrap"}}>{customer.notes}</div>}

            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"18px 0 8px"}}>
              <div className="nk-sec" style={{margin:0}}>Events {events ? `(${events.length})` : ""}</div>
              <button className="nk-btn nk-btn-primary" style={{padding:"5px 12px",fontSize:11}} onClick={() => onNewEvent(customer)}>+ New event</button>
            </div>
            {!events ? <EmptyState loading compact title="Loading events…" />
              : !events.length ? <EmptyState icon="calendar" compact title="No events yet" text="Create this customer's first event with + New event." />
              : (
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {events.map(ev => (
                    <button key={ev.id} onClick={() => onOpenEvent(ev.id)} title="See everything about this event"
                      style={{textAlign:"left",background:N.navy700,border:`1px solid ${N.border}`,borderRadius:9,padding:"9px 12px",cursor:"pointer",color:N.text,fontFamily:"inherit"}}>
                      <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
                        <span style={{fontWeight:700,fontSize:13}}>{ev.username}</span>
                        <span className={`nk-badge ${ev.status==="active"?"badge-yes":ev.status==="completed"?"badge-sent":"badge-no"}`}>{ev.status}</span>
                      </div>
                      <div style={{fontSize:11,color:N.textDim,marginTop:3}}>
                        {[ev.event_type, ev.start_datetime && fmtDay(ev.start_datetime), ev.venue_name, ev.package_price != null && formatTsh(ev.package_price)].filter(Boolean).join(" · ") || "No details yet"}
                      </div>
                    </button>
                  ))}
                </div>
              )}

            <div className="nk-sec" style={{margin:"18px 0 8px"}}>Leads</div>
            {!leadsOf.length ? <div style={{fontSize:12,color:N.textDim}}>Added directly, not from a lead.</div> : (
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {leadsOf.map(l => (
                  <button key={l.id} onClick={() => onOpenLead(l.id)}
                    style={{textAlign:"left",background:"transparent",border:`1px dashed ${N.border}`,borderRadius:9,padding:"8px 12px",cursor:"pointer",color:N.textMid,fontFamily:"inherit",fontSize:12}}>
                    <Icon n="target" /> {l.event_type || "Lead"}{l.event_date ? ` · ${fmtDay(l.event_date)}` : ""} · added {fmtDay(l.created_at)} <LeadStatus status={l.status} />
                  </button>
                ))}
              </div>
            )}
          </DetailModal>
        )}
      </div>

      {editing && <CustomerModal initial={editing} saving={crm.busy} onSave={onSave} onClose={() => setEditing(null)} />}
    </div>
  );
}

// Everything about one event in a single view: details, customer (and their other events),
// the lead it came from with its follow-ups, card/send counts and the latest history.
// Loads its own data; `onOpen(ev, tab)` jumps into the designer / report / history.
// Overlapping initials for an event's team (first 3, then "+N"); full names in the tooltip
function TeamAvatars({ team = [], max = 3 }) {
  if (!team.length) return <span style={{fontSize:11,color:N.textDim}}>Not assigned</span>;
  const names = team.map(a => `${a.full_name || a.email}${a.task ? ` (${a.task})` : ""}`).join(", ");
  return (
    <span className="nk-avatars" title={names} aria-label={`Team: ${names}`}>
      {team.slice(0, max).map(a => <span key={a.email} className="nk-avatar">{initials(a.full_name, a.email)}</span>)}
      {team.length > max && <span className="nk-avatar nk-avatar-more">+{team.length - max}</span>}
    </span>
  );
}

// The event's team inside the Overview: who's on it, their task, add / remove people
function TeamPanel({ team = [], canManage, people, peopleError, onLoadPeople, onAdd, onRemove, cardStyle }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: "", task: "" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const listId = useId();
  // Always refresh the list when opening, so newly invited people show up
  const open = () => { setAdding(true); setErrors({}); setForm({ email: "", task: "" }); onLoadPeople(); };
  const choices = assignableFor(people || [], team);
  const submit = async () => {
    const e = validateAssignment(form, team);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const ok = await onAdd(form.email, form.task.trim() || null);
    setBusy(false);
    if (ok) setAdding(false);
  };
  return (
    <div style={cardStyle}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div className="nk-sec" style={{margin:0}}><Icon n="users" /> Team</div>
        {canManage && !adding && <Sb bg="transparent" col={N.sky} border={alpha(N.sky,"44")} label="Assign a person to this event" onClick={open}><Icon n="plus" /> Assign</Sb>}
      </div>
      {adding && (
        <div style={{background:N.navy800,border:`1px solid ${N.accent}`,borderRadius:10,padding:10,marginBottom:10}}>
          <label className="nk-label" htmlFor={listId + "p"}>Person</label>
          <select id={listId + "p"} className="nk-select" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}>
            <option value="">{!people ? "Loading people…" : peopleError ? "Couldn't load people" : !people.length ? "No active users yet" : choices.length ? "— Choose a person —" : "Everyone is already on the team"}</option>
            {choices.map(u => <option key={u.email} value={u.email}>{u.full_name ? `${u.full_name} — ${u.email}` : u.email} · {ROLE_LABEL[u.role] || u.role}</option>)}
          </select>
          {errors.email && <div style={{fontSize:11,color:N.red,marginTop:-6,marginBottom:8}}>{errors.email}</div>}
          {peopleError && (
            <div role="alert" style={{fontSize:12,color:N.amber,background:N.amberBg,borderRadius:8,padding:"8px 10px",marginBottom:10,display:"flex",gap:8,alignItems:"flex-start"}}>
              <Icon n="alert" /><span style={{flex:1}}>{peopleError}</span>
              <button type="button" className="nk-link" onClick={onLoadPeople}>Retry</button>
            </div>
          )}
          {people && !peopleError && !people.length && (
            <div style={{fontSize:12,color:N.textDim,marginBottom:10}}>Invite people first in Settings → Users, then assign them here.</div>
          )}
          <label className="nk-label" htmlFor={listId + "t"}>Task on this event</label>
          <input id={listId + "t"} className="nk-input" list={listId} maxLength={40} placeholder="e.g. Designer, Door / check-in" value={form.task}
            onChange={e => setForm(f => ({ ...f, task: e.target.value }))} />
          <datalist id={listId}>{TASK_SUGGESTIONS.map(t => <option key={t} value={t} />)}</datalist>
          <div style={{display:"flex",justifyContent:"flex-end",gap:6}}>
            <button className="nk-btn nk-btn-ghost" style={{padding:"6px 12px",fontSize:12}} onClick={() => setAdding(false)}>Cancel</button>
            <button className="nk-btn nk-btn-primary" style={{padding:"6px 12px",fontSize:12}} onClick={submit} disabled={busy || !form.email}>
              <Icon n={busy ? "loader" : "check"} /> Assign
            </button>
          </div>
        </div>
      )}
      {team.length ? team.map(a => (
        <div key={a.email} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:`1px solid ${N.border}`}}>
          <span className="nk-avatar" style={{marginLeft:0}}>{initials(a.full_name, a.email)}</span>
          <div style={{flex:1,minWidth:0}}>
            <div className="nk-ellipsis" style={{fontSize:13,fontWeight:700,color:N.text}}>{a.full_name || a.email}</div>
            <div className="nk-ellipsis" style={{fontSize:11,color:N.textDim}}>{[a.task, a.full_name && a.email].filter(Boolean).join(" · ") || "No task set"}</div>
          </div>
          {canManage && <Sb bg="transparent" col={N.red} border={N.border} label={`Remove ${a.full_name || a.email} from this event`} onClick={() => onRemove(a)}><Icon n="x" /></Sb>}
        </div>
      )) : <EmptyState icon="users" compact text={canManage ? "Nobody is assigned yet. Assign the people working on this event — only they (and admins) will see it." : "Nobody is assigned yet."} />}
    </div>
  );
}

function EventOverview({ eventId, onClose, onSwitch, onOpen, onEdit, onOpenCustomer, onOpenLead, onOpenFinance, team }) {
  const [d, setD] = useState(null);   // fresh per event: the parent renders <EventOverview key={eventId}>
  useEffect(() => {
    let live = true;
    (async () => {
      const { data: ev, error } = await supabase.from("events").select("*").eq("id", eventId).single();
      if (!live) return;
      if (error) { setD({ error: error.message }); return; }
      const none = Promise.resolve({ data: null });
      const [cust, lead, cards, logs, siblings, txns] = await Promise.all([
        ev.customer_id ? supabase.from("customers").select("*").eq("id", ev.customer_id).maybeSingle() : none,
        ev.lead_id ? supabase.from("leads").select("*").eq("id", ev.lead_id).maybeSingle()
                   : supabase.from("leads").select("*").eq("event_id", ev.id).limit(1).maybeSingle(),
        supabase.from("event_cards").select("wa_status,sms_status").eq("event_id", ev.id),
        supabase.from("event_logs").select("*").eq("event_id", ev.id).order("created_at", { ascending:false }).limit(8),
        ev.customer_id ? supabase.from("events").select("id,username,event_type,start_datetime,status").eq("customer_id", ev.customer_id)
                           .order("start_datetime", { ascending:false, nullsFirst:false }) : none,
        // Finance tables may not exist yet — a failed query just hides the money card
        supabase.from("event_transactions").select("kind,amount").eq("event_id", ev.id),
      ]);
      const fu = lead.data ? await supabase.from("lead_followups").select("*").eq("lead_id", lead.data.id).order("created_at", { ascending:false }) : { data: [] };
      if (live) setD({ ev, customer: cust.data, lead: lead.data, followups: fu.data || [], cards: cards.data || [], logs: logs.data || [], siblings: siblings.data || [], money: txns.error ? null : summariseTransactions(txns.data || []) });
    })();
    return () => { live = false; };
  }, [eventId]);

  const ev = d?.ev;
  const count = (fn) => (d?.cards || []).filter(fn).length;
  const card = { background:N.navy700, border:`1px solid ${N.border}`, borderRadius:12, padding:14, marginBottom:12 };
  return (
    <div className="nk-overlay nk-raise">
      <div className="nk-modal" style={{maxWidth:920}}>
        <div className="nk-modal-head">
          <div>
            <div className="nk-modal-title">{ev ? ev.username : "Event"}</div>
            {ev && (
              <div style={{fontSize:12,color:N.textDim,marginTop:3}}>
                {[ev.event_type, ev.start_datetime && fmtDay(ev.start_datetime), ev.venue_name, ev.region].filter(Boolean).join(" · ") || "No details yet"}
              </div>
            )}
          </div>
          <button className="nk-modal-close" onClick={onClose} aria-label="Close" title="Close"><Icon n="x" /></button>
        </div>
        <div className="nk-modal-body">
          {!d ? <EmptyState loading title="Loading event…" />
            : d.error ? <EmptyState icon="alert" tone="bad" title="Could not load this event" text={d.error} />
            : (
              <>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16,alignItems:"center"}}>
                  <span className={`nk-badge ${ev.status==="active"?"badge-yes":ev.status==="completed"?"badge-sent":"badge-no"}`}>{ev.status}</span>
                  {ev.package_price != null && <Pill tone="good">{formatTsh(ev.package_price)}</Pill>}
                  <div style={{marginLeft:"auto",display:"flex",gap:6,flexWrap:"wrap"}}>
                    <Sb bg={N.accent} col="#fff" border={N.accent} onClick={() => onOpen(ev, "design")}><Icon n="palette" /> Open in Design</Sb>
                    <Sb bg={N.navy600} col={N.teal} border={alpha(N.teal,"44")} onClick={() => onOpen(ev, "reports")}><Icon n="report" /> Report</Sb>
                    <Sb bg={N.navy600} col={N.purple} border={alpha(N.purple,"44")} onClick={() => onOpen(ev, "history")}><Icon n="history" /> History</Sb>
                    <Sb bg={N.navy600} col={N.sky} border={alpha(N.sky,"44")} onClick={() => onEdit(ev)}><Icon n="edit" /> Edit</Sb>
                  </div>
                </div>

                <div style={{display:"flex",gap:14,flexWrap:"wrap",alignItems:"flex-start"}}>
                  <div style={{flex:"1 1 380px",minWidth:0}}>
                    <div style={card}>
                      <div className="nk-sec" style={{marginBottom:10}}><Icon n="user" /> Customer</div>
                      {d.customer ? (
                        <>
                          <button onClick={() => onOpenCustomer(d.customer.id)} style={{background:"none",border:"none",padding:0,cursor:"pointer",textAlign:"left",color:N.text,fontFamily:"inherit"}}>
                            <div style={{fontWeight:800,fontSize:15}}>{d.customer.name}</div>
                            <div style={{fontSize:12,color:N.textDim}}><span style={{fontFamily:"JetBrains Mono, monospace"}}>{phoneLabel(d.customer.phone)}</span>{d.customer.region ? ` · ${d.customer.region}` : ""}</div>
                          </button>
                          {d.siblings.length > 1 && (
                            <div style={{marginTop:10}}>
                              <div style={{fontSize:11,color:N.textDim,marginBottom:5}}>All {d.siblings.length} events for this customer</div>
                              {d.siblings.map(s => (
                                <button key={s.id} onClick={() => s.id !== ev.id && onSwitch(s.id)} disabled={s.id === ev.id}
                                  style={{display:"block",width:"100%",textAlign:"left",background: s.id === ev.id ? N.navy600 : "transparent",
                                    border:`1px solid ${s.id === ev.id ? N.sky : N.border}`,borderRadius:7,padding:"5px 9px",marginBottom:4,
                                    cursor: s.id === ev.id ? "default" : "pointer",color:N.textMid,fontSize:12,fontFamily:"inherit"}}>
                                  <strong style={{color:N.text}}>{s.username}</strong>{[s.event_type, s.start_datetime && fmtDay(s.start_datetime)].filter(Boolean).map(x => ` · ${x}`).join("")}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      ) : <div style={{fontSize:12,color:N.textDim}}>Not linked to a customer — use <Icon n="edit" /> Edit to choose one.</div>}
                    </div>

                    <div style={card}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                        <div className="nk-sec" style={{margin:0}}><Icon n="target" /> Lead &amp; follow-ups</div>
                        {d.lead && <Sb bg="transparent" col={N.sky} border={alpha(N.sky,"44")} onClick={() => onOpenLead(d.lead.id)}>Open lead</Sb>}
                      </div>
                      {d.lead ? (
                        <>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                            <Info label="Stage"><LeadStatus status={d.lead.status} /></Info>
                            <Info label="Enquiry">{fmtDay(d.lead.created_at)}</Info>
                            <Info label="Package">{d.lead.package_price != null && formatTsh(d.lead.package_price)}</Info>
                            <Info label="Venue">{d.lead.venue}</Info>
                          </div>
                          {d.lead.description && <div style={{fontSize:12,color:N.textMid,marginBottom:10,whiteSpace:"pre-wrap"}}>{d.lead.description}</div>}
                          <FollowupList items={d.followups} />
                        </>
                      ) : <div style={{fontSize:12,color:N.textDim}}>This event wasn't created from a lead.</div>}
                    </div>
                  </div>

                  <div style={{flex:"1 1 320px",minWidth:0}}>
                    {team && <TeamPanel {...team} cardStyle={card} />}
                    {d.money && (
                      <div style={card}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                          <div className="nk-sec" style={{margin:0}}><Icon n="wallet" /> Profit</div>
                          {onOpenFinance && <Sb bg="transparent" col={N.sky} border={alpha(N.sky,"44")} onClick={() => onOpenFinance(ev.id)}>Open in Finance</Sb>}
                        </div>
                        {d.money.count ? (
                          <>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                              {[
                                ["Income",   formatTsh(d.money.income),  N.green],
                                ["Expenses", formatTsh(d.money.expense), N.red],
                                ["Profit",   formatTsh(d.money.profit),  d.money.profit < 0 ? N.red : N.sky],
                                ["Margin",   formatPct(d.money.marginPct), TONE[MARGIN_TONE[marginTone(d.money.marginPct)]]],
                              ].map(([l, v, c]) => (
                                <div key={l} style={{background:N.navy800,borderRadius:9,padding:"8px 10px",border:`1px solid ${alpha(c,"33")}`}}>
                                  <div style={{fontSize:16,fontWeight:800,color:c,fontVariantNumeric:"tabular-nums"}}>{v}</div>
                                  <div style={{fontSize:10,color:N.textDim,textTransform:"uppercase",letterSpacing:.5}}>{l}</div>
                                </div>
                              ))}
                            </div>
                            <div style={{fontSize:11,color:N.textDim,marginTop:8}}>{d.money.count} transaction{d.money.count === 1 ? "" : "s"} recorded</div>
                          </>
                        ) : (
                          <EmptyState icon="wallet" compact title="No money recorded yet"
                            text="Record the customer's payments and the event's costs to see its profit."
                            action={onOpenFinance && <button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={() => onOpenFinance(ev.id)}><Icon n="plus" /> Record a payment</button>} />
                        )}
                      </div>
                    )}
                    <div style={card}>
                      <div className="nk-sec" style={{marginBottom:10}}><Icon n="image" /> Cards &amp; sending</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                        {[
                          ["Contacts",   d.cards.length,                                                         N.textMid],
                          ["WA sent",    count(c => c.wa_status === WA.sent),                                    N.green],
                          ["WA invalid", count(c => c.wa_status === WA.invalid),                                 N.amber],
                          ["SMS sent",   count(c => c.sms_status === SMS.sent || c.sms_status === SMS.delivered), N.teal],
                        ].map(([l, v, c]) => (
                          <div key={l} style={{background:N.navy800,borderRadius:9,padding:"8px 10px",border:`1px solid ${alpha(c,"33")}`}}>
                            <div style={{fontSize:20,fontWeight:800,color:c}}>{v}</div>
                            <div style={{fontSize:10,color:N.textDim,textTransform:"uppercase",letterSpacing:.5}}>{l}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={card}>
                      <div className="nk-sec" style={{marginBottom:10}}><Icon n="history" /> Latest activity</div>
                      {!d.logs.length ? <EmptyState icon="history" compact text="Nothing recorded yet — sends and changes appear here." /> : d.logs.map(r => {
                        const st = HISTORY_STATUSES[r.status] || { label: r.status, tone: "info" };
                        return (
                          <div key={r.id} style={{display:"flex",gap:8,alignItems:"baseline",fontSize:12,padding:"4px 0",borderBottom:`1px solid ${N.border}`}}>
                            <span style={{color:N.textDim,fontFamily:"JetBrains Mono, monospace",fontSize:10,whiteSpace:"nowrap"}}>{fmtWhen(r.created_at)}</span>
                            <span style={{flex:1,minWidth:0,color:N.textMid,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                              <Icon n={HISTORY_CHANNELS[r.channel]?.icon} /> {HISTORY_ACTIONS[r.action] || r.action}{r.recipient_name ? ` — ${r.recipient_name}` : ""}{!r.recipient_name && r.detail ? ` — ${r.detail}` : ""}
                            </span>
                            <Pill tone={st.tone}>{st.label}</Pill>
                          </div>
                        );
                      })}
                      <button className="nk-btn nk-btn-ghost nk-btn-full" style={{marginTop:10,marginBottom:0,fontSize:12}} onClick={() => onOpen(ev, "history")}>See full history →</button>
                    </div>
                  </div>
                </div>
              </>
            )}
        </div>
      </div>
    </div>
  );
}

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
  const [menuOpen, setMenuOpen] = useState(false);   // mobile navigation drawer
  const [navOpen, setNavOpen]   = useState(null);    // desktop: group whose sub-menu is open by click/tap (hover opens via CSS)
  // Table cells are one line with "…"; hovering a cut-off cell shows its full text as a tooltip
  useEffect(() => {
    const onOver = (e) => {
      const el = e.target.closest?.(".nk-table td, .nk-table td > div, .nk-table td > span");
      if (!el || el.hasAttribute("title")) return;
      if (el.scrollWidth > el.clientWidth + 1) el.setAttribute("title", el.textContent.trim());
    };
    document.addEventListener("mouseover", onOver);
    return () => document.removeEventListener("mouseover", onOver);
  }, []);
  // Switches tab from the tab bar or drawer (some tabs refresh their event list first)
  const goTab = (id) => { if (id === "events" || id === "finance") loadSavedEvents(); setTab(id); setMenuOpen(false); };
  // Esc closes the drawer; the page behind it doesn't scroll while it's open
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [menuOpen]);

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
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const loadTeamsRef = useRef(null);   // set once the teams loader exists (it's defined further down)   // first events fetch finished (drives the loading state)
  const [coverUrl,          setCoverUrl]          = useState(null);
  const [isSaving,          setIsSaving]          = useState(false);
  const [loadingTemplate,   setLoadingTemplate]   = useState(false);
  const [dbStatus,          setDbStatus]          = useState(supabase ? "unknown" : "unconfigured");

  /* ── Saved templates ── */
  const [savedTemplates,    setSavedTemplates]    = useState([]);
  const [pickingTemplate,   setPickingTemplate]   = useState(false);   // "Change template" pop-up
  const [designSaveFor,     setDesignSaveFor]     = useState(null);    // event id whose new template must be written to the DB
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
  const [shareView, setShareView] = useState(false);   // "Share view-only link" pop-up (History tab)
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
    loadTeamsRef.current?.();
    const { data, error } = await supabase.from("events").select("*").order("created_at", { ascending:false }).limit(50);
    setEventsLoaded(true);
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

  /* ── CRM: leads → follow-ups → customers → events ── */
  /* ── Access: my role, permissions and Settings data ── */
  const access = useAccess({ userId, email: user?.email, showToast });
  const navGroups = (access.setupMissing ? NAV_GROUPS : visibleNav(NAV_GROUPS, access.matrix, access.role))
    .filter(g => !g.eventOnly || savedEventId);
  // Leave a tab that is no longer in the menu (role change, or the event was closed)
  useEffect(() => {
    if (access.loading || (!access.setupMissing && !access.role)) return;
    if (!navGroups.some(g => g.items.some(it => it.id === tab))) setTab(navGroups[0]?.items[0]?.id || "guide");
  }, [access.loading, access.role, access.matrix, tab, savedEventId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Event teams (event_assignments) ── */
  const [teamRows, setTeamRows] = useState([]);
  const [people, setPeople]     = useState(null);   // assignable users (names for avatars + the picker); null = not loaded
  const [peopleError, setPeopleError] = useState(null);
  const loadTeams = async () => {
    if (!supabase || !userId || access.setupMissing) return;
    const { data, error } = await supabase.from("event_assignments").select("*");
    if (!error) setTeamRows(data || []);
  };
  // Who can be put on a team. Uses the assignable_users() RPC; if that isn't installed yet,
  // falls back to reading app_users directly (works for roles that may view Users).
  // Never leaves the picker stuck on "Loading": failures end in an error + Retry.
  const loadPeople = async () => {
    if (!supabase || access.setupMissing) { setPeople([]); return; }
    setPeopleError(null);
    const r = await supabase.rpc("assignable_users");
    if (!r.error) { setPeople(r.data || []); return; }
    const t = await supabase.from("app_users").select("email,full_name,role,active").eq("active", true).order("full_name");
    if (!t.error && t.data?.length) { setPeople(t.data); return; }
    setPeople([]);
    setPeopleError(/assignable_users|schema cache|does not exist/i.test(r.error.message)
      ? "The team feature isn't set up in the database yet — run the latest supabase-schema.sql, then retry."
      : r.error.message);
  };
  useEffect(() => { loadTeams(); }, [userId, access.setupMissing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (access.can("events", "edit") || access.can("users")) loadPeople(); }, [access.role, access.setupMissing]); // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = Object.fromEntries((people || []).map(u => [u.email, u.full_name]));
  const teamsByEvent = groupAssignments(teamRows.map(r => ({ ...r, full_name: nameOf[r.email] || null })));
  const canManageTeams = !access.setupMissing && (access.can("events", "edit") || access.can("users", "edit"));
  const addToTeam = async (eventId, email, task) => {
    const { data, error } = await supabase.from("event_assignments").insert([{ event_id: eventId, email, task }]).select().single();
    if (error) { showToast(`Could not assign: ${error.message}`, "warn"); return false; }
    setTeamRows(rs => [...rs, data]);
    logHistory({ channel:"event", action:"team", name: nameOf[email] || email, detail: `Assigned${task ? ` as ${task}` : ""}` }, eventId);
    showToast(`${nameOf[email] || email} assigned`, "success");
    return true;
  };
  const removeFromTeam = async (eventId, a) => {
    const ok = await askDialog({ title: `Remove ${a.full_name || a.email}?`,
      body: "They're taken off this event's team. Unless their role sees all events, they won't see this event any more.",
      actions: [{ value: "yes", label: "Remove", kind: "danger" }] });
    if (ok !== "yes") return;
    const { error } = await supabase.from("event_assignments").delete().eq("event_id", eventId).eq("email", a.email);
    if (error) { showToast(`Could not remove: ${error.message}`, "warn"); return; }
    setTeamRows(rs => rs.filter(r => !(r.event_id === eventId && r.email === a.email)));
    logHistory({ channel:"event", action:"team", name: a.full_name || a.email, detail: "Removed from the team" }, eventId);
  };
  loadTeamsRef.current = loadTeams;
  const [eventsScope, setEventsScope] = useState("all");   // Events tab: "all" | "mine" (for roles that see every event)
  const myEmail = (user?.email || "").toLowerCase();

  const crm = useCrm({ enabled: !!userId, showToast, askDialog, logHistory, reloadEvents: loadSavedEvents });
  const [leadSel,     setLeadSel]     = useState(null);   // lead open in the Leads tab
  const [customerSel, setCustomerSel] = useState(null);   // customer open in the Customers tab
  const [overviewId,  setOverviewId]  = useState(null);   // event shown in <EventOverview>
  useEffect(() => { if (userId) crm.loadAll(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep the per-customer event counts current as events are created, edited or deleted
  useEffect(() => { if (userId) crm.loadEventCounts(); }, [savedEvents]); // eslint-disable-line react-hooks/exhaustive-deps
  const customerById = Object.fromEntries(crm.customers.map(c => [c.id, c]));
  const leadSummary  = summariseLeads(crm.leads);
  const leadsDue     = leadSummary.dueToday + leadSummary.overdue;
  // Cross-links between the Leads / Customers tabs, the overview and the event tabs
  const openLead     = (id) => { setOverviewId(null); setLeadSel(id); setTab("leads"); };
  const openCustomer = (id) => { setOverviewId(null); setCustomerSel(id); setTab("customers"); };
  const openEventIn  = (ev, target) => { setOverviewId(null); selectEvent(ev, target); };
  const editEvent    = (ev) => setModalEvent({ ...ev, start_datetime: ev.start_datetime ? ev.start_datetime.slice(0,16) : "", end_datetime: ev.end_datetime ? ev.end_datetime.slice(0,16) : "" });
  /* ── Finance: accounts + per-event income / expenses ── */
  const fin = useFinance({ enabled: !!userId, showToast, askDialog, logHistory });
  const [financeSel, setFinanceSel] = useState(null);   // event open in the Finance tab
  useEffect(() => { if (tab === "finance" && !fin.loaded) fin.loadAll(); }, [tab, userId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Downloads the given transactions (the Finance tab's current date range) as Excel
  const exportFinance = async (txns) => {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.json_to_sheet(transactionExportRows(txns, { accounts: fin.accounts, events: savedEvents }));
    ws["!cols"] = [{ wch:12 }, { wch:24 }, { wch:9 }, { wch:16 }, { wch:12 }, { wch:18 }, { wch:24 }, { wch:18 }, { wch:30 }, { wch:26 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");
    XLSX.writeFile(wb, `Nikadi_Finance_${new Date().toISOString().slice(0,10)}.xlsx`);
  };
  /* ── Guide: live progress of the open event + first-run welcome ── */
  const openEventRow = savedEvents.find(e => e.id === savedEventId);   // DB row (has customer_id / lead_id)
  // WhatsApp template / SMS sender for the open event: its own choice, else the Settings default
  const activeWaTemplates = access.waTemplates.filter(t => t.active);
  useEffect(() => {
    const t = resolveChoice(access.waTemplates, openEventRow?.wa_template, "name");
    if (t) setWaTemplate(t.name);
  }, [savedEventId, access.waTemplates, openEventRow?.wa_template]);
  const waAccount = access.waTemplates.find(t => t.name === waTemplate)?.account || access.settings.wa_account || "Nikadi";
  const smsSender = resolveChoice(access.senderIds, openEventRow?.sms_sender_id, "sender_id")?.sender_id || smsSettings.senderId || "NIKADI";
  // Remembers the event's choice of template / sender (when the role may change it)
  const rememberForEvent = async (col, value, module) => {
    if (!supabase || !savedEventId || !access.can(module, "edit")) return;
    const { error } = await supabase.from("events").update({ [col]: value }).eq("id", savedEventId);
    if (error) { if (!/column|schema cache/i.test(error.message)) showToast(`Could not save the choice: ${error.message}`, "warn"); return; }
    setSavedEvents(es => es.map(e => e.id === savedEventId ? { ...e, [col]: value } : e));
  };
  const chooseWaTemplate = (name) => { setWaTemplate(name); rememberForEvent("wa_template", name, "whatsapp"); };
  const guide = guideProgress({
    hasEvent:    !!savedEventId,
    hasCustomer: !!openEventRow?.customer_id,
    hasLead:     !!openEventRow?.lead_id || crm.leads.some(l => l.event_id && l.event_id === savedEventId),
    hasDesign:   !!(coverUrl || bgImage),
    guests:      records.filter(r => !r.sample).length,
    uploaded:    records.filter(r => r.uploadStatus === "uploaded").length,
    waSent:      records.filter(r => r.waStatus === WA.sent).length,
    smsSent:     records.filter(r => r.smsStatus === SMS.sent || r.smsStatus === SMS.delivered).length,
    txns:        savedEventId ? fin.txns.filter(t => t.event_id === savedEventId).length : 0,
  });
  useEffect(() => { if (tab === "guide" && !fin.loaded) fin.loadAll(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [welcome, setWelcome] = useState(() => { try { return !localStorage.getItem("nikadi_guide_seen"); } catch { return false; } });
  const closeWelcome = (toGuide) => {
    try { localStorage.setItem("nikadi_guide_seen", "1"); } catch { /* private mode: show again next time */ }
    setWelcome(false);
    if (toGuide) setTab("guide");
  };
  const newEventForCustomer = (c) => setModalEvent({ ...BLANK_EVENT, username: c.name, phone: c.phone || "", region: c.region || "", customer_id: c.id });

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
  const applySavedTemplate = async (tpl, { keepLayout = false } = {}) => {
    if (!tpl.cover_image_url) {
      if (keepLayout) return;
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
            if (keepLayout) pendingDbLayout.current = elements;
            else if (Array.isArray(tpl.elements_layout) && tpl.elements_layout.length) {
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
  const onBgUpload = (e, { keepLayout = false } = {}) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result;
      const fp      = templateFingerprint(dataUrl, f.name);
      const probe   = new Image();
      probe.onload = async () => {
        setBgImage(dataUrl);
        setBgSize({ w:probe.naturalWidth, h:probe.naturalHeight });
        if (keepLayout) pendingDbLayout.current = elements;
        setTemplateKey(fp); // triggers the layout-restore effect
        showToast(`Template loaded — ${probe.naturalWidth}×${probe.naturalHeight}px`, "success");
        if (supabase) {   // always store the new image so the event points at it
          const url = await uploadTemplateToStorage(dataUrl);
          if (url) { setCoverUrl(url); showToast("Template saved to cloud storage", "success"); }
        }
      };
      probe.src = dataUrl;
    };
    reader.readAsDataURL(f);
  };

  // "Change template" pop-up → swap the card design for the open event. Guests, SMS and
  // statuses stay; cards already uploaded/sent used the old design, so warn first.
  const changeTemplate = async (choice, { keepLayout }) => {
    const made = records.filter(r => !r.sample && (r.uploadStatus === "uploaded" || r.waStatus === WA.sent)).length;
    if (made) {
      const ok = await askDialog({
        title: "Change the card template?",
        body: `${made} card${made === 1 ? " was" : "s were"} already uploaded or sent with the current design. Guests who already got a card keep the old one; upload the cards again before sending more so new cards use the new design.`,
        actions: [{ value: "yes", label: "Change template", kind: "primary" }],
      });
      if (ok !== "yes") return false;
    }
    setPickingTemplate(false);
    // The old design is replaced: cards rendered with it are cleared so they get re-made
    setRecords(rs => rs.map(r => r.uploadStatus === "uploaded" || r.cardUrl ? { ...r, uploadStatus: "idle", cardUrl: null } : r));
    if (choice.file) { setCoverUrl(null); onBgUpload({ target: { files: [choice.file] } }, { keepLayout }); }
    else await applySavedTemplate(choice.tpl, { keepLayout });
    if (savedEventId) setDesignSaveFor(savedEventId);   // written to the event once the image + layout settle
    return true;
  };

  // After "Change template", store the new background + layout on the event straight away,
  // so reopening the event (on any device) reads the new design, not the old one.
  useEffect(() => {
    if (!designSaveFor || !supabase || loadingTemplate || !coverUrl) return;
    const t = setTimeout(async () => {
      const id = designSaveFor;
      setDesignSaveFor(null);
      if (id !== savedEventId) return;
      const { error } = await supabase.from("events").update({ cover_image_url: coverUrl, elements_layout: elements }).eq("id", id);
      if (error) { showToast(`Template changed on screen but not saved: ${error.message} — press Save Event`, "warn"); return; }
      logHistory({ channel: "event", action: "update", detail: "Card template changed" }, id);
      loadSavedEvents();
      showToast("Template changed and saved to this event — upload the cards again before sending", "success");
    }, 800);
    return () => clearTimeout(t);
  }, [designSaveFor, coverUrl, elements, loadingTemplate]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Only the event-form fields (EVENT_FORM_FIELDS) are written — the Edit button passes
  // the whole DB row, and writing that back would restore stale copies of other columns
  // (sms_draft, sms_messages…). The designer's cover image, element layout and SMS
  // message are stamped only onto the event that is open in the designer, or a brand-new one.
  const persistEvent = async (formData, currentId = savedEventId) => {
    if (!supabase) { showToast("Supabase not configured","warn"); return null; }
    setIsSaving(true);
    try {
      const isLoadedEvent = !currentId || currentId === savedEventId;
      const fields = Object.fromEntries(EVENT_FORM_FIELDS.filter(k => k in formData)
        .map(k => [k, NULLABLE_EVENT_FIELDS.includes(k) && formData[k] === "" ? null : formData[k]]));
      const payload = {
        ...fields,
        ...(isLoadedEvent ? { cover_image_url: coverUrl||null, elements_layout: elements, sms_message: smsMessage } : {}),
        start_datetime: formData.start_datetime||null,
        end_datetime:   formData.end_datetime||null,
      };
      if (currentId) {
        const { error } = await supabase.from("events").update(payload).eq("id", currentId);
        if (error) throw error;
        if (isLoadedEvent) { smsPersistedMsg.current = smsMessage; smsDraftBase.current = smsMessage; }
        logHistory({ channel:"event", action:"update", detail:`Event details saved: ${formData.username || ""}` }, currentId);
        if (isLoadedEvent) setEventData(formData);   // editing another event must not relabel the open one
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
    const toRow = r => ({
      event_id:   eventId,
      name:       r.name||"",
      card_type:  r.cardType||"",
      phone:      r.phone||"",
      wa_status:  r.waStatus||WA.idle,
      sms_status: r.smsStatus||SMS.pending,
    });
    // Rows that already exist keep their id (printed QR codes carry it) and their scan /
    // call progress: they're updated in place. New rows are inserted; rows no longer in
    // the list are deleted last, so a failed save never loses contacts.
    const oldIds = new Set((old || []).map(o => o.id));
    const keep   = entries.filter(({ r }) => r.dbId && oldIds.has(r.dbId));
    const fresh  = entries.filter(({ r }) => !(r.dbId && oldIds.has(r.dbId)));
    if (keep.length) {
      const { error } = await supabase.from("event_cards").upsert(keep.map(({ r }) => ({ id: r.dbId, ...toRow(r) })));
      if (error) { showToast("Cards save error: " + error.message, "warn"); return; }
    }
    if (fresh.length) {
      const { data: inserted, error } = await supabase.from("event_cards").insert(fresh.map(({ r }) => toRow(r))).select("id");
      if (error) { showToast("Cards save error: " + error.message, "warn"); return; }
      // Remember each new row's database id so per-card status updates (autoSaveCard) can target it
      if (inserted?.length === fresh.length) {
        const ids = new Map(fresh.map(({ i }, n) => [i, inserted[n].id]));
        setRecords(rs => rs.map((r, i) => ids.has(i) ? { ...r, dbId: ids.get(i) } : r));
      }
    }
    const kept = new Set(keep.map(({ r }) => r.dbId));
    const gone = (old || []).map(o => o.id).filter(id => !kept.has(id));
    if (gone.length) {
      const { error: delErr } = await supabase.from("event_cards").delete().in("id", gone);
      if (delErr) { showToast("Cards saved, but removed rows could not be deleted: " + delErr.message, "warn"); return; }
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
  // Contacts already sent are never skipped silently: the dialog lists them and offers
  // "Send again to all", so a resend is always a deliberate choice.
  const pickBulkRecipients = async ({ title, emptyMsg, options, recs = records }) => {
    const { targets: fresh, skipped, duplicateGroups } = selectRecipients(recs, { ...options, allowDuplicates: true });
    // The same selection with nobody counted as done — the "send again" list
    const { targets: everyone } = selectRecipients(recs, { ...options, isDone: () => false, allowDuplicates: true });
    const freshIdx = new Set(fresh.map(t => t.index));
    const resent   = everyone.filter(t => !freshIdx.has(t.index));   // already received this message
    const note = describeSkipped({ ...skipped, alreadySent: 0 });
    if (!everyone.length) { showToast(`${emptyMsg} ${note}`.trim(), "warn"); return null; }
    const all    = fresh;
    const unique = dropDuplicates(all);
    const extra  = all.length - unique.length;   // records that repeat another record's number
    const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    const resendBox = resent.length > 0 && (
      <div style={{marginTop:14,padding:12,borderRadius:10,background:N.amberBg,border:`1px solid ${alpha(N.amber,"55")}`}}>
        <div style={{color:N.amber,fontWeight:700,marginBottom:6}}>
          <Icon n="alert" /> {plural(resent.length, "contact")} already received this message
        </div>
        <div className="nk-dialog-list">
          {resent.slice(0, 6).map(t => <div key={t.index}>{t.rec.name || "(no name)"} <span className="num">+{normalisePhone(t.rec.phone)}</span></div>)}
          {resent.length > 6 && <div style={{color:N.textDim}}>…and {resent.length - 6} more</div>}
        </div>
        <div style={{marginTop:8,fontSize:12,color:N.textDim}}>
          <strong>Send again to all</strong> messages them a second time and uses extra credit.
        </div>
      </div>
    );
    const resendAction = resent.length ? [{ value:"again", label:`Send again to all (${everyone.length})`, kind:"warn" }] : [];
    if (!all.length) {
      // Everyone eligible was already sent — the only way forward is a deliberate resend
      const choice = await askDialog({
        title: `${title} — already sent`,
        body: (
          <>
            <div>Every contact on this list has already been sent this message.</div>
            {resendBox}
            {note && <div style={{marginTop:12,fontSize:12,color:N.textDim}}>{note}</div>}
          </>
        ),
        actions: resendAction,
      });
      return choice === "again" ? everyone : null;
    }
    const choice = await askDialog({
      title,
      body: (
        <>
          <div>
            <strong style={{color:N.text}}>{plural(unique.length, "new contact")}</strong> ready to send{extra ? " (without duplicates)" : ""}.
          </div>
          {resendBox}
          {extra > 0 && (
            <div style={{marginTop:14}}>
              <div style={{color:N.amber,fontWeight:700,marginBottom:6}}>
                <Icon n="alert" /> {plural(extra, "extra record")} {extra === 1 ? "shares" : "share"} a number with another contact
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
      actions: [
        ...resendAction,
        ...(extra > 0
          ? [{ value:"unique", label:`Send without duplicates (${unique.length})`, kind:"success" },
             { value:"all",    label:`Send duplicates too (${all.length})`,        kind:"warn" }]
          : [{ value:"all", label: resent.length ? `Send to new only (${all.length})` : `Send to ${plural(all.length, "contact")}`, kind:"success" }]),
      ],
    });
    return choice === "unique" ? unique : choice === "all" ? all : choice === "again" ? everyone : null;
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
        account:  waAccount,
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
      showToast(`Saved nikadi_cards.zip (${records.length} cards)`, "success");
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
          from: smsSender,
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
        from: smsSender,
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
  if (access.loading) return (
    <div style={{minHeight:"100vh",background:N.navy900,display:"grid",placeItems:"center"}}>
      <style>{CSS}</style>
      <EmptyState loading title="Checking your access…" />
    </div>
  );
  if (!access.setupMissing && !access.role) return <NoAccess email={user.email} name={user.user_metadata?.full_name} avatar={user.user_metadata?.avatar_url} onRetry={access.loadAll} onSignOut={() => supabase?.auth.signOut()} />;
  const tabModule = TAB_MODULE[tab];
  const viewOnly  = !access.setupMissing && tabModule && tab !== "settings" && !access.can(tabModule, "edit");
  const canDeleteData = access.setupMissing || access.role === "superuser";

  return (
    <CanDeleteContext.Provider value={canDeleteData}>
      <style>{CSS}</style>
      <div className="nk-app">

        {/* Toast */}
        {toast && (
          <div className={`nk-toast toast-${toast.type}`}>
            <span className="nk-toast-icon">{toast.type==="success"?<><Icon n="check" /></>:toast.type==="warn"?<><Icon n="alert" /></>:<><Icon n="info" /></>}</span>
            <span>{toast.msg}</span>
          </div>
        )}

        {/* Event modal */}
        {modalEvent !== null && (
          <EventModal initial={modalEvent} onSave={onModalSave} onClose={() => setModalEvent(null)} saving={isSaving} customers={crm.customers} />
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

        {/* Event overview: everything related to one event */}
        {overviewId && (
          <EventOverview key={overviewId} eventId={overviewId} onClose={() => setOverviewId(null)} onSwitch={setOverviewId}
            onOpen={openEventIn} onEdit={(ev) => { setOverviewId(null); editEvent(ev); }}
            onOpenCustomer={openCustomer} onOpenLead={openLead}
            onOpenFinance={(id) => { setOverviewId(null); setFinanceSel(id); loadSavedEvents(); setTab("finance"); }}
            team={access.setupMissing ? null : { team: teamsByEvent[overviewId] || [], canManage: canManageTeams, people, peopleError, onLoadPeople: loadPeople,
              onAdd: (email, task) => addToTeam(overviewId, email, task), onRemove: (a) => removeFromTeam(overviewId, a) }} />
        )}

        {/* Choice dialog (bulk-send / re-send confirmations) */}
        {dialog && (
          <div className="nk-overlay nk-top">
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
          <div className="nk-overlay nk-top">
            <div className="nk-confirm">
              <div className="nk-confirm-title">Delete Event?</div>
              <div className="nk-confirm-body">
                This will permanently delete <strong style={{color:N.text}}>"{deleteTarget.username}"</strong> and all its cards and history from the database. This cannot be undone.
              </div>
              <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button className="nk-btn nk-btn-ghost" onClick={()=>setDeleteTarget(null)}>Cancel</button>
                <button className="nk-btn nk-btn-danger" onClick={()=>deleteEvent(deleteTarget)}><Icon n="trash" /> Delete</button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <header className="nk-header">
          <button className="nk-menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen}>
            <Icon n="menu" />
          </button>
          <div className="nk-logo">
            <div className="nk-logo-icon"><Logo title="Nikadi" /></div>
            <div>
              <div className="nk-logo-name">Nikadi Studio</div>
              <div className="nk-logo-tag nk-hide-md">Card Design & Dispatch</div>
            </div>
          </div>
          <div className="nk-hide-md" style={{display:"flex",alignItems:"center",gap:6,marginLeft:16}}>
            <div className={`nk-db-dot ${dbDot}`} title={dbStatus} />
            <span style={{fontSize:11,color:N.textDim}}>{dbStatus === "connected" ? <>Supabase <Icon n="check" /></> : dbStatus === "unconfigured" ? "No DB" : "DB Error"}</span>
          </div>
          <div className="nk-header-actions">
            {savedEventId && (
              <span className="nk-hide-lg nk-ellipsis" style={{fontSize:11,color:N.green,fontFamily:"JetBrains Mono, monospace",maxWidth:220}}>
                <Icon n="dot" /> {eventData.username||"Event"}{eventData.event_type ? ` · ${eventData.event_type}` : ""}
              </span>
            )}
            <button className="nk-btn nk-btn-success" onClick={sendWaAll} disabled={bulkSending}
              title="Send every card on WhatsApp" aria-label={`WhatsApp send all (${records.filter(r=>r.phone).length})`}>
              {bulkSending ? <Icon n="loader" /> : <Icon n="whatsapp" />}
              <span className="nk-btn-label">{bulkSending ? "Sending…" : `WA Send All (${records.filter(r=>r.phone).length})`}</span>
            </button>
            <button className="nk-btn nk-btn-primary" onClick={downloadAll} title="Download every card" aria-label={`Download all ${records.length} cards`}>
              <Icon n="download" /> <span className="nk-btn-label">Download All ({records.length})</span>
            </button>
            {access.role && <span className="nk-hide-md" title={access.setupMissing ? "Roles not set up yet — everyone has full access" : access.role === "superuser" ? "Your role — only Super Admins can delete data" : "Your role"}><RoleBadge role={access.role} /></span>}
            <button className="nk-btn nk-btn-ghost" style={{padding:"6px 10px",fontSize:12}} onClick={() => goTab("guide")}
              title="How Nikadi Studio works" aria-label="Help: how Nikadi Studio works">
              <Icon n="help" /> <span className="nk-btn-label">Help</span>
            </button>
            {/* Theme: System (follows the browser) → Light → Dark */}
            <button className="nk-btn nk-btn-ghost nk-hide-md" style={{padding:"6px 10px",fontSize:12}}
              onClick={()=>setThemePref(nextThemePref(themePref))}
              title={`Theme: ${THEME_LABELS[themePref]} — click to change`}
              aria-label={`Theme: ${THEME_LABELS[themePref]}. Click to change.`}>
              <Icon n={THEME_ICONS[themePref]} /> {THEME_LABELS[themePref]}
            </button>
            <div className="nk-hide-md" style={{display:"flex",alignItems:"center",gap:8,marginLeft:4,paddingLeft:12,borderLeft:`1px solid ${N.border}`}}>
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

        {/* Tabs — wide screens: grouped tab bar; small screens: the drawer below */}
        <nav className="nk-tabs" aria-label="Main" onMouseLeave={() => setNavOpen(null)}>
          {navGroups.map((g, gi) => {
            const current = g.items.some(it => it.id === tab);
            const due = g.items.some(it => it.id === "leads") && leadsDue > 0;
            const tabBtn = (it) => (
              <button key={it.id} className={`nk-tab${tab===it.id?" active":""}`} aria-current={tab===it.id ? "page" : undefined} onClick={() => goTab(it.id)}>
                <Icon n={it.icon} /> {it.label}
                {it.id === "leads" && leadsDue > 0 && <span className="nk-count" title="Follow-ups due today or overdue">{leadsDue}</span>}
              </button>
            );
            return (
              <div key={g.label} className="nk-tab-group">
                {gi > 0 && <span className="nk-tab-sep" aria-hidden="true" />}
                {current || g.items.length === 1 ? (
                  <>
                    {g.items.length > 1 && <span className="nk-tab-group-label">{g.label}</span>}
                    {g.items.map(tabBtn)}
                  </>
                ) : (
                  // Collapsed group: hover, keyboard focus or a tap opens its sub-menu
                  <div className={`nk-navdrop${navOpen === g.label ? " open" : ""}`} onMouseEnter={() => setNavOpen(null)}>
                    <button className="nk-tab" aria-haspopup="menu" aria-expanded={navOpen === g.label}
                      onClick={() => setNavOpen(o => (o === g.label ? null : g.label))}>
                      <Icon n={g.icon || g.items[0].icon} /> {g.label}
                      {due && <span className="nk-count" title="Follow-ups due today or overdue">{leadsDue}</span>}
                      <Icon n="chevronDown" className="nk-navdrop-caret" />
                    </button>
                    <div className="nk-navdrop-menu" role="menu" aria-label={g.label}>
                      {g.items.map(it => (
                        <button key={it.id} role="menuitem" className="nk-navdrop-item" onClick={() => { setNavOpen(null); goTab(it.id); }}>
                          <Icon n={it.icon} /> <span style={{flex:1}}>{it.label}</span>
                          {it.id === "leads" && leadsDue > 0 && <span className="nk-count">{leadsDue}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {welcome && <WelcomeModal name={user.user_metadata?.full_name} onClose={() => closeWelcome(false)} onGuide={() => closeWelcome(true)} />}

        {/* Mobile drawer */}
        {menuOpen && (
          <div className="nk-drawer-overlay" onClick={e => e.target === e.currentTarget && setMenuOpen(false)}>
            <aside className="nk-drawer" role="dialog" aria-modal="true" aria-label="Menu">
              <div className="nk-drawer-head">
                <div className="nk-logo">
                  <div className="nk-logo-icon"><Logo title="Nikadi" /></div>
                  <div className="nk-logo-name">Nikadi Studio</div>
                </div>
                <button className="nk-modal-close" onClick={() => setMenuOpen(false)} aria-label="Close menu"><Icon n="x" /></button>
              </div>
              {savedEventId && (
                <div className="nk-drawer-event"><Icon n="dot" style={{color:N.green}} /> <span className="nk-ellipsis">{eventData.username||"Event"}{eventData.event_type ? ` · ${eventData.event_type}` : ""}</span></div>
              )}
              <nav aria-label="Main">
                {navGroups.map(g => (
                  <div key={g.label} className="nk-drawer-group">
                    <div className="nk-drawer-label">{g.label}</div>
                    {g.items.map(it => (
                      <button key={it.id} className={`nk-drawer-item${tab===it.id?" active":""}`} aria-current={tab===it.id ? "page" : undefined} onClick={() => goTab(it.id)}>
                        <Icon n={it.icon} /> <span style={{flex:1}}>{it.label}</span>
                        {it.id === "leads" && leadsDue > 0 && <span className="nk-count">{leadsDue}</span>}
                      </button>
                    ))}
                  </div>
                ))}
              </nav>
              <div className="nk-drawer-foot">
                <button className="nk-drawer-item" onClick={() => setThemePref(nextThemePref(themePref))}>
                  <Icon n={THEME_ICONS[themePref]} /> <span style={{flex:1}}>Theme</span><span style={{fontSize:12,color:N.textDim}}>{THEME_LABELS[themePref]}</span>
                </button>
                <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px"}}>
                  {user.user_metadata?.avatar_url
                    ? <img src={user.user_metadata.avatar_url} alt="" style={{width:32,height:32,borderRadius:"50%",objectFit:"cover"}} />
                    : <Icon n="user" size="1.4em" />}
                  <div style={{flex:1,minWidth:0}}>
                    <div className="nk-ellipsis" style={{fontSize:13,color:N.text,fontWeight:600}}>{user.user_metadata?.full_name || user.email}</div>
                    {access.role && <div style={{margin:"2px 0"}}><RoleBadge role={access.role} /></div>}
                    <div style={{fontSize:11,color:N.textDim,display:"flex",alignItems:"center",gap:5}}><span className={`nk-db-dot ${dbDot}`} /> {dbStatus === "connected" ? "Connected" : dbStatus === "unconfigured" ? "No database" : "Database error"}</div>
                  </div>
                  <button className="nk-btn nk-btn-ghost" style={{fontSize:12,padding:"6px 10px"}} onClick={() => supabase?.auth.signOut()}>Sign out</button>
                </div>
              </div>
            </aside>
          </div>
        )}

        {viewOnly && (
          <div className="nk-banner" role="note">
            <span style={{fontSize:16,marginTop:1}}><Icon n="lock" /></span>
            <span><strong>View only.</strong> Your role ({ROLE_LABEL[access.role]}) can see {TAB_LABEL[tab]} but not change it — ask an administrator if you need more access.</span>
          </div>
        )}

        {/* Info banners */}
        {tab==="batch" && (
          <div className="nk-banner">
            <span style={{fontSize:16,marginTop:1}}><Icon n="info" /></span>
            <span><strong>WhatsApp Sending:</strong> Select an image in the <strong>WhatsApp</strong> tab, then use <strong style={{color:N.green}}><Icon n="whatsapp" /> WA</strong> per row or <strong style={{color:N.green}}>WA Send All</strong> in the header. 1 second gap per number.</span>
          </div>
        )}
        {tab==="vcard" && (
          <div className="nk-banner">
            <span style={{fontSize:16,marginTop:1}}><Icon n="info" /></span>
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
                      aria-label="Clear selected event" title="Clear" style={{background:"none",border:"none",color:N.red,cursor:"pointer",fontSize:16}}
                    ><Icon n="x" /></button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      className="nk-input"
                      value={eventSearch}
                      onChange={e=>setEventSearch(e.target.value)}
                      onFocus={()=>setEventDropdownOpen(true)}
                      placeholder="Type to search…"
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
                    <span><Icon n="loader" /></span> Loading template from database…
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
                  <span className="nk-upload-icon"><Icon n="image" /></span>
                  <span className="nk-upload-label">Upload Template</span>
                  <span className="nk-upload-sub">PNG · JPG · SVG — positions auto-saved</span>
                </label>
                {bgSize && (
                  <div className="nk-chip">
                    <Icon n="ruler" /> {bgSize.w} × {bgSize.h} px<br/>
                    <span className="nk-chip-ok"><Icon n="check" /> Canvas locked to image</span>
                    {coverUrl && <><br/><span className="nk-chip-ok"><Icon n="cloud" /> Saved to cloud</span></>}
                    {layoutRestored && <><br/><span className="nk-chip-ok"><Icon n="repeat" /> Layout restored</span></>}
                  </div>
                )}
                {(bgImage || savedTemplates.length > 0) && (
                  <button className="nk-btn nk-btn-primary nk-btn-full" style={{fontSize:12,marginBottom:6}} onClick={() => setPickingTemplate(true)}>
                    <Icon n="repeat" /> {bgImage ? "Change template" : "Choose a saved template"}
                  </button>
                )}
                {bgImage && (
                  <div style={{display:"flex",gap:6}}>
                    <button className="nk-btn nk-btn-ghost nk-btn-full" style={{fontSize:11}} onClick={resetTemplate}><Icon n="x" /> Remove</button>
                    {templateKey && <button className="nk-btn nk-btn-ghost nk-btn-full" style={{fontSize:11}} onClick={resetLayout} title="Reset element positions to defaults"><Icon n="undo" /> Reset Layout</button>}
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
                      <button className="nk-btn nk-btn-ghost" style={{fontSize:11,padding:"4px 8px"}} onClick={()=>setShowSaveTemplate(false)} aria-label="Cancel saving template" title="Cancel"><Icon n="x" /></button>
                    </div>
                  ) : (
                    <button className="nk-btn nk-btn-ghost nk-btn-full" style={{fontSize:11,marginTop:6}} onClick={()=>{ setShowSaveTemplate(true); setTemplateSaveName(""); }}>
                      <Icon n="save" /> Save as Template
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
                          <Icon n="image" /> {tpl.name}
                        </button>
                        {canDeleteData && (<button
                          className="nk-btn nk-btn-ghost"
                          style={{fontSize:10,padding:"3px 7px",color:N.red||"#f87171",flexShrink:0}}
                          title="Delete template" aria-label="Delete template"
                          onClick={()=>deleteSavedTemplate(tpl)}
                        ><Icon n="x" /></button>)}
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
                    <span><Icon n="ban" /></span>
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
                    <Icon n="save" /> Save Layout to DB
                  </button>
                )}
              </div>

              {/* Contacts */}
              <div>
                <div className="nk-sec">Contacts (Cards)</div>
                <label className="nk-upload">
                  <input type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={onExcelUpload} />
                  <span className="nk-upload-icon"><Icon n="table" /></span>
                  <span className="nk-upload-label">Upload Spreadsheet</span>
                  <span className="nk-upload-sub">Name · CardType · Phone</span>
                </label>
                {savedEventId && records.length > 0 && (
                  <button className="nk-btn nk-btn-ghost nk-btn-full" style={{fontSize:11,marginTop:4}}
                    onClick={()=>saveCards(savedEventId)}>
                    <Icon n="save" /> Save Cards to DB ({records.length})
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
                    <button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={loadSavedEvents}><Icon n="undo" /> Refresh</button>
                    <button className="nk-btn nk-btn-primary" onClick={()=>setModalEvent(BLANK_EVENT)}>+ New Event</button>
                  </div>
                </div>

                {!supabase && (
                  <div style={{background:N.navy800,borderRadius:16,border:`1px solid ${N.border}`}}>
                    <EmptyState icon="plug" tone="warn" title="Supabase not configured" text={<>Add <code style={{fontFamily:"JetBrains Mono, monospace",color:N.sky}}>VITE_SUPABASE_URL</code> and <code style={{fontFamily:"JetBrains Mono, monospace",color:N.sky}}>VITE_SUPABASE_ANON_KEY</code> to <code style={{fontFamily:"JetBrains Mono, monospace",color:N.sky}}>.env.local</code> and restart the dev server.</>} />
                  </div>
                )}

                {supabase && !eventsLoaded && savedEvents.length === 0 && <EmptyState loading title="Loading events…" />}

                {supabase && eventsLoaded && savedEvents.length === 0 && (
                  <div style={{background:N.navy800,borderRadius:16,border:`1px solid ${N.border}`}}>
                    <EmptyState icon="folder" title="No events yet" text="Create your first event, then design its cards, import guests and send."
                      action={<button className="nk-btn nk-btn-primary" onClick={()=>setModalEvent(BLANK_EVENT)}><Icon n="plus" /> Create First Event</button>} />
                  </div>
                )}

                {supabase && savedEvents.length > 0 && !access.setupMissing && (
                  <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
                    {access.seesAllEvents && [["all","All events"],["mine","Assigned to me"]].map(([k,l]) => (
                      <button key={k} style={segStyle(eventsScope === k)} onClick={() => setEventsScope(k)}>{l}</button>
                    ))}
                    <span style={{fontSize:11,color:N.textDim}}>
                      {access.seesAllEvents ? "Your role sees every event." : "You see the events you're assigned to or created."}
                    </span>
                  </div>
                )}
                {supabase && savedEvents.length > 0 && (
                  <div className="nk-table-wrap">
                    <table className="nk-table">
                      <thead>
                        <tr>
                          {["#","Username","Type","Venue","Date","Status",...(access.setupMissing ? [] : ["Team"]),"Actions"].map(h=><th key={h}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {(eventsScope === "mine" && access.seesAllEvents ? eventsAssignedTo(savedEvents, teamsByEvent, myEmail) : savedEvents).map((ev, i) => (
                          <tr key={ev.id} className={savedEventId===ev.id?"row-active":""}
                            onClick={()=>selectEvent(ev)}
                            style={{cursor:"pointer"}}
                            title="Click to load this event and open its design">
                            <td style={{color:N.textDim,fontFamily:"JetBrains Mono, monospace",fontSize:11}}>{i+1}</td>
                            <td>
                              <div style={{fontWeight:700,color:N.text}}>{ev.username}</div>
                              {ev.phone && <div style={{fontSize:11,color:N.textDim,fontFamily:"JetBrains Mono, monospace"}}>+{normalisePhone(ev.phone)}</div>}
                              {customerById[ev.customer_id] && (
                                <button onClick={(e)=>{ e.stopPropagation(); openCustomer(ev.customer_id); }} title="Open this customer"
                                  style={{background:"none",border:"none",padding:0,marginTop:2,cursor:"pointer",fontSize:11,color:N.green,fontFamily:"inherit"}}>
                                  <Icon n="user" /> {customerById[ev.customer_id].name}
                                </button>
                              )}
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
                            {!access.setupMissing && <td><TeamAvatars team={teamsByEvent[ev.id]} /></td>}
                            <td>
                              <div className="nk-row-actions">
                                <Sb bg={N.navy600} col={N.green} border={alpha(N.green,"44")}
                                  onClick={(e)=>{ e.stopPropagation(); setOverviewId(ev.id); }}
                                  title="Customer, lead, follow-ups, sending and history for this event">
                                  <Icon n="eye" /> Overview
                                </Sb>
                                <Sb bg={N.accent} col="#fff" border={N.accent}
                                  onClick={(e)=>{ e.stopPropagation(); createCardsFromEvent(ev); }}
                                  title="Load this event and open card designer">
                                  <Icon n="palette" /> Create Cards
                                </Sb>
                                <Sb bg={N.navy600} col={N.teal} border={alpha(N.teal,"44")}
                                  onClick={(e)=>{ e.stopPropagation(); selectEvent(ev, "reports"); }}
                                  title="View this event's cards and download the send report">
                                  <Icon n="report" /> Report
                                </Sb>
                                <Sb bg={N.navy600} col={N.purple} border={alpha(N.purple,"44")}
                                  onClick={(e)=>{ e.stopPropagation(); selectEvent(ev, "history"); }}
                                  title="Every card and SMS sent for this event, with results">
                                  <Icon n="history" /> History
                                </Sb>
                                <Sb bg={N.navy600} col={N.sky} border={alpha(N.sky,"44")}
                                  onClick={(e)=>{ e.stopPropagation(); editEvent(ev); }}
                                  title="Edit event details">
                                  <Icon n="edit" /> Edit
                                </Sb>
                                {canDeleteData && (<Sb bg={N.redBg} col={N.red} border={alpha(N.red,"44")}
                                  onClick={(e)=>{ e.stopPropagation(); setDeleteTarget(ev); }}
                                  title="Delete this event">
                                  <Icon n="trash" /> Delete
                                </Sb>)}
                                {ev.cover_image_url && (
                                  <Sb bg={N.navy700} col={N.textMid} border={N.border}
                                    onClick={(e)=>{ e.stopPropagation(); window.open(ev.cover_image_url,"_blank"); }}
                                    label="View card template" title="Opens the template image in a new tab">
                                    <Icon n="image" />
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

            {/* ─── LEADS / CUSTOMERS ─── */}
            {tab === "leads" && (
              <LeadsTab crm={crm} selectedId={leadSel} onSelect={setLeadSel}
                onOpenEvent={setOverviewId} onOpenCustomer={openCustomer} />
            )}
            {tab === "customers" && (
              <CustomersTab crm={crm} selectedId={customerSel} onSelect={setCustomerSel} eventsVersion={savedEvents}
                onOpenEvent={setOverviewId} onOpenLead={openLead} onNewEvent={newEventForCustomer} />
            )}

            {pickingTemplate && <TemplatePicker templates={savedTemplates} currentUrl={coverUrl} currentImage={bgImage} hasDesign={!!bgImage}
              onClose={() => setPickingTemplate(false)} onPick={changeTemplate} />}
            {shareView && openEventRow && <ShareViewModal eventRow={openEventRow} showToast={showToast} onClose={() => setShareView(false)} reloadEvents={loadSavedEvents} />}

            {/* ─── SETTINGS / SCANNER / CALLS ─── */}
            {tab === "settings" && <SettingsTab access={access} askDialog={askDialog} myEmail={(user.email || "").toLowerCase()} />}
            {tab === "scanner" && (
              <ScannerTab key={savedEventId || "none"} eventId={savedEventId} eventRow={openEventRow} access={access} myEmail={user.email}
                showToast={showToast} onGo={goTab} reloadEvents={loadSavedEvents} logHistory={logHistory} />
            )}
            {tab === "calls" && (
              <CallsTab key={savedEventId || "none"} eventId={savedEventId} eventRow={openEventRow} access={access} myEmail={user.email}
                showToast={showToast} logHistory={logHistory} onGo={goTab} reloadEvents={loadSavedEvents} />
            )}

            {/* ─── GUIDE ─── */}
            {tab === "guide" && (
              <GuideTab progress={guide} eventName={savedEventId ? (eventData.username || "Event") : null} onGo={goTab} />
            )}

            {/* ─── FINANCE ─── */}
            {tab === "finance" && (
              <FinanceTab fin={fin} events={savedEvents} eventsLoaded={eventsLoaded} customers={crm.customers} selectedId={financeSel} onSelect={setFinanceSel} onExport={exportFinance} />
            )}

            {/* ─── DESIGN ─── */}
            {tab === "design" && (
              <>
                <div className="nk-hint" style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",justifyContent:"center"}}>
                  <span>{bgSize ? `Canvas: ${cw}×${ch}px — matches template` : "Default 440×280 · Upload template to match dimensions"}</span>
                  {layoutRestored && <span className="nk-layout-chip"><Icon n="repeat" /> Layout restored</span>}
                  {!savedEventId && <span style={{color:N.amber,fontSize:11}}><Icon n="alert" /> No event loaded — <span style={{cursor:"pointer",textDecoration:"underline"}} onClick={()=>setTab("events")}>select one</span></span>}
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
                      <span className="nk-upload-icon"><Icon n="contact" /></span>
                      <span className="nk-upload-label">Upload CSV for VCard</span>
                      <span className="nk-upload-sub">Columns: Name · Phone</span>
                    </label>
                    {vcardContacts.length > 0 && (
                      <div className="nk-chip" style={{marginBottom:12}}>
                        <Icon n="contact" /> {vcardContacts.length} contacts loaded<br/>
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
                      <Icon n="download" /> Download .vcf File
                    </button>
                    {!eventData.username && (
                      <p style={{fontSize:11,color:N.amber,marginTop:8,textAlign:"center"}}>
                        <Icon n="alert" /> Load an event first to set the username
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
                      <EmptyState icon="contact" title="No contacts loaded" text="Upload a CSV with Name and Phone columns to preview the VCard contacts." />
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
                        <Icon n="plus" /> Add message
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
                            onClick={()=>deleteExtraMessage(activeExtra)} title="Delete this message" aria-label="Delete this message"><Icon n="trash" /></button>
                        </div>
                        <label className="nk-label">Send to</label>
                        <div style={{display:"flex",gap:5,marginBottom:8}}>
                          {[["contacts",<><Icon n="users" /> Event contacts</>],["upload",<><Icon n="file" /> Uploaded list</>]].map(([src,label]) => {
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
                            <Icon n="file" /> {activeExtra.fileName || "List"} — {activeExtra.recipients.length} recipients
                          </div>
                        )}
                        <div style={{display:"flex",gap:6}}>
                          <label className="nk-btn nk-btn-ghost" style={{flex:1,fontSize:11,padding:"6px 8px",textAlign:"center",cursor:"pointer"}}>
                            <input type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={onMessageListUpload} />
                            <Icon n="upload" /> {activeExtra.source === "upload" ? "Replace list" : "Upload list"}
                          </label>
                          <button className="nk-btn nk-btn-ghost" style={{flex:1,fontSize:11,padding:"6px 8px"}}
                            disabled={!vcardContacts.length}
                            title={vcardContacts.length ? `Use the ${vcardContacts.length} contacts loaded in the VCard tab` : "Upload a list in the VCard tab first"}
                            onClick={()=>setMessageList(activeExtra, { source:"upload", rows: vcardContacts, columns: vcardColumns, fileName:"VCard tab list" })}>
                            <Icon n="contact" /> Use VCard list
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
                              {extraMsgsSaved ? <><Icon n="check" /> saved</> : "auto-saves"}
                            </span>
                          : <span style={{fontSize:10,fontFamily:"JetBrains Mono, monospace",color: smsDraftSaved ? N.green : N.textDim, transition:"color 0.3s"}}>
                              {smsDraftSaved ? <><Icon n="check" /> draft saved</> : "draft auto-saves"}
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
                          {smsMsgSaving?<><Icon n="loader" /> Saving…</>:<><Icon n="save" /> Save Template</>}
                        </button>
                      )}
                      {!activeExtra && savedEventId && smsMessage!==smsPersistedMsg.current && (
                        <span style={{fontSize:11,color:N.amber}}><Icon n="dot" /> Unsaved changes</span>
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
                        {smsBalanceLoading?<><Icon n="loader" /></>:<><Icon n="refresh" /></>} Refresh
                      </button>
                    </div>
                    <div style={{background:N.tealBg,border:`1.5px solid ${alpha(N.teal,"55")}`,borderRadius:10,padding:"18px 20px",marginBottom:14,textAlign:"center"}}>
                      {smsBalanceLoading ? (
                        <div style={{color:N.textDim,fontSize:13,padding:"8px 0"}} role="status"><Icon n="loader" /> Checking balance…</div>
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
                    <label className="nk-label" htmlFor="nk-sms-sender">Sender ID</label>
                    <select id="nk-sms-sender" className="nk-select" value={smsSender} disabled={!access.can("sms","edit")}
                      onChange={e => rememberForEvent("sms_sender_id", e.target.value, "sms")} title="The name guests see as the SMS sender">
                      {(access.senderIds.filter(x => x.active).length ? access.senderIds.filter(x => x.active).map(x => x.sender_id) : [smsSender]).map(id => <option key={id} value={id}>{id}</option>)}
                    </select>
                    <button className="nk-btn nk-btn-teal nk-btn-full" onClick={()=>sendAllSms(activeMsgId)} disabled={smsSending}>
                      {smsSending?<><Icon n="loader" /> Sending…</>:<><Icon n="sms" /> {`Send ${activeExtra ? `"${activeExtra.title}"` : "SMS"} to All (${activeRecipients.filter(r=>r.phone).length})`}</>}
                    </button>
                    <button className="nk-btn nk-btn-ghost nk-btn-full" onClick={downloadSmsCsv}>
                      <Icon n="download" /> Download SMS CSV
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
                              <span><Icon n="dot" /><Icon n="dot" /><Icon n="dot" /></span><span>WiFi</span><span><Icon n="battery" /></span>
                            </div>
                          </div>
                          {/* nav bar */}
                          <div style={{background:"#f5f5f5",borderBottom:"1px solid #e0e0e0",padding:"6px 12px",display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                            <span style={{fontSize:16,color:"#007aff"}}>‹</span>
                            <div style={{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,#0a7ea4,#0d9da8)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#fff",flexShrink:0}}><Logo /></div>
                            <div style={{flex:1}}>
                              <div style={{fontSize:11,fontWeight:700,color:"#000",lineHeight:1.2}}>NIKADI</div>
                              <div style={{fontSize:9,color:"#8e8e93"}}>Text Message</div>
                            </div>
                            <span style={{fontSize:14,color:"#007aff"}}><Icon n="phone" /></span>
                          </div>
                          {/* message area */}
                          <div style={{flex:1,minHeight:0,padding:"10px 8px",overflowY:"auto",display:"flex",flexDirection:"column",gap:6,background:"#fff"}}>
                            {/* timestamp */}
                            <div style={{textAlign:"center",fontSize:9,color:"#8e8e93",marginBottom:4,marginTop:"auto"}}>Today 9:41 AM</div>
                            {/* received bubble */}
                            <div style={{display:"flex",alignItems:"flex-end",gap:4}}>
                              <div style={{width:20,height:20,borderRadius:"50%",background:"linear-gradient(135deg,#0a7ea4,#0d9da8)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,color:"#fff",flexShrink:0}}><Logo /></div>
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
                            <span style={{fontSize:14,color:"#007aff"}}><Icon n="plus" /></span>
                            <div style={{flex:1,background:"#fff",border:"1px solid #c7c7cc",borderRadius:14,padding:"4px 10px",fontSize:9,color:"#c7c7cc"}}>iMessage</div>
                            <span style={{fontSize:14,color:"#007aff"}}><Icon n="mic" /></span>
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
                        <span style={{fontSize:16}}><Icon n="download" /></span> Download SMS Report (.xlsx)
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
                                  {rec.smsStatus===SMS.delivered?<><Icon n="check" /> Delivered</>:rec.smsStatus===SMS.sent?<><Icon n="arrowUp" /> Sent</>:rec.smsStatus===SMS.failed?<><Icon n="xCircle" /> Failed</>:<><Icon n="circle" /> Pending</>}
                                </span>
                              </td>
                              <td>{rec.phone?<Sb bg={N.tealBg} col={N.teal} border={alpha(N.teal,"44")} onClick={()=>sendSmsToOne(i, activeMsgId)} label="Send this SMS to the contact"><Icon n="sms" /> Send</Sb>:<span style={{fontSize:11,color:N.textDim}}>—</span>}</td>
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
                      {uploadingCards ? <><Icon n="loader" /> Uploading…</> : <><Icon n="cloud" /> {`Upload All Cards (${records.length})`}</>}
                    </button>
                    <CardStoragePanel key={uploadingCards ? "busy" : "idle"} canClear={canDeleteData} askDialog={askDialog} showToast={showToast}
                      onCleared={() => setRecords(rs => rs.map(r => r.cardUrl || r.uploadStatus === "uploaded" ? { ...r, cardUrl: null, uploadStatus: "idle" } : r))} />
                    <div style={{height:20}} />

                    {/* Template */}
                    <div className="nk-sec" style={{color:N.amber}}>WhatsApp Template</div>
                    <label className="nk-label">Template Name</label>
                    <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                      {(activeWaTemplates.length ? activeWaTemplates.map(t => t.name) : ["Mwaliko","Mchango","ImageTemp"]).map(t => (
                        <button key={t}
                          onClick={() => chooseWaTemplate(t)}
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
                      {bulkSending ? <><Icon n="loader" /> Sending…</> : <><Icon n="whatsapp" /> {`Send All (${records.filter(r=>r.phone&&r.cardUrl).length})`}</>}
                    </button>
                  </div>

                  {/* Right: table */}
                  <div style={{flex:1}}>
                    {/* Download report — available once any WhatsApp send has finished (it reads the
                        records, not the log, so it stays after the log clears itself) */}
                    {!bulkSending && waReportReady && (
                      <button className="nk-btn nk-btn-full" onClick={downloadWaReport}
                        style={{background:N.greenBg,color:N.green,border:`1px solid ${alpha(N.green,"33")}`,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                        <span style={{fontSize:16}}><Icon n="download" /></span> Download WA Report (.xlsx)
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
                                  {rec.uploadStatus==="uploaded"?<><Icon n="check" /> Ready</>:rec.uploadStatus==="uploading"?<><Icon n="loader" /> Uploading</>:rec.uploadStatus==="failed"?<><Icon n="xCircle" /> Failed</>:<><Icon n="circle" /> Pending</>}
                                </span>
                              </td>
                              <td><WaBadge status={rec.waStatus||WA.idle} reason={rec.waReason} /></td>
                              <td>
                                <div className="nk-row-actions">
                                  <Sb bg={N.navy600} col={N.sky} border={alpha(N.sky,"44")}
                                    onClick={()=>uploadCardSingle(i)}
                                    disabled={rec.uploadStatus==="uploading"} label="Upload card">
                                    {rec.uploadStatus==="uploading"?<><Icon n="loader" /></>:<><Icon n="cloud" /></>} Upload
                                  </Sb>
                                  {rec.phone && rec.cardUrl && (
                                    <Sb bg={N.greenBg} col={N.green}
                                      onClick={()=>sendWaSingle(i)}
                                      disabled={rec.waStatus===WA.sending} label="Send card on WhatsApp">
                                      {rec.waStatus===WA.sending?<><Icon n="loader" /></>:<><Icon n="whatsapp" /></>} Send
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
                    <span style={{fontSize:16}}><Icon n="download" /></span> Download Report (.xlsx)
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
                                {rec.smsStatus===SMS.delivered?<><Icon n="check" /> Delivered</>:rec.smsStatus===SMS.sent?<><Icon n="arrowUp" /> Sent</>:rec.smsStatus===SMS.failed?<><Icon n="xCircle" /> Failed</>:<><Icon n="circle" /> Pending</>}
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
                        {historyLoading ? <><Icon n="loader" /></> : <><Icon n="refresh" /></>} Refresh
                      </button>
                      <button className="nk-btn nk-btn-success" onClick={downloadHistory} disabled={!shown.length}>
                        <Icon n="download" /> Export (.xlsx)
                      </button>
                      {(access.setupMissing || access.can("events", "edit") || access.can("calls", "edit") || access.can("history", "edit")) && openEventRow && (
                        <button className="nk-btn nk-btn-ghost" onClick={() => setShareView(true)}><Icon n="eye" /> Share view-only{openEventRow.view_code ? " (on)" : ""}</button>
                      )}
                    </div>
                  )}
                </div>

                {!savedEventId ? (
                  <EmptyState icon="history" title="No event open" text="History is kept per event. Pick one to see every card, SMS and change."
                    action={<button className="nk-btn nk-btn-primary" onClick={()=>{ loadSavedEvents(); setTab("events"); }}><Icon n="folder" /> Go to Events</button>} />
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
                        {Object.entries(HISTORY_CHANNELS).map(([k,c])=><option key={k} value={k}>{c.label}</option>)}
                      </select>
                      <select className="nk-input" style={{width:150}} value={historyFilter.status} onChange={e=>setF({ status:e.target.value })}>
                        <option value="all">All results</option>
                        {Object.entries(HISTORY_STATUSES).map(([k,st])=><option key={k} value={k}>{st.label}</option>)}
                      </select>
                      {filtered && (
                        <button className="nk-btn nk-btn-ghost" style={{fontSize:11,padding:"6px 10px"}}
                          onClick={()=>setHistoryFilter({ channel:"all", status:"all", q:"" })}><Icon n="x" /> Clear</button>
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
                                <td style={{fontSize:12,whiteSpace:"nowrap"}}><Icon n={ch.icon} /> {ch.label}</td>
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
                        <div>
                          {historyLoading ? <EmptyState loading title="Loading history…" />
                            : historyRows.length ? <EmptyState icon="search" title="No entries match these filters"
                                action={<button className="nk-btn nk-btn-ghost" style={{fontSize:12}} onClick={()=>setHistoryFilter({ channel:"all", status:"all", q:"" })}>Clear filters</button>} />
                            : <EmptyState icon="history" title="Nothing recorded yet" text="Sends, uploads and event changes will appear here." />}
                        </div>
                      )}
                    </div>
                    {historyHasMore && (
                      <button className="nk-btn nk-btn-ghost nk-btn-full" style={{marginTop:12}} onClick={()=>loadHistory(true)} disabled={historyLoading}>
                        {historyLoading ? <><Icon n="loader" /> Loading…</> : "Load older entries"}
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
                        {a==="left"?<><Icon n="alignLeft" /></>:a==="center"?<><Icon n="alignCenter" /></>:<><Icon n="alignRight" /></>}
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
                {bgSize ? <span className="nk-chip-ok"><Icon n="check" /> Locked to template</span> : <span className="nk-chip-warn"><Icon n="alert" /> Default size</span>}
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
                  {activeRecord.waStatus===WA.sending ? <><Icon n="loader" /> Sending…</> : activeRecord.waStatus===WA.sent ? <><Icon n="check" /> WA Sent</> : <><Icon n="whatsapp" /> Send via WhatsApp</>}
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
    </CanDeleteContext.Provider>
  );
}
