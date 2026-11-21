import { useState, useRef, useEffect, useId } from "react";
import Icon from "./Icon";
import { N, alpha } from "./lib/theme";
import { parseQrPayload, SCAN_REASON } from "./lib/scan";
import { scanStatus, remaining, peopleLabel } from "./lib/cardRules";
import { createCamera, coverSize, scanBoxSide } from "./lib/camera";

// The door check-in screen, shared by the staff Scanner tab (App.jsx) and the public,
// code-protected Scan page (PublicScanPage.jsx). It only talks to the outside through
// the callbacks it is given, so both can use the same UI with different data paths:
//   findCard({ id, name, cardType }) → Promise<card[]>   (QR lookup; ID first, name fallback)
//   search(query)                    → Promise<card[]>   (manual search)
//   checkIn(card, count, method)     → Promise<{ accepted, reason, scan_count, max_scans, name, card_type }>
// A card is { id, name, card_type, max_scans, scan_count }.
// On phones the pages show one view at a time with <ScanTabBar> (Statistics / Scan / Guests)
// and tell the panel which part to show with `section`. Everything stays mounted, so a
// check-in started from the guest list still gets its "how many are entering?" prompt.
// The camera is stopped after every read (saves battery on a phone used all evening), and it
// must really be released each time: a phone only lets one page hold the camera, so a stream
// left running in the background makes the next "Scan next card" fail until the screen is
// locked. The start / stop order that guarantees this is in src/lib/camera.js (unit-tested).

const loadQr = () => import("html5-qrcode");

// Last resort after every scan: stop any camera track still attached to the box's video and
// empty the box, so nothing keeps the camera even if the library's own stop() didn't run
const releaseCameraBox = (id) => {
  const box = document.getElementById(id);
  if (!box) return;
  box.querySelectorAll("video").forEach(v => {
    const stream = v.srcObject;
    if (stream && typeof stream.getTracks === "function") stream.getTracks().forEach(t => { try { t.stop(); } catch { /* already ended */ } });
    v.srcObject = null;
  });
  box.innerHTML = "";   // React renders nothing inside this box; only the library's leftovers go
};

// Why the camera didn't start, in words for the door staff
const camErrorText = (e) => {
  const s = `${e?.name || ""} ${e?.message || e || ""}`;
  if (/NotAllowed|Permission/i.test(s)) return "Camera permission was refused. Allow the camera in the browser settings, or search by name below.";
  if (/NotReadable|Could not start video source|in use|TrackStart/i.test(s)) return "The camera is busy — close other apps or tabs using it, then press Start camera again. You can also search by name below.";
  if (/NotFound|Overconstrained|no camera/i.test(s)) return "No camera was found on this device. Search by name below.";
  return "Could not start the camera. Press Start camera to try again, or search by name below.";
};

