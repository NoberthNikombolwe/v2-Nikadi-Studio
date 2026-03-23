import { useState, useRef, useCallback, useEffect } from "react";
import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

/* ══════════════════════════════════════════════════════════════════════════
   NIKADI STUDIO — Professional Navy Brand
══════════════════════════════════════════════════════════════════════════ */

const FONTS = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap";

/* ── Navy brand palette ── */
const N = {
  navy900:  "#050d1f",
  navy800:  "#0a1628",
  navy700:  "#0d1f3c",
  navy600:  "#102848",
  navy500:  "#163260",
  navy400:  "#1e4080",
  navy300:  "#2563b0",
  sky:      "#38bdf8",
  skyLight: "#e0f2fe",
  accent:   "#3b82f6",
  accentHover: "#2563eb",
  gold:     "#f59e0b",
  green:    "#22c55e",
  greenBg:  "#052e16",
  red:      "#ef4444",
  redBg:    "#2d0a0a",
  amber:    "#f59e0b",
  amberBg:  "#2d1a00",
  white:    "#ffffff",
  text:     "#e2e8f0",
  textMid:  "#94a3b8",
  textDim:  "#475569",
  border:   "#1e3a5f",
  borderLight: "#2d5a8e44",
  surface:  "#0a1628",
  surfaceUp:"#0f2040",
  surfaceHover: "#162d55",
};

