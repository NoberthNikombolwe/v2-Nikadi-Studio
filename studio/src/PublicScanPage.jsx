import Logo from "./Logo";
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./lib/supabase";
import Icon from "./Icon";
import ScanPanel, { ScanTabBar, ScanStats } from "./ScanPanel";
import useMediaQuery, { SCANNER_PHONE } from "./useMediaQuery";
import { N, alpha } from "./lib/theme";

// Public door-scanning page: #/scan/<eventId>. No login — the organiser shares the link
// and a 6-character code (Scanner tab → Share). Everything goes through code-checked
// database functions (public_scan_event / public_find_cards / public_recent_scans /
// scan_card); this page never reads a table directly. Regenerating or turning off the
// code in the app locks this page out at once.
// Phones get one view at a time with a bottom tab bar: Statistics (public_scan_stats — cards
// by size, scanned / not scanned), Scan, and Recent scans. There is no full guest list here
// on purpose: without a login, guests are only found by searching a name.

const codeKey = (id) => `nikadi_scan_code_${id}`;

const CODE_LEN = 6;

export default function PublicScanPage({ eventId }) {
  // eventId may be the full UUID (36 chars) or the first 8 hex chars of it (short URL).
  // eid is the resolved full UUID used in all RPC calls.
  const isShort = eventId.length === 8;
  const [eid, setEid] = useState(isShort ? null : eventId);
  const [code, setCode]   = useState(() => { try { return sessionStorage.getItem(codeKey(eventId)) || ""; } catch { return ""; } });
  const [input, setInput] = useState("");
  const [event, setEvent] = useState(null);       // { name, event_type, start_datetime, cards, people, entered }
  const [state, setState] = useState("checking"); // locked | checking | open | error — always starts checking
  const [error, setError] = useState(null);
  const [recent, setRecent] = useState([]);
  const [door, setDoor]   = useState(() => { try { return localStorage.getItem("nikadi_door_name") || ""; } catch { return ""; } });
  const [stats, setStats] = useState(null);       // public_scan_stats, in scanBreakdown()'s shape
  const statsMissing = useRef(false);             // the database doesn't have public_scan_stats yet
  const phone = useMediaQuery(SCANNER_PHONE);
  const [view, setView]   = useState("scan");     // phones: stats | scan | recent
  const [camSignal, setCamSignal] = useState(0);  // bumped when the Scan tab is tapped: opens the camera

  // Checks the code by asking for the event summary (empty result = wrong / changed code)
  const refresh = useCallback(async (c = code, id = eid) => {
    if (!id) return false;
    if (!supabase) { setState("error"); setError("This site is not connected to the database."); return false; }
    const { data, error: e } = await supabase.rpc("public_scan_event", { p_event: id, p_code: c });
    if (e) { setState("error"); setError(e.message); return false; }
    if (!data?.length) {
      try { sessionStorage.removeItem(codeKey(eventId)); } catch { /* ignore */ }
      setState("locked"); setEvent(null);
      return false;
    }
    setEvent(data[0]); setState("open");
    const r = await supabase.rpc("public_recent_scans", { p_event: id, p_code: c });
    if (!r.error) setRecent(r.data || []);
    if (!statsMissing.current) {
      const st = await supabase.rpc("public_scan_stats", { p_event: id, p_code: c });
      if (st.error) { if (st.error.code === "PGRST202" || st.status === 404) statsMissing.current = true; }
      else {
        const x = st.data?.[0];
        setStats(x ? { cards: x.cards, single: x.single_cards, double: x.double_cards, group: x.group_cards, people: x.people,
          entered: x.entered, scanned: x.scanned_cards, notScanned: x.cards - x.scanned_cards, complete: x.complete_cards } : null);
      }
    }
    return true;
  }, [code, eid]); // eslint-disable-line react-hooks/exhaustive-deps

  // On mount: for short IDs resolve to the full UUID first, then proceed as normal
  useEffect(() => {
    if (!isShort) { if (code) refresh(code, eventId); else setState("locked"); return; }
    if (!supabase) { setState("error"); setError("This site is not connected to the database."); return; }
    supabase.rpc("public_resolve_scan_id", { p_short: eventId }).then(({ data, error: e }) => {
      if (e || !data) { setState("error"); setError("Event not found. Check the link."); return; }
      setEid(data);
      if (code) refresh(code, data); else setState("locked");
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep the totals fresh while the page is open (other doors are scanning too)
  useEffect(() => {
    if (state !== "open") return;
    const t = setInterval(() => refresh(), 15000);
    return () => clearInterval(t);
  }, [state, refresh]);
  // Auto-start the camera when the page unlocks — ScanPanel only starts when
  // startSignal changes, so bump it once after the locked → open transition.
  useEffect(() => {
    if (state === "open") setCamSignal(n => n + 1);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const doUnlock = useCallback(async (c) => {
    if (!c || c.length < CODE_LEN) return;
    setState("checking"); setError(null);
    if (await refresh(c)) {
      setCode(c);
      try { sessionStorage.setItem(codeKey(eventId), c); } catch { /* private mode */ }
    } else setError("That code isn't right, or it was changed. Ask the organiser for the current code.");
  }, [refresh, eventId]);
  const unlock = (e) => { e.preventDefault(); doUnlock(input); };

  const findCard = async ({ id, name }) => {
    const { data, error: e } = await supabase.rpc("public_find_cards", id ? { p_event: eid, p_code: code, p_card: id }
                                                                          : { p_event: eid, p_code: code, p_query: name });
    if (e) throw e;
    const list = data || [];
    return id ? list : list.filter(c => c.name.trim().toLowerCase() === String(name).trim().toLowerCase());
  };
  const search = async (q) => {
    const { data, error: e } = await supabase.rpc("public_find_cards", { p_event: eid, p_code: code, p_query: q });
    if (e) throw e;
    return data || [];
  };
  const checkIn = async (card, count, method) => {
    const { data, error: e } = await supabase.rpc("scan_card", { p_card_id: card.id, p_method: method, p_count: count, p_scanned_by: door || "public scan page", p_code: code });
    if (e) throw e;
    const r = data?.[0] || {};
    if (r.reason === "bad_code") { setState("locked"); setCode(""); }
    refresh();
    return r;
  };

  const page = { minHeight: "100vh", background: N.navy900, color: N.text, fontFamily: "'Plus Jakarta Sans', sans-serif",
                 padding: "calc(env(safe-area-inset-top, 0px) + 16px) 16px calc(env(safe-area-inset-bottom, 0px) + 24px)" };
  const box = { maxWidth: 1000, margin: "0 auto" };
  const brand = (
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
      <div style={{width:36,height:36,borderRadius:10,background:`linear-gradient(135deg, ${N.accent}, ${N.sky})`,color:"#fff",fontWeight:800,display:"grid",placeItems:"center"}}><Logo title="Nikadi" /></div>
      <div><div style={{fontWeight:800}}>Nikadi Studio</div><div style={{fontSize:11,color:N.textDim}}>Door check-in</div></div>
    </div>
  );

  if (state !== "open") return (
    <div style={page}><div style={{...box, maxWidth:420}}>
      {brand}
      <form onSubmit={unlock} style={{background:N.navy800,border:`1px solid ${N.border}`,borderRadius:16,padding:"24px 16px"}}>
        <div style={{display:"flex",justifyContent:"center",marginBottom:18}}>
          <div style={{
            width:64,height:64,borderRadius:"50%",display:"grid",placeItems:"center",
            background:`radial-gradient(circle, ${alpha(N.accent,"33")} 0%, ${alpha(N.accent,"11")} 100%)`,
            border:`2px solid ${alpha(N.accent,"55")}`,fontSize:28,color:N.sky,
            boxShadow:`0 0 28px ${alpha(N.accent,"33")}`,
          }}><Icon n="lock" /></div>
        </div>
        <h1 style={{fontSize:20,fontWeight:800,marginBottom:4,textAlign:"center"}}>Enter the scan code</h1>
        <p style={{fontSize:13,color:N.textDim,marginBottom:18,textAlign:"center"}}>The event organiser gives each door a 6-character code.</p>
        <label style={{display:"block",fontSize:11,fontWeight:700,color:N.textDim,textTransform:"uppercase",letterSpacing:1,marginBottom:6}} htmlFor="scan-code">Scan Code</label>
        <input
          id="scan-code"
          value={input}
          autoFocus
          disabled={state === "checking"}
          maxLength={CODE_LEN}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          placeholder="Enter 6-character code"
          onChange={e => {
            const v = e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, CODE_LEN);
            setInput(v);
            if (v.length === CODE_LEN) doUnlock(v);
          }}
          style={{
            width:"100%", minHeight:52, padding:"12px 14px", borderRadius:10,
            border:`2px solid ${input.length === CODE_LEN ? N.sky : input.length > 0 ? alpha(N.sky,"66") : N.border}`,
            background: input.length > 0 ? alpha(N.sky,"0d") : N.navy900,
            color:N.text, fontSize:22, fontWeight:800,
            fontFamily:"JetBrains Mono, monospace", textTransform:"uppercase",
            letterSpacing:6, textAlign:"center",
            boxSizing:"border-box", outline:"none",
            transition:"border-color .15s, background .15s",
            cursor: state === "checking" ? "not-allowed" : "text",
          }}
        />
        <div style={{marginTop:16}} />
        <label style={{display:"block",fontSize:11,fontWeight:700,color:N.textDim,textTransform:"uppercase",letterSpacing:0.5,marginBottom:6}} htmlFor="door">
          Your name or door <span style={{fontWeight:400,textTransform:"none"}}>(shown in the scan log)</span>
        </label>
        <input id="door" value={door} onChange={e => { setDoor(e.target.value); try { localStorage.setItem("nikadi_door_name", e.target.value); } catch { /* ignore */ } }}
          placeholder="e.g. Main gate – Asha"
          style={{width:"100%",minHeight:44,padding:"10px 12px",borderRadius:10,border:`1.5px solid ${N.border}`,background:N.navy900,color:N.text,fontSize:16,boxSizing:"border-box"}} />
        {error && (
          <div style={{marginTop:12,padding:"10px 12px",borderRadius:8,background:alpha(N.red,"14"),border:`1px solid ${alpha(N.red,"44")}`,color:N.red,fontSize:13,display:"flex",gap:8,alignItems:"flex-start"}} role="alert">
            <span style={{flexShrink:0,marginTop:1}}><Icon n="alert" /></span> {error}
          </div>
        )}
        <button type="submit" disabled={state === "checking"}
          style={{width:"100%",marginTop:16,minHeight:50,borderRadius:10,border:"none",
            background: state === "checking" ? N.border : N.accent,
            color: state === "checking" ? N.textDim : "#fff",
            fontWeight:700,fontSize:15,cursor: state === "checking" ? "not-allowed" : "pointer",
            display:"flex",alignItems:"center",justifyContent:"center",gap:8,
            transition:"background .15s, color .15s"}}>
          {state === "checking" ? <><Icon n="loader" /> Checking…</> : <><Icon n="scan" /> Open scanner</>}
        </button>
      </form>
    </div></div>
  );

  const recentList = (
    <div style={{background:N.navy800,border:`1px solid ${N.border}`,borderRadius:14,padding:14,marginTop:16}}>
      <div style={{fontSize:11,fontWeight:800,color:N.textDim,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Recent scans</div>
      {!recent.length && <div style={{fontSize:13,color:N.textDim}}>No cards scanned yet.</div>}
      {recent.map((r, i) => (
        <div key={i} style={{display:"flex",gap:8,fontSize:13,padding:"5px 0",borderBottom:`1px solid ${N.border}`}}>
          <span style={{color:r.accepted ? N.green : N.red}}><Icon n={r.accepted ? "check" : "xCircle"} /></span>
          <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name || "Unknown card"}{r.accepted ? ` · ${r.people}` : ""}</span>
          <span style={{color:N.textDim,fontSize:11}}>{new Date(r.scanned_at).toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" })}</span>
        </div>
      ))}
    </div>
  );
  const dateLine = [event.event_type, event.start_datetime && new Date(event.start_datetime).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" })].filter(Boolean).join(" · ");
  const panel = (section, signal) => <ScanPanel findCard={findCard} search={search} checkIn={checkIn} scannerName={door || null} section={section} startSignal={signal} />;

  if (phone) {
    const goView = (v) => { if (v === view) return; if (v === "scan") setCamSignal(n => n + 1); setView(v); window.scrollTo?.(0, 0); };
    return (
      <div style={{...page, paddingBottom:"calc(env(safe-area-inset-bottom, 0px) + 100px)"}}><div style={box}>
        <div style={{marginBottom:12,minWidth:0}}>
          <h1 style={{fontSize:18,fontWeight:800}}>{event.name}</h1>
          <div style={{fontSize:12,color:N.textDim}}>{dateLine}</div>
        </div>
        {view === "stats" && <ScanStats stats={stats || { cards: event.cards, people: event.people, entered: event.entered }} />}
        {view === "recent" && recentList}
        {panel(view === "scan" ? "scan" : "none", camSignal)}
        <ScanTabBar view={view} onChange={goView} tabs={[
          { key: "stats", label: "Statistics", icon: "chart" }, { key: "scan", label: "Scan", icon: "scan" }, { key: "recent", label: "Recent", icon: "history" },
        ]} />
      </div></div>
    );
  }

  return (
    <div style={page}><div style={box}>
      {brand}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:12,flexWrap:"wrap",marginBottom:14}}>
        <div style={{minWidth:0}}>
          <h1 style={{fontSize:20,fontWeight:800}}>{event.name}</h1>
          <div style={{fontSize:12,color:N.textDim}}>{dateLine}</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          {[["Entered", `${event.entered} / ${event.people}`, N.green], ["Cards", event.cards, N.sky]].map(([l, v, c]) => (
            <div key={l} style={{background:N.navy800,border:`1px solid ${alpha(c,"44")}`,borderRadius:12,padding:"8px 14px",textAlign:"center"}}>
              <div style={{fontSize:18,fontWeight:800,color:c}}>{v}</div><div style={{fontSize:10,color:N.textDim,textTransform:"uppercase"}}>{l}</div>
            </div>
          ))}
        </div>
      </div>
      {panel("all", 0)}
      {recent.length > 0 && recentList}
    </div></div>
  );
}