const CSS = `
  .sp-wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  .sp-card { background: ${N.navy800}; border: 1px solid ${N.border}; border-radius: 14px; padding: 16px; }
  /* The camera box: always square and centred, and small enough to fit a short phone screen */
  .sp-cam { position: relative; width: 100%; max-width: min(420px, 58vh); margin: 0 auto; aspect-ratio: 1; border-radius: 12px;
    overflow: hidden; background: ${N.navy900}; display: grid; place-items: center; color: ${N.textDim}; }
  /* The library's own box (it sets position: relative inline, hence !important) fills ours */
  .sp-feed { position: absolute !important; inset: 0; overflow: hidden; }
  /* The video keeps its own shape (sized in JS by coverSize) and is centred; the box crops the rest */
  .sp-feed video { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); max-width: none; }
  /* The library centres its shading on the whole video, which is off-centre in our box — we draw our own frame */
  .sp-feed #qr-shaded-region { display: none !important; }
  .sp-result { border-radius: 14px; padding: 20px; text-align: center; border: 2px solid; }
  .sp-result-icon { width: 64px; height: 64px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 30px; color: #fff; margin-bottom: 10px; }
  .sp-name { font-size: 22px; font-weight: 800; color: ${N.text}; word-break: break-word; }
  .sp-sub { font-size: 13px; color: ${N.textMid}; margin-top: 4px; }
  .sp-count { font-size: 34px; font-weight: 800; margin: 10px 0 2px; font-variant-numeric: tabular-nums; }
  .sp-row { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 10px; border: 1px solid ${N.border}; background: ${N.navy700}; margin-bottom: 6px; }
  .sp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 10px 16px; border-radius: 10px;
    border: 1.5px solid ${N.border}; background: transparent; color: ${N.text}; font: 600 14px 'Plus Jakarta Sans', sans-serif; cursor: pointer; }
  .sp-btn:disabled { opacity: .5; cursor: not-allowed; }
  .sp-btn-primary { background: ${N.accent}; border-color: ${N.accent}; color: #fff; }
  .sp-btn-go { background: ${N.green}; border-color: ${N.green}; color: #fff; }
  .sp-input { width: 100%; min-height: 44px; padding: 10px 12px; border-radius: 10px; border: 1.5px solid ${N.border}; background: ${N.navy900}; color: ${N.text}; font-size: 16px; }
  .sp-stepper { display: flex; align-items: center; justify-content: center; gap: 14px; margin: 14px 0; }
  .sp-stepper .sp-btn { width: 52px; height: 52px; font-size: 22px; padding: 0; }
  .sp-stepper-n { font-size: 40px; font-weight: 800; min-width: 70px; text-align: center; color: ${N.text}; }
  .nk-spin { animation: spSpin .9s linear infinite; } @keyframes spSpin { to { transform: rotate(360deg); } }
  /* "It's working": a glowing line sweeps up and down over the camera while it looks for a code */
  .sp-scanning { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
  /* The scan frame: 70% of the box, centred — exactly the area read (SCAN_FRAME in lib/camera.js);
     everything outside it is darkened */
  .sp-frame { position: absolute; top: 15%; left: 15%; width: 70%; height: 70%; border-radius: 14px;
    box-shadow: 0 0 0 100vmax rgba(0,0,0,.45); }
  .sp-corner { position: absolute; width: 30px; height: 30px; border: 4px solid ${N.green}; }
  .sp-corner.tl { top: -2px; left: -2px; border-right: 0; border-bottom: 0; border-top-left-radius: 14px; }
  .sp-corner.tr { top: -2px; right: -2px; border-left: 0; border-bottom: 0; border-top-right-radius: 14px; }
  .sp-corner.bl { bottom: -2px; left: -2px; border-right: 0; border-top: 0; border-bottom-left-radius: 14px; }
  .sp-corner.br { bottom: -2px; right: -2px; border-left: 0; border-top: 0; border-bottom-right-radius: 14px; }
  .sp-laser { position: absolute; left: 6%; right: 6%; top: 8%; height: 3px; border-radius: 3px;
    background: linear-gradient(90deg, transparent, ${N.green} 15%, ${N.green} 85%, transparent);
    box-shadow: 0 0 10px 2px ${alpha(N.green, "aa")}, 0 0 28px 6px ${alpha(N.green, "55")};
    animation: spLaser 2.2s ease-in-out infinite alternate; }
  @keyframes spLaser { from { top: 4%; } to { top: 96%; } }
  /* white on dark glass on purpose: it sits over the live camera picture, whatever the theme */
  .sp-scan-tag { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; border-radius: 999px; background: rgba(0,0,0,.55); color: #fff; font: 600 12px 'Plus Jakarta Sans', sans-serif; white-space: nowrap; }
  .sp-scan-dot { width: 8px; height: 8px; border-radius: 50%; background: ${N.green}; animation: spPulse 1.2s ease-in-out infinite; }
  @keyframes spPulse { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
  @media (prefers-reduced-motion: reduce) {
    .sp-laser { top: 50%; animation: spPulse 1.6s ease-in-out infinite; }
  }
  @media (max-width: 760px) {
    .sp-wrap { grid-template-columns: 1fr; gap: 12px; }
    .sp-card { padding: 12px; }
    .sp-cam { max-width: min(100%, 62vh); }
  }
  /* Phones, guest list view: a check-in's result floats just above the tab bar */
  .sp-float { position: fixed; left: 12px; right: 12px; bottom: calc(80px + env(safe-area-inset-bottom, 0px)); z-index: 450;
    display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; border: 2px solid;
    background: ${N.navy800}; box-shadow: 0 10px 30px var(--nk-shadow); animation: spUp .2s ease; }
  .sp-float-icon { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: #fff; flex-shrink: 0; font-size: 17px; }
  .sp-float-x { width: 36px; height: 36px; border-radius: 10px; border: 1px solid ${N.border}; background: transparent; color: ${N.textMid}; cursor: pointer; flex-shrink: 0; }
  @keyframes spUp { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
`;

