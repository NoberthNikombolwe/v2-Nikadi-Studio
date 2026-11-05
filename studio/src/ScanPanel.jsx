import { useState, useRef, useEffect, useId } from "react";
import Icon from "./Icon";
import { N, alpha } from "./lib/theme";
import { parseQrPayload, SCAN_REASON } from "./lib/scan";
import { scanStatus, remaining, peopleLabel } from "./lib/cardRules";

// The door check-in screen, shared by the staff Scanner tab (App.jsx) and the public,
// code-protected Scan page (PublicScanPage.jsx). It only talks to the outside through
// the callbacks it is given, so both can use the same UI with different data paths:
//   findCard({ id, name, cardType }) → Promise<card[]>   (QR lookup; ID first, name fallback)
//   search(query)                    → Promise<card[]>   (manual search)
//   checkIn(card, count, method)     → Promise<{ accepted, reason, scan_count, max_scans, name, card_type }>
// A card is { id, name, card_type, max_scans, scan_count }.
// The camera is stopped after every read (saves battery on a phone used all evening).

const loadQr = () => import("html5-qrcode");

const CSS = `
  .sp-wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  .sp-card { background: ${N.navy800}; border: 1px solid ${N.border}; border-radius: 14px; padding: 16px; }
  .sp-cam { width: 100%; aspect-ratio: 1; max-height: 420px; border-radius: 12px; overflow: hidden; background: ${N.navy900}; display: grid; place-items: center; color: ${N.textDim}; }
  .sp-cam video { width: 100% !important; height: 100% !important; object-fit: cover; }
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
  @media (max-width: 760px) { .sp-wrap { grid-template-columns: 1fr; } }
`;

const statusTone = (s) => s === "complete" ? N.green : s === "partial" ? N.amber : N.textDim;

export default function ScanPanel({ findCard, search, checkIn, scannerName, disabled, disabledReason }) {
  const camId = useId().replace(/:/g, "");
  const qr = useRef(null);
  const [camOn, setCamOn]   = useState(false);
  const [camErr, setCamErr] = useState(null);
  const [busy, setBusy]     = useState(false);
  const [result, setResult] = useState(null);   // { tone, title, card, message }
  const [ask, setAsk]       = useState(null);   // { card, method, n } — "how many are entering?"
  const [pick, setPick]     = useState(null);   // several cards match an ID-less QR
  const [q, setQ]           = useState("");
  const [hits, setHits]     = useState([]);

  const stopCam = async () => {
    const s = qr.current; qr.current = null;
    if (s) { try { await s.stop(); } catch { /* already stopped */ } try { s.clear(); } catch { /* ignore */ } }
    setCamOn(false);
  };
  useEffect(() => () => { stopCam(); }, []);

  // Turns the camera on and waits for one QR code
  const startCam = async () => {
    if (disabled) return;
    setCamErr(null); setResult(null); setPick(null);
    try {
      const { Html5Qrcode } = await loadQr();
      const s = new Html5Qrcode(camId, { verbose: false });
      qr.current = s;
      setCamOn(true);
      await s.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 230, height: 230 } },
        async (text) => { await stopCam(); onQr(text); }, () => {});
    } catch (e) {
      setCamOn(false); qr.current = null;
      setCamErr(/permission|notallowed/i.test(String(e)) ? "Camera permission was refused. Allow the camera in the browser settings, or search by name below."
        : "Could not start the camera. Use search by name below.");
    }
  };

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

  const doSearch = async (e) => {
    e?.preventDefault();
    if (q.trim().length < 2) { setHits([]); return; }
    setBusy(true);
    try { setHits(await search(q.trim())); } catch (err) { fail("Search failed", err.message); }
    finally { setBusy(false); }
  };

  const tone = result ? (result.tone === "good" ? N.green : N.red) : null;
  return (
    <>
      <style>{CSS}</style>
      {disabled && (
        <div className="sp-card" style={{marginBottom:16,borderColor:alpha(N.amber,"66"),color:N.amber,fontSize:13}}>
          <Icon n="alert" /> {disabledReason}
        </div>
      )}
      <div className="sp-wrap">
        <div className="sp-card">
          <div className="sp-cam">
            <div id={camId} style={{width:"100%",height:"100%",display:camOn ? "block" : "none"}} />
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
            <label style={{fontSize:12,fontWeight:700,color:N.textDim,display:"block",marginBottom:6}} htmlFor={camId + "q"}>No QR? Search the guest by name</label>
            <div style={{display:"flex",gap:8}}>
              <input id={camId + "q"} className="sp-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Type at least 2 letters" disabled={disabled} />
              <button className="sp-btn" type="submit" disabled={disabled || busy} aria-label="Search guests"><Icon n="search" /></button>
            </div>
            <div style={{marginTop:10}}>
              {hits.map(c => {
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
              {q.trim().length >= 2 && !busy && !hits.length && <div style={{fontSize:12,color:N.textDim}}>Press search to look up “{q.trim()}”.</div>}
            </div>
          </form>
        </div>
      </div>

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