const CSS = `
  @import url('${FONTS}');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --navy900: ${N.navy900};
    --navy800: ${N.navy800};
    --navy700: ${N.navy700};
    --navy600: ${N.navy600};
    --accent:  ${N.accent};
    --sky:     ${N.sky};
    --gold:    ${N.gold};
    --green:   ${N.green};
    --text:    ${N.text};
    --textMid: ${N.textMid};
    --border:  ${N.border};
  }

  body { background: var(--navy900); font-family: 'Plus Jakarta Sans', sans-serif; color: var(--text); }

  .nk-app { display: flex; flex-direction: column; min-height: 100vh; background: var(--navy900); }

  /* ── Header ── */
  .nk-header {
    background: linear-gradient(135deg, ${N.navy800} 0%, ${N.navy700} 100%);
    border-bottom: 1px solid ${N.border};
    padding: 0 28px;
    height: 64px;
    display: flex; align-items: center; gap: 16px;
    position: sticky; top: 0; z-index: 100;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  }
  .nk-logo {
    display: flex; align-items: center; gap: 10px;
  }
  .nk-logo-icon {
    width: 36px; height: 36px; border-radius: 10px;
    background: linear-gradient(135deg, ${N.accent}, ${N.sky});
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 16px; color: #fff;
    box-shadow: 0 4px 12px rgba(59,130,246,0.4);
    flex-shrink: 0;
  }
  .nk-logo-name {
    font-size: 18px; font-weight: 800; letter-spacing: -0.3px;
    background: linear-gradient(135deg, #fff 30%, ${N.sky});
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .nk-logo-tag {
    font-size: 10px; color: ${N.textDim}; font-weight: 500;
    letter-spacing: 0.5px; margin-top: -2px;
  }
  .nk-header-actions { margin-left: auto; display: flex; gap: 10px; align-items: center; }

  /* ── Tabs ── */
  .nk-tabs {
    display: flex;
    background: ${N.navy800};
    border-bottom: 1px solid ${N.border};
    padding: 0 28px;
  }
  .nk-tab {
    padding: 14px 20px; font-size: 13px; font-weight: 600;
    color: ${N.textDim}; border: none; background: none; cursor: pointer;
    border-bottom: 3px solid transparent; margin-bottom: -1px;
    transition: all 0.2s; font-family: 'Plus Jakarta Sans', sans-serif;
    display: flex; align-items: center; gap: 7px;
    white-space: nowrap;
  }
  .nk-tab:hover { color: ${N.text}; }
  .nk-tab.active { color: ${N.sky}; border-bottom-color: ${N.accent}; }

  /* ── Body layout ── */
  .nk-body { display: flex; flex: 1; overflow: hidden; min-height: 0; }

  /* ── Sidebar ── */
  .nk-sidebar {
    width: 240px; min-width: 240px;
    background: ${N.navy800};
    border-right: 1px solid ${N.border};
    padding: 20px 16px; overflow-y: auto;
    display: flex; flex-direction: column; gap: 24px;
  }
  .nk-sidebar-right {
    width: 240px; min-width: 240px;
    background: ${N.navy800};
    border-left: 1px solid ${N.border};
    padding: 20px 16px; overflow-y: auto;
  }

  /* ── Section label ── */
  .nk-sec {
    font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
    color: ${N.textDim}; text-transform: uppercase;
    margin-bottom: 10px; display: flex; align-items: center; gap: 6px;
  }
  .nk-sec::before {
    content: ''; display: block; width: 3px; height: 12px;
    background: ${N.accent}; border-radius: 2px; flex-shrink: 0;
  }

  /* ── Upload zone ── */
  .nk-upload {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    border: 1.5px dashed ${N.border}; border-radius: 12px;
    padding: 16px 12px; cursor: pointer; gap: 6px;
    background: ${N.navy900}; transition: all 0.2s;
    text-align: center;
  }
  .nk-upload:hover { border-color: ${N.accent}; background: ${N.navy700}; }
  .nk-upload-icon { font-size: 22px; }
  .nk-upload-label { font-size: 12px; font-weight: 600; color: ${N.textMid}; }
  .nk-upload-sub { font-size: 10px; color: ${N.textDim}; }

  /* ── Buttons ── */
  .nk-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    padding: 9px 16px; border-radius: 8px; border: none; cursor: pointer;
    font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 600; font-size: 13px;
    transition: all 0.18s; white-space: nowrap;
  }
  .nk-btn-primary {
    background: linear-gradient(135deg, ${N.accent}, ${N.accentHover});
    color: #fff;
    box-shadow: 0 4px 14px rgba(59,130,246,0.35);
  }
  .nk-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(59,130,246,0.45); }
  .nk-btn-primary:disabled { opacity: 0.5; transform: none; }
  .nk-btn-ghost {
    background: transparent; color: ${N.textMid};
    border: 1.5px solid ${N.border};
  }
  .nk-btn-ghost:hover { border-color: ${N.accent}; color: ${N.sky}; background: ${N.navy700}; }
  .nk-btn-success {
    background: linear-gradient(135deg, #16a34a, #15803d);
    color: #fff; box-shadow: 0 4px 14px rgba(34,197,94,0.3);
  }
  .nk-btn-success:hover { transform: translateY(-1px); }
  .nk-btn-danger {
    background: linear-gradient(135deg, #dc2626, #b91c1c);
    color: #fff;
  }
  .nk-btn-sm {
    padding: 4px 10px; font-size: 11px; border-radius: 6px;
    border: 1.5px solid; cursor: pointer;
    font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 600;
    white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;
    transition: all 0.15s;
  }
  .nk-btn-full { width: 100%; margin-bottom: 8px; }

  /* ── Inputs ── */
  .nk-input {
    width: 100%; padding: 8px 12px; border-radius: 8px;
    background: ${N.navy900}; border: 1.5px solid ${N.border};
    color: ${N.text}; font-family: 'Plus Jakarta Sans', sans-serif;
    font-size: 13px; margin-bottom: 10px; outline: none;
    transition: border-color 0.2s;
  }
  .nk-input:focus { border-color: ${N.accent}; box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }
  .nk-input::placeholder { color: ${N.textDim}; }
  .nk-textarea { resize: vertical; min-height: 90px; line-height: 1.6; }
  .nk-label { font-size: 11px; font-weight: 600; color: ${N.textMid}; margin-bottom: 5px; display: block; }

  /* ── Element pills ── */
  .nk-el-pill {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 12px; border-radius: 8px; cursor: pointer;
    border: 1.5px solid ${N.border}; margin-bottom: 6px;
    background: ${N.navy900}; transition: all 0.15s; font-size: 12px;
  }
  .nk-el-pill:hover { border-color: ${N.accent}44; background: ${N.navy700}; }
  .nk-el-pill.active { border-color: ${N.sky}; background: ${N.navy600}; box-shadow: 0 0 0 3px rgba(56,189,248,0.1); }
  .nk-el-type { font-size: 10px; color: ${N.textDim}; font-family: 'JetBrains Mono', monospace; }

  /* ── Size info chip ── */
  .nk-chip {
    background: ${N.navy900}; border: 1px solid ${N.border};
    border-radius: 8px; padding: 10px 12px; margin-bottom: 8px;
    font-family: 'JetBrains Mono', monospace; font-size: 11px;
    color: ${N.sky}; line-height: 1.9;
  }
  .nk-chip-ok { color: ${N.green}; font-size: 10px; }
  .nk-chip-warn { color: ${N.gold}; font-size: 10px; }

  /* ── Main area ── */
  .nk-main {
    flex: 1; padding: 28px; overflow-y: auto;
    display: flex; flex-direction: column; align-items: center; gap: 20px;
  }
  .nk-hint {
    font-size: 12px; color: ${N.textDim}; text-align: center;
    background: ${N.navy800}; border: 1px solid ${N.border};
    border-radius: 8px; padding: 8px 20px;
  }

  /* ── Record selector pills ── */
  .nk-rec-pills { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
  .nk-rec-pill {
    padding: 5px 14px; border-radius: 20px; font-size: 12px; font-weight: 600;
    border: 1.5px solid ${N.border}; background: transparent;
    color: ${N.textMid}; cursor: pointer; font-family: 'Plus Jakarta Sans', sans-serif;
    transition: all 0.15s;
  }
  .nk-rec-pill:hover { border-color: ${N.accent}; color: ${N.sky}; }
  .nk-rec-pill.active { background: ${N.accent}22; border-color: ${N.accent}; color: ${N.sky}; }

  /* ── Info banner ── */
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

  /* ── Stats cards ── */
  .nk-stats { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
  .nk-stat {
    background: ${N.navy800}; border: 1px solid ${N.border};
    border-radius: 12px; padding: 14px 20px; text-align: center;
    min-width: 100px;
  }
  .nk-stat-num { font-size: 24px; font-weight: 800; line-height: 1; margin-bottom: 4px; }
  .nk-stat-label { font-size: 10px; font-weight: 600; color: ${N.textDim}; text-transform: uppercase; letter-spacing: 0.5px; }

  /* ── Send log ── */
  .nk-log {
    background: ${N.navy800}; border: 1px solid ${N.border};
    border-radius: 12px; padding: 16px; margin-bottom: 16px;
  }
  .nk-log-row { font-size: 12px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }

  /* ── Table ── */
  .nk-table { width: 100%; border-collapse: separate; border-spacing: 0; }
  .nk-table-wrap {
    background: ${N.navy800}; border: 1px solid ${N.border};
    border-radius: 14px; overflow: hidden;
  }
  .nk-table thead th {
    padding: 12px 14px; text-align: left;
    font-size: 10px; font-weight: 700; letter-spacing: 1.2px;
    color: ${N.textDim}; text-transform: uppercase;
    background: ${N.navy700}; border-bottom: 1px solid ${N.border};
  }
  .nk-table tbody tr { transition: background 0.15s; }
  .nk-table tbody tr:hover { background: ${N.navy700}44; }
  .nk-table tbody tr.row-active { background: rgba(59,130,246,0.06); }
  .nk-table td {
    padding: 10px 14px; font-size: 13px;
    border-bottom: 1px solid ${N.border}22;
    vertical-align: middle;
  }
  .nk-table tbody tr:last-child td { border-bottom: none; }

  /* ── WA badges ── */
  .nk-badge {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;
    font-family: 'JetBrains Mono', monospace;
  }
  .badge-idle    { background: ${N.navy700}; color: ${N.textDim}; border: 1px solid ${N.border}; }
  .badge-testing { background: ${N.amberBg}; color: ${N.amber}; border: 1px solid ${N.amber}44; }
  .badge-yes     { background: ${N.greenBg}; color: ${N.green}; border: 1px solid ${N.green}44; }
  .badge-no      { background: ${N.redBg};   color: ${N.red};   border: 1px solid ${N.red}44; }

  /* ── Toast ── */
  .nk-toast {
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    padding: 12px 20px; border-radius: 12px; font-size: 13px; font-weight: 500;
    box-shadow: 0 8px 30px rgba(0,0,0,0.5); max-width: 340px; line-height: 1.5;
    animation: slideUp 0.3s ease;
    display: flex; align-items: flex-start; gap: 10px;
  }
  .nk-toast-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
  .toast-success { background: #052e16; color: ${N.green}; border: 1px solid ${N.green}44; }
  .toast-warn    { background: ${N.amberBg}; color: ${N.amber}; border: 1px solid ${N.amber}44; }
  .toast-info    { background: ${N.navy600}; color: ${N.sky}; border: 1px solid ${N.sky}44; }

  @keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }

  /* ── Range input ── */
  input[type=range] {
    width: 100%; accent-color: ${N.accent}; margin-bottom: 6px;
  }

  /* ── Scrollbar ── */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: ${N.navy800}; }
  ::-webkit-scrollbar-thumb { background: ${N.navy500}; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: ${N.accent}; }

  /* ── Divider ── */
  .nk-divider { height: 1px; background: ${N.border}; margin: 4px 0 16px; }

  /* ── Canvas selection outline ── */
  canvas { display: block; }

  /* ── Phone inline edit ── */
  .nk-phone-edit {
    background: ${N.navy900}; border: 1.5px solid ${N.accent};
    color: ${N.text}; border-radius: 6px; padding: 3px 8px;
    font-family: 'JetBrains Mono', monospace; font-size: 12px; width: 130px; outline: none;
  }
  .nk-phone-val {
    font-family: 'JetBrains Mono', monospace; font-size: 12px; color: ${N.textMid};
    display: flex; align-items: center; gap: 6px;
  }
`;