// The phone scanner's bottom tab bar. The toast and the activity panel move up above it.
const BAR_CSS = `
  .sp-tabbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 400; display: flex; gap: 4px;
    background: ${N.navy800}; border-top: 1px solid ${N.border}; box-shadow: 0 -6px 20px var(--nk-shadow);
    padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px)); }
  .sp-tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 54px;
    border: none; border-radius: 12px; background: transparent; color: ${N.textDim}; font: 700 11px 'Plus Jakarta Sans', sans-serif; cursor: pointer; }
  .sp-tab-ic { font-size: 21px; line-height: 1; display: grid; place-items: center; }
  .sp-tab.on { color: ${N.sky}; }
  .sp-tab:not(.sp-tab-main).on .sp-tab-ic { background: ${alpha(N.accent, "22")}; border-radius: 10px; padding: 3px 14px; }
  /* Scan, in the middle, is the main action: a round button raised over the bar */
  .sp-tab-main .sp-tab-ic { width: 50px; height: 50px; margin-top: -24px; border-radius: 50%; background: ${N.accent}; color: #fff;
    box-shadow: 0 6px 16px ${alpha(N.accent, "66")}; border: 3px solid ${N.navy800}; }
  .sp-tab-main.on .sp-tab-ic { background: ${N.green}; box-shadow: 0 6px 16px ${alpha(N.green, "66")}; }
  .sp-tab:focus-visible { outline: 2px solid ${N.accent}; outline-offset: 2px; }
  body:has(.sp-tabbar) .nk-toast { left: 12px; right: 12px; max-width: none; bottom: calc(84px + env(safe-area-inset-bottom, 0px)); }
  body:has(.sp-tabbar) .nk-activity { bottom: calc(84px + env(safe-area-inset-bottom, 0px)); }
`;

// The Statistics view: tiles in rows of 1, 3, 2 and 1 (as door staff read them)
const STATS_CSS = `
  .sp-stats { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
  .sp-stat { grid-column: span 6; background: ${N.navy800}; border: 1px solid ${N.border}; border-radius: 14px; padding: 14px 10px; text-align: center; min-width: 0; }
  .sp-stat.third { grid-column: span 2; }
  .sp-stat.half { grid-column: span 3; }
  .sp-stat-v { font-size: 26px; font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .sp-stat.big .sp-stat-v { font-size: 36px; }
  .sp-stat-l { font-size: 10px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: ${N.textDim}; margin-top: 5px; }
  .sp-stat-s { font-size: 11px; color: ${N.textMid}; margin-top: 3px; }
  .sp-meter { height: 6px; border-radius: 6px; background: ${N.navy700}; overflow: hidden; margin-top: 8px; }
  .sp-meter > span { display: block; height: 100%; border-radius: 6px; background: ${N.green}; }
  .sp-dl { width: 100%; margin-top: 12px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px;
    border-radius: 12px; border: none; background: ${N.accent}; color: #fff; font: 700 14px 'Plus Jakarta Sans', sans-serif; cursor: pointer; }
  .sp-dl:disabled { opacity: .6; cursor: wait; }
`;

// Bottom tab bar of the phone scanner. tabs: [{ key, label, icon }]; the "scan" tab stands out.
export function ScanTabBar({ tabs, view, onChange }) {
  return (
    <>
      <style>{BAR_CSS}</style>
      <nav className="sp-tabbar" aria-label="Scanner views">
        {tabs.map(t => (
          <button key={t.key} type="button" className={`sp-tab${t.key === "scan" ? " sp-tab-main" : ""}${view === t.key ? " on" : ""}`}
            aria-current={view === t.key ? "page" : undefined} onClick={() => onChange(t.key)}>
            <span className="sp-tab-ic"><Icon n={t.icon} /></span>{t.label}
          </button>
        ))}
      </nav>
    </>
  );
}

// The Statistics view: total cards, cards by size, scanned cards and guests in, not scanned
// cards, and an optional report download. `stats` has scanBreakdown()'s shape
// (src/lib/cardRules.js); a figure that is missing (an older database) hides its tile.
export function ScanStats({ stats = {}, onDownload, downloading, children }) {
  const has = (v) => typeof v === "number" && Number.isFinite(v);
  const pct = has(stats.entered) && stats.people > 0 ? Math.min(100, Math.round(stats.entered / stats.people * 100)) : null;
  const tile = (label, value, color, size = "", sub = null) => has(value) && (
    <div className={`sp-stat ${size}`}>
      <div className="sp-stat-v" style={{color}}>{value}</div>
      <div className="sp-stat-l">{label}</div>
      {sub && <div className="sp-stat-s">{sub}</div>}
    </div>
  );
  return (
    <>
      <style>{STATS_CSS}</style>
      <div className="sp-stats">
        {tile("Total cards", stats.cards, N.sky, "big", has(stats.people) ? `for ${peopleLabel(stats.people)}` : null)}
        {stats.byType?.length > 0
          ? stats.byType.map(t => (
              <div key={t.type} className="sp-stat third">
                <div className="sp-stat-v" style={{color:N.text}}>{t.cards}</div>
                <div className="sp-stat-l">{t.type}</div>
                <div className="sp-stat-s">{peopleLabel(t.people)}</div>
              </div>
            ))
          : <>{tile("Single", stats.single, N.text, "third")}{tile("Double", stats.double, N.text, "third")}{tile("Group", stats.group, N.text, "third")}</>
        }
        {tile("Scanned cards", stats.scanned, N.green, "half", has(stats.complete) ? `${stats.complete} fully in` : null)}
        {has(stats.entered) && (
          <div className="sp-stat half">
            <div className="sp-stat-v" style={{color:N.green}}>{stats.entered}{has(stats.people) && <span style={{fontSize:15,color:N.textDim}}> / {stats.people}</span>}</div>
            <div className="sp-stat-l">Guests in</div>
            {pct !== null && <div className="sp-meter" role="img" aria-label={`${pct}% of guests have entered`}><span style={{width:`${pct}%`}} /></div>}
          </div>
        )}
        {tile("Not scanned cards", stats.notScanned, N.amber)}
      </div>
      {onDownload && (
        <button type="button" className="sp-dl" onClick={onDownload} disabled={downloading}>
          {downloading ? <><Icon n="loader" /> Preparing the report…</> : <><Icon n="download" /> Download check-in report</>}
        </button>
      )}
      {children}
    </>
  );
}

const statusTone = (s) => s === "complete" ? N.green : s === "partial" ? N.amber : N.textDim;