/* ── QR helper ─────────────────────────────────────────────────────────── */
const qrUrl = (data, size = 120) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&margin=6&color=0d1f3c&bgcolor=ffffff`;

/* ── WhatsApp helpers ──────────────────────────────────────────────────── */
const normalisePhone = (raw = "") => {
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 9) d = "255" + d.slice(1);
  return d;
};
const waLink = (phone, text = "") =>
  `https://wa.me/${normalisePhone(phone)}?text=${encodeURIComponent(text)}`;

/* ── Canvas defaults ────────────────────────────────────────────────────── */
const DEFAULT_W = 440, DEFAULT_H = 280, MAX_DISPLAY_W = 780;

const defaultElements = () => [
  { id: "name",     label: "Name",      type: "text", field: "name",     x: 220, y: 170, fontSize: 22, color: "#0d1f3c", bold: true,  align: "center" },
  { id: "cardtype", label: "Card Type", type: "text", field: "cardType", x: 220, y: 200, fontSize: 13, color: "#2563b0", bold: false, align: "center" },
  { id: "qr",       label: "QR Code",   type: "qr",                      x: 300, y: 95,  size: 120 },
];

const WA = { idle: "idle", testing: "testing", yes: "yes", no: "no" };

/* ── Card Canvas ─────────────────────────────────────────────────────────── */
function CardCanvas({ bgImage, bgSize, elements, record, selected, onSelect, onMove }) {
  const ref  = useRef(null);
  const drag = useRef(null);
  const cw   = bgSize?.w || DEFAULT_W;
  const ch   = bgSize?.h || DEFAULT_H;
  const displayW = Math.min(cw, MAX_DISPLAY_W);
  const displayH = Math.round(ch * (displayW / cw));
  const scaleX = cw / displayW;
  const scaleY = ch / displayH;

  const draw = useCallback(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cw, ch);

    const renderEls = () => {
      elements.forEach((el) => {
        if (el.type === "text") {
          const val = record?.[el.field] || `[${el.label}]`;
          ctx.font = `${el.bold ? "bold " : ""}${el.fontSize}px 'Plus Jakarta Sans', sans-serif`;
          ctx.fillStyle = el.color;
          ctx.textAlign = el.align || "left";
          ctx.fillText(val, el.x, el.y);
          ctx.textAlign = "left";
          if (selected === el.id) {
            const w = ctx.measureText(val).width;
            const drawX = el.align === "center" ? el.x - w / 2 : el.align === "right" ? el.x - w : el.x;
            ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(drawX - 4, el.y - el.fontSize - 2, w + 8, el.fontSize + 10);
            ctx.setLineDash([]);
          }
        } else if (el.type === "qr") {
          const qrData = `Name=${record?.name || "?"};TypeCard=${record?.cardType || "?"}`;
          const img = new Image(); img.crossOrigin = "anonymous";
          img.onload = () => {
            ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.2)"; ctx.shadowBlur = 6;
            ctx.drawImage(img, el.x, el.y, el.size, el.size); ctx.restore();
            if (selected === el.id) {
              ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 1.5;
              ctx.setLineDash([4, 3]);
              ctx.strokeRect(el.x - 3, el.y - 3, el.size + 6, el.size + 6);
              ctx.setLineDash([]);
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
      // Default navy card
      const g = ctx.createLinearGradient(0, 0, cw, ch);
      g.addColorStop(0, "#0a1628"); g.addColorStop(1, "#0d1f3c");
      ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
      // Left accent strip
      const strip = ctx.createLinearGradient(0, 0, 0, ch);
      strip.addColorStop(0, "#3b82f6"); strip.addColorStop(1, "#38bdf8");
      ctx.fillStyle = strip; ctx.fillRect(0, 0, 5, ch);
      // Header bg
      ctx.fillStyle = "rgba(59,130,246,0.08)"; ctx.fillRect(0, 0, cw, 65);
      // Brand name
      ctx.fillStyle = "#e2e8f0"; ctx.font = "700 13px 'Plus Jakarta Sans', sans-serif";
      ctx.fillText("NIKADI STUDIO", 20, 30);
      ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(20, 38, 140, 1);
      ctx.fillStyle = "#64748b"; ctx.font = "500 10px 'Plus Jakarta Sans', sans-serif";
      ctx.fillText("IDENTITY CARD", 20, 55);
      // Decorative dot grid (top-right)
      ctx.fillStyle = "rgba(59,130,246,0.15)";
      for (let xi = 0; xi < 5; xi++) for (let yi = 0; yi < 3; yi++) {
        ctx.beginPath(); ctx.arc(cw - 20 - xi * 12, 15 + yi * 12, 2, 0, Math.PI * 2); ctx.fill();
      }
      renderEls();
    }
  }, [bgImage, cw, ch, elements, record, selected]);

  useEffect(() => { draw(); }, [draw]);

  const hitEl  = (cx, cy) => [...elements].reverse().find((el) => {
    if (el.type === "text") {
      const hitW = 200;
      const drawX = el.align === "center" ? el.x - hitW / 2 : el.align === "right" ? el.x - hitW : el.x;
      return cx >= drawX - 4 && cx <= drawX + hitW + 4 && cy >= el.y - el.fontSize && cy <= el.y + 8;
    }
    return cx >= el.x && cx <= el.x + el.size && cy >= el.y && cy <= el.y + el.size;
  });
  const toCv   = (e) => { const r = ref.current.getBoundingClientRect(); return { cx: (e.clientX-r.left)*scaleX, cy: (e.clientY-r.top)*scaleY }; };
  const onDown = (e) => { const {cx,cy}=toCv(e); const el=hitEl(cx,cy); if(el){onSelect(el.id);drag.current={id:el.id,ox:cx-el.x,oy:cy-el.y};}else onSelect(null); };
  const onMov  = (e) => { if(!drag.current)return; const {cx,cy}=toCv(e); onMove(drag.current.id,cx-drag.current.ox,cy-drag.current.oy); };
  const onUp   = ()  => { drag.current=null; };

  return (
    <canvas ref={ref} width={cw} height={ch}
      style={{ width: displayW, height: displayH, borderRadius: 12, cursor: "crosshair",
        boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(59,130,246,0.2)" }}
      onMouseDown={onDown} onMouseMove={onMov} onMouseUp={onUp} onMouseLeave={onUp} />
  );
}

/* ── Export ─────────────────────────────────────────────────────────────── */
function exportCard(bgImage, bgSize, elements, record) {
  return new Promise((resolve) => {
    const cw = bgSize?.w || DEFAULT_W;
    const ch = bgSize?.h || DEFAULT_H;
    const cv = document.createElement("canvas");
    cv.width = cw; cv.height = ch;
    const ctx = cv.getContext("2d");

    const renderText = () => elements.forEach((el) => {
      if (el.type === "text") {
        const val = record?.[el.field] || "";
        ctx.font = `${el.bold ? "bold " : ""}${el.fontSize}px 'Plus Jakarta Sans', sans-serif`;
        ctx.fillStyle = el.color;
        ctx.textAlign = el.align || "left";
        ctx.fillText(val, el.x, el.y);
        ctx.textAlign = "left";
      }
    });

    const renderQR = () => {
      const qrEls = elements.filter(e => e.type === "qr");
      if (!qrEls.length) { resolve(cv.toDataURL("image/png")); return; }
      let done = 0;
      qrEls.forEach((el) => {
        const qrData = `Name=${record?.name || "?"};TypeCard=${record?.cardType || "?"}`;
        const img = new Image(); img.crossOrigin = "anonymous";
        img.onload = () => {
          ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.2)"; ctx.shadowBlur = 6;
          ctx.drawImage(img, el.x, el.y, el.size, el.size); ctx.restore();
          if (++done === qrEls.length) resolve(cv.toDataURL("image/png"));
        };
        img.onerror = () => { if (++done === qrEls.length) resolve(cv.toDataURL("image/png")); };
        img.src = qrUrl(qrData, el.size);
      });
    };

    if (bgImage) {
      const bg = new Image();
      bg.onload = () => { ctx.drawImage(bg, 0, 0, cw, ch); renderText(); renderQR(); };
      bg.src = bgImage;
    } else {
      const g = ctx.createLinearGradient(0, 0, cw, ch);
      g.addColorStop(0, "#0a1628"); g.addColorStop(1, "#0d1f3c");
      ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
      const strip = ctx.createLinearGradient(0, 0, 0, ch);
      strip.addColorStop(0, "#3b82f6"); strip.addColorStop(1, "#38bdf8");
      ctx.fillStyle = strip; ctx.fillRect(0, 0, 5, ch);
      ctx.fillStyle = "rgba(59,130,246,0.08)"; ctx.fillRect(0, 0, cw, 65);
      ctx.fillStyle = "#e2e8f0"; ctx.font = "700 13px 'Plus Jakarta Sans', sans-serif";
      ctx.fillText("NIKADI STUDIO", 20, 30);
      ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(20, 38, 140, 1);
      ctx.fillStyle = "#64748b"; ctx.font = "500 10px 'Plus Jakarta Sans', sans-serif";
      ctx.fillText("IDENTITY CARD", 20, 55);
      ctx.fillStyle = "rgba(59,130,246,0.15)";
      for (let xi = 0; xi < 5; xi++) for (let yi = 0; yi < 3; yi++) {
        ctx.beginPath(); ctx.arc(cw - 20 - xi * 12, 15 + yi * 12, 2, 0, Math.PI * 2); ctx.fill();
      }
      renderText(); renderQR();
    }
  });
}

/* ── WA Badge ────────────────────────────────────────────────────────────── */
function WaBadge({ status }) {
  const map = {
    [WA.idle]:    ["badge-idle",    "○", "Not checked"],
    [WA.testing]: ["badge-testing", "⏳", "Awaiting"],
    [WA.yes]:     ["badge-yes",     "✓", "On WhatsApp"],
    [WA.no]:      ["badge-no",      "✗", "Not on WA"],
  };
  const [cls, icon, label] = map[status] || map[WA.idle];
  return <span className={`nk-badge ${cls}`}>{icon} {label}</span>;
}

/* ── Small action button ─────────────────────────────────────────────────── */
function Sb({ bg, col, border, children, onClick, title }) {
  return (
    <button className="nk-btn-sm" onClick={onClick} title={title}
      style={{ background: bg, color: col, borderColor: border || col + "44" }}>
      {children}
    </button>
  );
}

/* ── Record Row ──────────────────────────────────────────────────────────── */
function RecordRow({ rec, idx, onEdit, onOpenTest, onConfirmWa, onSendSingle, onDownload, isActive, onActivate }) {
  const [editing, setEditing] = useState(false);
  const [phone, setPhone]     = useState(rec.phone || "");
  useEffect(() => { setPhone(rec.phone || ""); }, [rec.phone]);
  const save = () => { onEdit(idx, "phone", phone); setEditing(false); };

  return (
    <tr className={isActive ? "row-active" : ""}>
      <td><span style={{ color: N.accent, cursor: "pointer", fontWeight: 700, fontFamily: "JetBrains Mono, monospace", fontSize: 12 }} onClick={onActivate}>#{idx + 1}</span></td>
      <td><span style={{ fontWeight: 600 }}>{rec.name}</span></td>
      <td><span style={{ color: N.textMid, fontSize: 12 }}>{rec.cardType}</span></td>
      <td>
        {editing ? (
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key === "Enter" && save()} autoFocus className="nk-phone-edit" />
            <Sb bg={N.greenBg} col={N.green} onClick={save}>✓</Sb>
            <Sb bg={N.redBg} col={N.red} onClick={() => setEditing(false)}>✕</Sb>
          </span>
        ) : (
          <span className="nk-phone-val">
            {rec.phone || <span style={{ color: N.textDim }}>—</span>}
            <Sb bg="transparent" col={N.textDim} border={N.border} onClick={() => setEditing(true)} title="Edit">✎</Sb>
          </span>
        )}
      </td>
      <td><WaBadge status={rec.waStatus || WA.idle} /></td>
      <td>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {!rec.phone && <Sb bg={N.redBg} col={N.red} onClick={() => setEditing(true)}>+ Add №</Sb>}
          {rec.phone && rec.waStatus === WA.idle && (
            <Sb bg={N.amberBg} col={N.amber} onClick={() => onOpenTest(idx)}>🔍 Test WA</Sb>
          )}
          {rec.waStatus === WA.testing && (
            <>
              <span style={{ fontSize: 11, color: N.amber, alignSelf: "center", fontWeight: 600 }}>Chat open?</span>
              <Sb bg={N.greenBg} col={N.green} onClick={() => onConfirmWa(idx, true)}>✓ Yes</Sb>
              <Sb bg={N.redBg}   col={N.red}   onClick={() => onConfirmWa(idx, false)}>✗ No</Sb>
            </>
          )}
          {rec.waStatus === WA.yes && <Sb bg="#052e16" col={N.green} onClick={() => onSendSingle(idx)}>📲 Send</Sb>}
          {rec.waStatus === WA.no  && <Sb bg={N.redBg} col={N.red} onClick={() => { setEditing(true); onEdit(idx, "waStatus", WA.idle); }}>✎ Fix №</Sb>}
          {(rec.waStatus === WA.yes || rec.waStatus === WA.no) && (
            <Sb bg="transparent" col={N.textDim} border={N.border} onClick={() => onEdit(idx, "waStatus", WA.idle)}>↺</Sb>
          )}
          <Sb bg={N.navy600} col={N.sky} border={N.sky + "44"} onClick={() => onDownload(idx)}>⬇ PNG</Sb>
        </div>
      </td>
    </tr>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════════════════════════════════ */
export default function App() {
  const [bgImage,     setBgImage]     = useState(null);
  const [bgSize,      setBgSize]      = useState(null);
  const [elements,    setElements]    = useState(defaultElements());
  const [selected,    setSelected]    = useState(null);
  const [records,     setRecords]     = useState([
    { name: "Nazael Ezekiel",   cardType: "SINGLE", phone: "0712345678", waStatus: WA.idle },
    { name: "Denis Mwambuja",   cardType: "DOUBLE", phone: "0756789012", waStatus: WA.idle },
    { name: "Noberth Nikombolwe", cardType: "20",   phone: "",           waStatus: WA.idle },
  ]);
  const [activeIdx,   setActiveIdx]   = useState(0);
  const [tab,         setTab]         = useState("design");
  const [waMessage,   setWaMessage]   = useState("Hello {name}, please find your {cardType} ID card attached. Welcome aboard!");
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkLog,     setBulkLog]     = useState([]);
  const [toast,       setToast]       = useState(null);

  const showToast = (msg, type = "info") => { setToast({ msg, type }); setTimeout(() => setToast(null), 4000); };
  const activeRecord = records[activeIdx] || {};
  const selectedEl   = elements.find(e => e.id === selected);

  const onBgUpload = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const probe = new Image();
      probe.onload = () => { setBgImage(dataUrl); setBgSize({ w: probe.naturalWidth, h: probe.naturalHeight }); showToast(`Template loaded — ${probe.naturalWidth}×${probe.naturalHeight}px`, "success"); };
      probe.src = dataUrl;
    };
    reader.readAsDataURL(f);
  };

  const onExcelUpload = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      const wb   = XLSX.read(ev.target.result, { type: "array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const norm = data.map(row => {
        const n = { waStatus: WA.idle };
        Object.keys(row).forEach(k => {
          const kl = k.trim().toLowerCase().replace(/[\s_]/g, "");
          if      (kl === "name")                                             n.name     = String(row[k]);
          else if (kl === "cardtype" || kl === "card")                        n.cardType = String(row[k]);
          else if (kl === "phone" || kl === "phonenumber" || kl === "mobile") n.phone    = String(row[k]);
          else n[k] = row[k];
        });
        return n;
      });
      setRecords(norm); setActiveIdx(0);
      showToast(`Loaded ${norm.length} records`, "success");
    };
    r.readAsArrayBuffer(f);
  };

  const onMove     = (id, x, y) => setElements(els => els.map(el => el.id === id ? { ...el, x, y } : el));
  const updateEl   = (prop, val) => setElements(els => els.map(el => el.id === selected ? { ...el, [prop]: val } : el));
  const editRecord = (idx, field, val) =>
    setRecords(rs => rs.map((r, i) => i === idx ? { ...r, [field]: val } : r));

  const openWaTest = (idx) => {
    const rec = records[idx];
    if (!rec.phone) { showToast("Add a phone number first", "warn"); return; }
    const num = normalisePhone(rec.phone);
    if (num.length < 10) { showToast("Phone number looks too short", "warn"); return; }
    window.open(`https://wa.me/${num}`, "_blank");
    setRecords(rs => rs.map((r, i) => i === idx ? { ...r, waStatus: WA.testing } : r));
    showToast(`WhatsApp opened for ${rec.name} — confirm if chat appeared`, "info");
  };

  const confirmWa = (idx, isOnWa) => {
    setRecords(rs => rs.map((r, i) => i === idx ? { ...r, waStatus: isOnWa ? WA.yes : WA.no } : r));
    showToast(isOnWa ? `✓ ${records[idx].name} confirmed on WhatsApp` : `✗ ${records[idx].name} not on WhatsApp`, isOnWa ? "success" : "warn");
  };

  const testAllWa = async () => {
    const untested = records.map((r, i) => ({ r, i })).filter(({ r }) => r.phone && r.waStatus === WA.idle);
    if (!untested.length) { showToast("All numbers already tested or have no phone", "warn"); return; }
    for (const { i } of untested) { openWaTest(i); await new Promise(res => setTimeout(res, 2000)); }
    showToast(`Opened ${untested.length} WhatsApp test links — confirm each one`, "info");
  };

  const buildMsg   = (rec) => waMessage.replace("{name}", rec.name || "").replace("{cardType}", rec.cardType || "");

  const sendSingle = async (idx) => {
    const rec = records[idx];
    const url = await exportCard(bgImage, bgSize, elements, rec);
    const a = document.createElement("a"); a.download = `${(rec.name||"card").replace(/\s/g,"_")}_Nikadi.png`; a.href = url; a.click();
    setTimeout(() => window.open(waLink(rec.phone, buildMsg(rec)), "_blank"), 400);
    showToast(`Card downloaded + WhatsApp opened for ${rec.name}`, "success");
  };

  const downloadCard = async (idx) => {
    const rec = records[idx];
    const url = await exportCard(bgImage, bgSize, elements, rec);
    const a = document.createElement("a"); a.download = `${(rec.name||`Record_${idx}`).toString().replace(/\s/g,"_")}_Nikadi.png`; a.href = url; a.click();
  };

  const downloadAll = async () => {
    if (!records.length) { showToast("No records to download", "warn"); return; }
    showToast(`Zipping ${records.length} cards…`, "info");
    const zip = new JSZip();
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const dataUrl = await exportCard(bgImage, bgSize, elements, rec);
      const base64 = dataUrl.split(",")[1];
      const filename = `${(rec.name || `Record_${i}`).toString().replace(/\s/g, "_")}_Nikadi.png`;
      zip.file(filename, base64, { base64: true });
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.download = "nikadi_cards.zip";
    a.href = URL.createObjectURL(blob);
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(`✓ nikadi_cards.zip downloaded (${records.length} cards)`, "success");
  };

  const sendAll = async () => {
    const ready = records.filter(r => r.waStatus === WA.yes && r.phone);
    if (!ready.length) { showToast("No confirmed WhatsApp numbers. Test numbers first.", "warn"); return; }
    setBulkSending(true); setBulkLog([]);
    for (const rec of ready) {
      setBulkLog(l => [...l, { name: rec.name, status: "sending" }]);
      const url = await exportCard(bgImage, bgSize, elements, rec);
      const a = document.createElement("a"); a.download = `${(rec.name||"").replace(/\s/g,"_")}_Nikadi.png`; a.href = url; a.click();
      await new Promise(r => setTimeout(r, 800));
      window.open(waLink(rec.phone, buildMsg(rec)), "_blank");
      await new Promise(r => setTimeout(r, 1500));
      setBulkLog(l => l.map(x => x.name === rec.name ? { ...x, status: "sent" } : x));
    }
    setBulkSending(false);
    showToast(`Done — ${ready.length} cards sent`, "success");
  };

  const waOnCount      = records.filter(r => r.waStatus === WA.yes).length;
  const waOffCount     = records.filter(r => r.waStatus === WA.no).length;
  const waTestingCount = records.filter(r => r.waStatus === WA.testing).length;
  const cw = bgSize?.w || DEFAULT_W;
  const ch = bgSize?.h || DEFAULT_H;

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

        {/* Header */}
        <header className="nk-header">
          <div className="nk-logo">
            <div className="nk-logo-icon">N</div>
            <div>
              <div className="nk-logo-name">Nikadi Studio</div>
              <div className="nk-logo-tag">Card Design & Dispatch</div>
            </div>
          </div>
          <div className="nk-header-actions">
            {waOnCount > 0 && (
              <button className="nk-btn nk-btn-success" onClick={sendAll} disabled={bulkSending}>
                {bulkSending ? "⏳ Sending…" : `📲 Send All (${waOnCount})`}
              </button>
            )}
            <button className="nk-btn nk-btn-primary" onClick={downloadAll}>
              ⬇ Download All ({records.length})
            </button>
            <button className="nk-btn nk-btn-ghost" onClick={testAllWa}>🔍 Test All WA</button>
          </div>
        </header>

        {/* Tabs */}
        <nav className="nk-tabs">
          <button className={`nk-tab${tab==="design"?" active":""}`} onClick={()=>setTab("design")}>
            <span>🎨</span> Design
          </button>
          <button className={`nk-tab${tab==="batch"?" active":""}`} onClick={()=>setTab("batch")}>
            <span>📊</span> Batch & Send
          </button>
        </nav>

        {/* WA info banner */}
        {tab === "batch" && (
          <div className="nk-banner">
            <span style={{ fontSize: 16, marginTop: 1 }}>ℹ</span>
            <span>
              <strong>How WhatsApp verification works:</strong> This app opens each number's <code>wa.me</code> link — if WhatsApp shows a chat, the number is active. If it shows "Phone number not found", it's not registered. Confirm with <strong style={{ color: N.green }}>✓ Yes</strong> or <strong style={{ color: N.red }}>✗ No</strong>.
            </span>
          </div>
        )}

        <div className="nk-body">

          {/* LEFT SIDEBAR */}
          <aside className="nk-sidebar">

            <div>
              <div className="nk-sec">Background Template</div>
              <label className="nk-upload">
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={onBgUpload} />
                <span className="nk-upload-icon">🖼️</span>
                <span className="nk-upload-label">Upload Card Template</span>
                <span className="nk-upload-sub">PNG, JPG, SVG</span>
              </label>
              {bgSize && (
                <div className="nk-chip">
                  📐 {bgSize.w} × {bgSize.h} px<br/>
                  <span className="nk-chip-ok">✓ Canvas locked to image size</span>
                </div>
              )}
              {bgImage && (
                <button className="nk-btn nk-btn-ghost nk-btn-full" style={{ fontSize: 12 }} onClick={() => { setBgImage(null); setBgSize(null); }}>
                  ✕ Remove Template
                </button>
              )}
            </div>

            <div>
              <div className="nk-sec">Elements</div>
              {elements.map(el => (
                <div key={el.id} className={`nk-el-pill${selected===el.id?" active":""}`} onClick={() => setSelected(el.id)}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{el.label}</span>
                  <span className="nk-el-type">{el.type}</span>
                </div>
              ))}
            </div>

            <div>
              <div className="nk-sec">Excel / CSV</div>
              <label className="nk-upload">
                <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={onExcelUpload} />
                <span className="nk-upload-icon">📊</span>
                <span className="nk-upload-label">Upload Spreadsheet</span>
                <span className="nk-upload-sub">Columns: Name · CardType · Phone</span>
              </label>
            </div>

            <div>
              <div className="nk-sec">WhatsApp Message</div>
              <textarea className="nk-input nk-textarea" value={waMessage} onChange={e => setWaMessage(e.target.value)} />
              <p style={{ fontSize: 10, color: N.textDim, lineHeight: 1.7 }}>
                Variables: <code style={{ fontFamily: "JetBrains Mono, monospace", color: N.sky, fontSize: 11 }}>{"{name}"}</code> &nbsp;
                <code style={{ fontFamily: "JetBrains Mono, monospace", color: N.sky, fontSize: 11 }}>{"{cardType}"}</code>
              </p>
            </div>

          </aside>

          {/* MAIN */}
          <main className="nk-main">
            {tab === "design" ? (
              <>
                <div className="nk-hint">
                  {bgSize
                    ? `Canvas: ${cw}×${ch}px — matches your template exactly`
                    : "Default canvas 440×280 · Upload a template to auto-match its dimensions"}
                </div>
                <CardCanvas bgImage={bgImage} bgSize={bgSize} elements={elements}
                  record={activeRecord} selected={selected} onSelect={setSelected} onMove={onMove} />
                <div className="nk-rec-pills">
                  {records.map((r, i) => (
                    <button key={i} className={`nk-rec-pill${i===activeIdx?" active":""}`} onClick={() => setActiveIdx(i)}>
                      {r.name || `#${i + 1}`}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ width: "100%", maxWidth: 1000 }}>
                <div className="nk-stats">
                  {[
                    ["Total",       records.length,                                           N.textMid, "🗂️"],
                    ["Confirmed ✓", waOnCount,                                                N.green,   "✓"],
                    ["Not on WA",   waOffCount,                                               N.red,     "✗"],
                    ["Awaiting",    waTestingCount,                                           N.amber,   "⏳"],
                    ["Unchecked",   records.length - waOnCount - waOffCount - waTestingCount, N.textDim, "○"],
                  ].map(([l, v, c, icon]) => (
                    <div key={l} className="nk-stat" style={{ borderColor: c + "33" }}>
                      <div className="nk-stat-num" style={{ color: c }}>{v}</div>
                      <div className="nk-stat-label">{l}</div>
                    </div>
                  ))}
                </div>

                {bulkLog.length > 0 && (
                  <div className="nk-log">
                    <div className="nk-sec">Send Log</div>
                    {bulkLog.map((x, i) => (
                      <div key={i} className="nk-log-row" style={{ color: x.status === "sent" ? N.green : N.textMid }}>
                        <span>{x.status === "sent" ? "✓" : "⏳"}</span>
                        <span>{x.name}</span>
                        <span style={{ fontSize: 11, color: N.textDim }}>{x.status === "sent" ? "Sent" : "Sending…"}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="nk-table-wrap">
                  <table className="nk-table">
                    <thead>
                      <tr>
                        {["#", "Name", "Card Type", "Phone", "WA Status", "Actions"].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((rec, i) => (
                        <RecordRow key={i} rec={rec} idx={i}
                          onEdit={editRecord} onOpenTest={openWaTest} onConfirmWa={confirmWa}
                          onSendSingle={sendSingle} onDownload={downloadCard}
                          isActive={activeIdx === i}
                          onActivate={() => { setActiveIdx(i); setTab("design"); }} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </main>

          {/* RIGHT PANEL */}
          <aside className="nk-sidebar-right">
            <div className="nk-sec">Element Properties</div>

            {!selectedEl && (
              <p style={{ fontSize: 12, color: N.textDim, lineHeight: 1.6 }}>
                Click an element on the canvas to edit its properties.
              </p>
            )}

            {selectedEl?.type === "text" && (
              <>
                <label className="nk-label">Font Size — {selectedEl.fontSize}px</label>
                <input type="range" min={8} max={Math.round(ch * 0.5)} value={selectedEl.fontSize}
                  onChange={e => updateEl("fontSize", Number(e.target.value))} />
                <label className="nk-label">Color</label>
                <input type="color" value={selectedEl.color} onChange={e => updateEl("color", e.target.value)}
                  className="nk-input" style={{ height: 40, padding: 4 }} />
                <label className="nk-label">Weight</label>
                <button className="nk-btn nk-btn-full" style={{ marginBottom: 10, background: selectedEl.bold ? N.accent : "transparent", color: selectedEl.bold ? "#fff" : N.textMid, border: `1.5px solid ${selectedEl.bold ? N.accent : N.border}`, borderRadius: 8 }}
                  onClick={() => updateEl("bold", !selectedEl.bold)}>
                  {selectedEl.bold ? "Bold ON" : "Bold OFF"}
                </button>
                <label className="nk-label">Alignment</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  {["left", "center", "right"].map(a => (
                    <button key={a} onClick={() => updateEl("align", a)}
                      style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: `1.5px solid ${(selectedEl.align||"left")===a ? N.accent : N.border}`, background: (selectedEl.align||"left")===a ? N.accent+"22" : "transparent", color: (selectedEl.align||"left")===a ? N.sky : N.textDim, cursor: "pointer", fontSize: 16, fontFamily: "inherit" }}>
                      {a === "left" ? "⬅" : a === "center" ? "⬛" : "➡"}
                    </button>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <label className="nk-label">X (px)</label>
                    <input type="number" value={Math.round(selectedEl.x)} onChange={e => updateEl("x", Number(e.target.value))} className="nk-input" />
                  </div>
                  <div>
                    <label className="nk-label">Y (px)</label>
                    <input type="number" value={Math.round(selectedEl.y)} onChange={e => updateEl("y", Number(e.target.value))} className="nk-input" />
                  </div>
                </div>
              </>
            )}

            {selectedEl?.type === "qr" && (
              <>
                <label className="nk-label">QR Size — {selectedEl.size}px</label>
                <input type="range" min={60} max={Math.round(Math.min(cw, ch) * 0.8)} value={selectedEl.size}
                  onChange={e => updateEl("size", Number(e.target.value))} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <label className="nk-label">X (px)</label>
                    <input type="number" value={Math.round(selectedEl.x)} onChange={e => updateEl("x", Number(e.target.value))} className="nk-input" />
                  </div>
                  <div>
                    <label className="nk-label">Y (px)</label>
                    <input type="number" value={Math.round(selectedEl.y)} onChange={e => updateEl("y", Number(e.target.value))} className="nk-input" />
                  </div>
                </div>
                <p style={{ fontSize: 11, color: N.textDim, lineHeight: 1.6, marginTop: 4 }}>
                  Encodes: <code style={{ fontFamily: "JetBrains Mono, monospace", color: N.sky, fontSize: 11 }}>Name=…;TypeCard=…</code>
                </p>
              </>
            )}

            <div className="nk-divider" style={{ marginTop: 8 }} />

            <div className="nk-chip">
              Canvas: {cw} × {ch} px<br/>
              Export: {cw} × {ch} px<br/>
              {bgSize
                ? <span className="nk-chip-ok">✓ Locked to template</span>
                : <span className="nk-chip-warn">⚠ Default size</span>}
            </div>

            <div className="nk-divider" />
            <div className="nk-sec">Edit Record</div>

            <label className="nk-label">Name</label>
            <input className="nk-input" value={activeRecord.name || ""} onChange={e => editRecord(activeIdx, "name", e.target.value)} />
            <label className="nk-label">Card Type</label>
            <input className="nk-input" value={activeRecord.cardType || ""} onChange={e => editRecord(activeIdx, "cardType", e.target.value)} />
            <label className="nk-label">Phone</label>
            <input className="nk-input" value={activeRecord.phone || ""} onChange={e => editRecord(activeIdx, "phone", e.target.value)} placeholder="+255…" />

            <button className="nk-btn nk-btn-primary nk-btn-full" onClick={() => openWaTest(activeIdx)}>🔍 Test on WhatsApp</button>

            {activeRecord.waStatus === WA.testing && (
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button className="nk-btn nk-btn-success" style={{ flex: 1 }} onClick={() => confirmWa(activeIdx, true)}>✓ Yes</button>
                <button className="nk-btn nk-btn-danger"  style={{ flex: 1 }} onClick={() => confirmWa(activeIdx, false)}>✗ No</button>
              </div>
            )}
            {activeRecord.waStatus === WA.yes && (
              <button className="nk-btn nk-btn-success nk-btn-full" onClick={() => sendSingle(activeIdx)}>📲 Send via WhatsApp</button>
            )}

            <button className="nk-btn nk-btn-ghost nk-btn-full" style={{ marginTop: 4 }}
              onClick={() => { setRecords(r => [...r, { name: "New Person", cardType: "STAFF", phone: "", waStatus: WA.idle }]); setActiveIdx(records.length); }}>
              + Add Record
            </button>
          </aside>

        </div>
      </div>
    </>
  );
}