// renderBelow({ begin, busy }) — optional extra content (the staff guest list) that can start
// a check-in through the same flow, including the "how many are entering?" prompt.
// section — what shows: "all" (default: camera + search, then renderBelow), "scan" (camera +
//   search), "list" (renderBelow only; results float above the tab bar) or "none".
// startSignal — a number the page bumps when the user taps the Scan tab: the camera opens
//   straight away (the tap is the user's go-ahead).
export default function ScanPanel({ findCard, search, checkIn, scannerName, disabled, disabledReason, renderBelow, section = "all", startSignal = 0 }) {
  const showScan = section === "all" || section === "scan";
  const showList = section === "all" || section === "list";
  const camId = useId().replace(/:/g, "");
  const [camOn, setCamOn]   = useState(false);
  const [camReady, setCamReady] = useState(false);   // the video is showing
  const [camErr, setCamErr] = useState(null);
  const [busy, setBusy]     = useState(false);
  const [result, setResult] = useState(null);   // { tone, title, card, message }
  const [ask, setAsk]       = useState(null);   // { card, method, n } — "how many are entering?"
  const [pick, setPick]     = useState(null);   // several cards match an ID-less QR
  const [q, setQ]           = useState("");
  const [hits, setHits]     = useState([]);
  // One camera controller per panel (src/lib/camera.js): it makes sure the camera is really
  // released after each read, so "Scan next card" can always open it again
  const [camera] = useState(() => createCamera({
    create: async () => { const { Html5Qrcode } = await loadQr(); return new Html5Qrcode(camId, { verbose: false }); },
    release: () => releaseCameraBox(camId),
    nextFrame: () => new Promise(r => requestAnimationFrame(() => r())),
  }));

  // Turns the camera off and gives it back to the phone
  const stopCam = () => { setCamOn(false); setCamReady(false); return camera.stop(); };
  useEffect(() => {
    // Leaving the page or locking the phone gives the camera back straight away
    const onHide = () => { if (document.hidden) stopCam(); };
    document.addEventListener("visibilitychange", onHide);
    return () => { document.removeEventListener("visibilitychange", onHide); camera.stop(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- stopCam only touches the controller and state setters

  // As soon as the camera picture's shape is known (loadedmetadata — always before the
  // library measures the video on "playing"), size the video to cover the square box while
  // keeping its shape (coverSize), so the scan area is centred and the code isn't squashed.
  // Media events don't bubble, so this listens in the capture phase.
  useEffect(() => {
    const box = document.getElementById(camId);
    if (!box) return;
    const fit = (e) => {
      const v = e.target;
      if (!v || v.tagName !== "VIDEO") return;
      const size = coverSize(v.videoWidth, v.videoHeight, box.clientWidth, box.clientHeight);
      if (size) { v.style.width = `${size.width}px`; v.style.height = `${size.height}px`; }
    };
    box.addEventListener("loadedmetadata", fit, true);
    return () => box.removeEventListener("loadedmetadata", fit, true);
  }, [camId]);

  // Turns the camera on and waits for one QR code (the controller stops it after the read)
  const startCam = async () => {
    if (disabled || camera.busy) return;
    setCamErr(null); setResult(null); setPick(null);
    setCamOn(true); setCamReady(false);                   // show the box first, so the video gets a size
    try {
      const r = await camera.start({
        constraints: { facingMode: "environment" },
        // Read exactly the frame drawn on screen: 70% of the box, centred
        config: { fps: 10, qrbox: (viewW, viewH) => {
          const side = scanBoxSide(document.getElementById(camId)?.clientWidth, viewW, viewH);
          return { width: side, height: side };
        } },
        onCode: (text) => { setCamOn(false); setCamReady(false); onQr(text); },
      });
      if (r === "started") setCamReady(true);
    } catch (e) {
      setCamOn(false); setCamReady(false);
      setCamErr(camErrorText(e));
    }
  };

  // Phones: leaving the Scan view gives the camera back (the cleanup runs when it hides)
  useEffect(() => {
    if (!showScan) return;
    return () => { stopCam(); };
  }, [showScan]); // eslint-disable-line react-hooks/exhaustive-deps -- stopCam only touches the controller and state setters

  // Phones: tapping the Scan tab opens the camera at once
  const lastSignal = useRef(startSignal);
  useEffect(() => {
    if (startSignal === lastSignal.current) return;
    lastSignal.current = startSignal;
    if (showScan && !camOn) startCam();
  }, [startSignal]); // eslint-disable-line react-hooks/exhaustive-deps -- runs only when the page asks for the camera

  // Guest list view: a check-in result floats for a few seconds, then goes
  useEffect(() => {
    if (section !== "list" || !result) return;
    const t = setTimeout(() => setResult(null), 5000);
    return () => clearTimeout(t);
  }, [section, result]);

  const fail = (title, message) => setResult({ tone: "bad", title, message });

  // A QR code was read: find the card (by ID, else by name), then check in
  const onQr = async (text) => {
    const p = parseQrPayload(text);
    if (!p.id && !p.name) { fail("Not a Nikadi card", "This QR code isn't from an event card."); return; }
    setBusy(true);
    try {
      const cards = await findCard(p);
      if (!cards.length) { fail(SCAN_REASON.not_found, p.name ? `No guest named “${p.name}” in this event.` : "This card belongs to another event."); return; }
      if (cards.length > 1) { setPick({ cards, method: "qr_fallback" }); return; }
      begin(cards[0], p.id ? "qr" : "qr_fallback");
    } catch (e) { fail("Could not look up the card", e.message); }
    finally { setBusy(false); }
  };

  // Single-place cards check in at once; cards with more places ask how many are entering
  const begin = (card, method) => {
    setPick(null);
    const left = remaining(card.scan_count, card.max_scans);
    if (left <= 0) { setResult({ tone: "bad", title: SCAN_REASON.limit_reached, card, message: `All ${peopleLabel(card.max_scans)} on this card have entered.` }); return; }
    if (left === 1) { confirm(card, 1, method); return; }
    setAsk({ card, method, n: left });
  };

  const confirm = async (card, n, method) => {
    setAsk(null); setBusy(true);
    try {
      const r = await checkIn(card, n, method);
      const after = { ...card, ...r, scan_count: r.scan_count ?? card.scan_count, max_scans: r.max_scans ?? card.max_scans };
      if (r.accepted) {
        setResult({ tone: "good", title: SCAN_REASON.ok, card: after,
          message: `${peopleLabel(n)} checked in · ${after.scan_count} of ${after.max_scans} entered` });
        setHits(h => h.map(x => x.id === after.id ? { ...x, scan_count: after.scan_count, max_scans: after.max_scans } : x));
      } else {
        setResult({ tone: "bad", title: SCAN_REASON[r.reason] || "Not accepted", card: after,
          message: r.reason === "limit_reached" ? `Only ${remaining(after.scan_count, after.max_scans)} place(s) left on this card.` : "" });
      }
    } catch (e) { fail("Check-in failed", e.message); }
    finally { setBusy(false); }
  };

  // Search as you type (debounced) — no need to press a button. Enter still searches at once.
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);
  const runSearch = async (term) => {
    const seq = ++searchSeq.current;
    setSearching(true);
    try { const r = await search(term); if (seq === searchSeq.current) setHits(r); }
    catch (err) { if (seq === searchSeq.current) fail("Search failed", err.message); }
    finally { if (seq === searchSeq.current) setSearching(false); }
  };
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { searchSeq.current++; return; }
    const t = setTimeout(() => runSearch(term), 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps -- search callback identity changes every render
  const doSearch = (e) => { e?.preventDefault(); if (q.trim().length >= 2) runSearch(q.trim()); };
  const shownHits = q.trim().length >= 2 ? hits : [];

  const tone = result ? (result.tone === "good" ? N.green : N.red) : null;
  return (
    <>
      <style>{CSS}</style>
      {disabled && section !== "none" && (
        <div className="sp-card" style={{marginBottom:16,borderColor:alpha(N.amber,"66"),color:N.amber,fontSize:13}}>
          <Icon n="alert" /> {disabledReason}
        </div>
      )}
      <div className="sp-wrap" style={showScan ? undefined : {display:"none"}}>
        <div className="sp-card">
          <div className="sp-cam" style={{position:"relative"}}>
            <div id={camId} className="sp-feed" style={{display:camOn ? "block" : "none"}} />
            {camOn && !camReady && (
              <div style={{position:"absolute",inset:0,display:"grid",placeItems:"center",color:N.textDim,fontSize:13}} role="status">
                <span><Icon n="loader" /> Opening the camera…</span>
              </div>
            )}
            {camOn && camReady && (
              <div className="sp-scanning" role="status" aria-label="Scanning for a QR code">
                <div className="sp-frame">
                  <span className="sp-corner tl" /><span className="sp-corner tr" /><span className="sp-corner bl" /><span className="sp-corner br" />
                  <div className="sp-laser" />
                </div>
                <div className="sp-scan-tag"><span className="sp-scan-dot" /> Scanning — hold the QR code in view</div>
              </div>
            )}
            {!camOn && (
              <div style={{textAlign:"center",padding:20}}>
                <Icon n="camera" size="48px" />
                <div style={{fontSize:13,marginTop:10}}>{camErr || "Point the camera at the QR code on the card"}</div>
              </div>
            )}
          </div>
          <div style={{display:"flex",gap:8,marginTop:12}}>
            {camOn
              ? <button className="sp-btn" style={{flex:1}} onClick={stopCam}><Icon n="x" /> Stop camera</button>
              : <button className="sp-btn sp-btn-primary" style={{flex:1}} onClick={startCam} disabled={disabled || busy}>
                  <Icon n="camera" /> {result ? "Scan next card" : "Start camera"}
                </button>}
          </div>
          {scannerName && <div style={{fontSize:11,color:N.textDim,marginTop:8,textAlign:"center"}}>Scanning as {scannerName}</div>}
        </div>

        <div>
          {busy && !ask && <div className="sp-card" style={{textAlign:"center",color:N.textDim,marginBottom:12}} role="status"><Icon n="loader" /> Checking…</div>}

          {result && (
            <div className="sp-result" style={{borderColor:tone,background:alpha(tone,"14"),marginBottom:12}} role="status" aria-live="assertive">
              <div className="sp-result-icon" style={{background:tone}}><Icon n={result.tone === "good" ? "check" : "xCircle"} /></div>
              <div style={{fontSize:16,fontWeight:800,color:tone}}>{result.title}</div>
              {result.card && <div className="sp-name">{result.card.name}</div>}
              {result.card && <div className="sp-sub">{result.card.card_type || "No card type"}</div>}
              {result.card && <div className="sp-count" style={{color:tone}}>{result.card.scan_count} / {result.card.max_scans}</div>}
              {result.message && <div className="sp-sub">{result.message}</div>}
            </div>
          )}

          {pick && (
            <div className="sp-card" style={{marginBottom:12}}>
              <div style={{fontWeight:700,color:N.text,marginBottom:8}}>Several guests have this name — choose one</div>
              {pick.cards.map(c => (
                <button key={c.id} className="sp-row" style={{width:"100%",cursor:"pointer",textAlign:"left"}} onClick={() => begin(c, pick.method)}>
                  <span style={{flex:1,minWidth:0}}><strong style={{color:N.text}}>{c.name}</strong> <span style={{color:N.textDim}}>· {c.card_type || "—"}</span></span>
                  <span style={{color:statusTone(scanStatus(c.scan_count, c.max_scans)),fontWeight:700}}>{c.scan_count}/{c.max_scans}</span>
                </button>
              ))}
            </div>
          )}

          <form className="sp-card" onSubmit={doSearch}>
            <label style={{fontSize:12,fontWeight:700,color:N.textDim,display:"block",marginBottom:6}} htmlFor={camId + "q"}>No QR? Search by name or passcode</label>
            <div style={{display:"flex",gap:8}}>
              <input id={camId + "q"} className="sp-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Name or passcode" disabled={disabled} />
              <button className="sp-btn" type="submit" disabled={disabled || busy} aria-label="Search guests"><Icon n="search" /></button>
            </div>
            <div style={{marginTop:10}}>
              {shownHits.map(c => {
                const st = scanStatus(c.scan_count, c.max_scans);
                return (
                  <div key={c.id} className="sp-row">
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,color:N.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</div>
                      <div style={{fontSize:12,color:N.textDim}}>{c.card_type || "—"} · <span style={{color:statusTone(st)}}>{c.scan_count}/{c.max_scans} entered</span></div>
                    </div>
                    <button type="button" className="sp-btn sp-btn-go" disabled={disabled || busy || st === "complete"}
                      onClick={() => begin(c, "manual")} aria-label={`Check in ${c.name}`} title={st === "complete" ? "Everyone on this card has entered" : `Check in ${c.name}`}>
                      <Icon n="check" /> <span>Check in</span>
                    </button>
                  </div>
                );
              })}
              {q.trim().length >= 2 && searching && !shownHits.length && <div style={{fontSize:12,color:N.textDim}}><Icon n="loader" /> Searching…</div>}
              {q.trim().length >= 2 && !searching && !shownHits.length && <div style={{fontSize:12,color:N.textDim}}>No guest matches “{q.trim()}”.</div>}
            </div>
          </form>
        </div>
      </div>
      {renderBelow && <div style={showList ? undefined : {display:"none"}}>{renderBelow({ begin, busy })}</div>}

      {section === "list" && (result || (busy && !ask)) && (
        <div className="sp-float" style={{borderColor:tone || N.border}} role="status" aria-live="assertive">
          {!result ? <span style={{color:N.textMid,fontWeight:600}}><Icon n="loader" /> Checking…</span> : (
            <>
              <span className="sp-float-icon" style={{background:tone}}><Icon n={result.tone === "good" ? "check" : "xCircle"} /></span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:800,color:tone,fontSize:14}}>{result.title}</div>
                {result.card && <div style={{fontWeight:700,color:N.text,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{result.card.name} · {result.card.scan_count} / {result.card.max_scans}</div>}
                {result.message && <div style={{fontSize:12,color:N.textMid}}>{result.message}</div>}
              </div>
              <button type="button" className="sp-float-x" onClick={() => setResult(null)} aria-label="Close" title="Close"><Icon n="x" /></button>
            </>
          )}
        </div>
      )}

      {ask && (
        <div className="nk-overlay nk-top" style={{position:"fixed",inset:0,zIndex:700,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div className="sp-card" style={{width:"100%",maxWidth:380,textAlign:"center"}} role="dialog" aria-modal="true" aria-label="How many are entering?">
            <div style={{fontSize:13,color:N.textDim}}>{ask.card.card_type} card · {ask.card.scan_count} of {ask.card.max_scans} entered</div>
            <div className="sp-name" style={{marginTop:4}}>{ask.card.name}</div>
            <div style={{fontWeight:700,color:N.text,marginTop:14}}>How many are entering now?</div>
            <div className="sp-stepper">
              <button className="sp-btn" onClick={() => setAsk(a => ({ ...a, n: Math.max(1, a.n - 1) }))} aria-label="One fewer"><Icon n="minus" /></button>
              <div className="sp-stepper-n" aria-live="polite">{ask.n}</div>
              <button className="sp-btn" onClick={() => setAsk(a => ({ ...a, n: Math.min(remaining(a.card.scan_count, a.card.max_scans), a.n + 1) }))} aria-label="One more"><Icon n="plus" /></button>
            </div>
            <div style={{fontSize:12,color:N.textDim,marginBottom:14}}>Up to {remaining(ask.card.scan_count, ask.card.max_scans)} can still enter on this card</div>
            <div style={{display:"flex",gap:8}}>
              <button className="sp-btn" style={{flex:1}} onClick={() => setAsk(null)}>Cancel</button>
              <button className="sp-btn sp-btn-go" style={{flex:2}} onClick={() => confirm(ask.card, ask.n, ask.method)}>
                <Icon n="check" /> Admit {peopleLabel(ask.n)}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
