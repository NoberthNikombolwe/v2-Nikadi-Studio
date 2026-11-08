import { useState, useEffect, useCallback } from "react";
import { supabase } from "./lib/supabase";
import Icon from "./Icon";
import { N, alpha } from "./lib/theme";
import { CALL_STATUSES } from "./lib/calls";
import { HISTORY_CHANNELS } from "./lib/history";
import { scanStatus, cardSource } from "./lib/cardRules";
import { hideColumnRules } from "./lib/mobileTable";

// Public view-only page: #/view/<eventId>. No login — the organiser shares the link and a
// code (Calls or History tab → Share view-only link). Shows the guest list (card sent, call
// answer + comment, check-in) and the card history, read-only, through code-checked
// database functions (public_view_event / public_view_guests / public_view_history).
// Phone numbers arrive masked. Changing or turning off the code locks this page at once.

const codeKey = (id) => `nikadi_view_code_${id}`;
// Phones keep only the important columns of each table ("m-hide-N" drops the Nth)
const PHONE_CSS = `@media (max-width: 640px) { ${hideColumnRules(".pv-table")} { display: none; } }`;
const TONE = { good: N.green, info: N.sky, warn: N.amber, bad: N.red };
const fmt = (t) => t ? new Date(t).toLocaleString("en-GB", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }) : "—";

const Pill = ({ tone = "info", children }) => (
  <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:5,whiteSpace:"nowrap",color:TONE[tone],background:alpha(TONE[tone],"1a"),border:`1px solid ${alpha(TONE[tone],"44")}`}}>{children}</span>
);

export default function PublicViewPage({ eventId }) {
  const [code, setCode]     = useState(() => { try { return sessionStorage.getItem(codeKey(eventId)) || ""; } catch { return ""; } });
  const [input, setInput]   = useState("");
  const [state, setState]   = useState(code ? "checking" : "locked");   // locked | checking | open | error
  const [error, setError]   = useState(null);
  const [event, setEvent]   = useState(null);
  const [guests, setGuests] = useState([]);
  const [history, setHistory] = useState([]);
  const [view, setView]     = useState("guests");
  const [q, setQ]           = useState("");
  const [filter, setFilter] = useState("all");

  const refresh = useCallback(async (c = code) => {
    if (!supabase) { setState("error"); setError("This site is not connected to the database."); return false; }
    const { data, error: e } = await supabase.rpc("public_view_event", { p_event: eventId, p_code: c });
    if (e) { setState("error"); setError(e.message); return false; }
    if (!data?.length) {
      try { sessionStorage.removeItem(codeKey(eventId)); } catch { /* ignore */ }
      setState("locked"); setEvent(null); return false;
    }
    setEvent(data[0]); setState("open");
    const [g, h] = await Promise.all([
      supabase.rpc("public_view_guests", { p_event: eventId, p_code: c }),
      supabase.rpc("public_view_history", { p_event: eventId, p_code: c }),
    ]);
    if (!g.error) setGuests(g.data || []);
    if (!h.error) setHistory(h.data || []);
    return true;
  }, [code, eventId]);

  useEffect(() => { if (code) refresh(code); }, []); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect -- loads data from the database
  useEffect(() => {
    if (state !== "open") return;
    const t = setInterval(() => refresh(), 30000);
    return () => clearInterval(t);
  }, [state, refresh]);

  const unlock = async (e) => {
    e.preventDefault();
    const c = input.trim().toUpperCase();
    if (!c) return;
    setState("checking"); setError(null);
    if (await refresh(c)) { setCode(c); try { sessionStorage.setItem(codeKey(eventId), c); } catch { /* private mode */ } }
    else setError("That code isn't right, or it was changed. Ask the organiser for the current code.");
  };

  const page = { minHeight: "100vh", background: N.navy900, color: N.text, fontFamily: "'Plus Jakarta Sans', sans-serif",
                 padding: "calc(env(safe-area-inset-top, 0px) + 16px) 16px calc(env(safe-area-inset-bottom, 0px) + 24px)" };
  const box = { maxWidth: 1200, margin: "0 auto" };
  const card = { background: N.navy800, border: `1px solid ${N.border}`, borderRadius: 14 };
  const brand = (
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="36" height="36" style={{borderRadius:10}} />
      <div><div style={{fontWeight:800}}>Nikadi Studio</div><div style={{fontSize:11,color:N.textDim}}>Event report · view only</div></div>
    </div>
  );

  if (state !== "open") return (
    <div style={page}><div style={{...box, maxWidth:420}}>
      {brand}
      <form onSubmit={unlock} style={{...card, borderRadius:16, padding:22}}>
        <div style={{width:52,height:52,borderRadius:"50%",display:"grid",placeItems:"center",fontSize:24,color:N.sky,background:alpha(N.sky,"1a"),marginBottom:12}}><Icon n="lock" /></div>
        <h1 style={{fontSize:18,fontWeight:800,marginBottom:6}}>Enter the access code</h1>
        <p style={{fontSize:13,color:N.textDim,marginBottom:14}}>The event organiser shared a code with this link.</p>
        <input autoFocus value={input} onChange={e => setInput(e.target.value)} placeholder="e.g. K7Q2MX" aria-label="Access code"
          style={{width:"100%",minHeight:48,padding:"10px 14px",borderRadius:10,border:`1.5px solid ${N.border}`,background:N.navy900,color:N.text,fontSize:20,letterSpacing:4,textTransform:"uppercase",fontFamily:"JetBrains Mono, monospace"}} />
        {error && <div style={{color:N.red,fontSize:13,marginTop:12}} role="alert"><Icon n="alert" /> {error}</div>}
        <button type="submit" disabled={state === "checking"} style={{width:"100%",marginTop:16,minHeight:48,borderRadius:10,border:"none",background:N.accent,color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer"}}>
          {state === "checking" ? <><Icon n="loader" /> Checking…</> : "Open report"}
        </button>
      </form>
    </div></div>
  );

  // Guest stats
  const sent = guests.filter(g => cardSource(g) === "sent").length;
  const calls = (k) => guests.filter(g => g.call_status === k).length;
  const people = guests.reduce((n, g) => n + (Number(g.max_scans) || 1), 0);
  const entered = guests.reduce((n, g) => n + (Number(g.scan_count) || 0), 0);
  const stats = [
    ["Guests", guests.length, "info"], ["Cards sent", `${sent} / ${guests.length}`, "good"],
    ["Coming", calls("yes"), "good"], ["Not coming", calls("no"), "bad"],
    ["Not called", guests.filter(g => !g.call_status).length, "warn"], ["Entered", `${entered} / ${people}`, "good"],
  ];
  const t = q.trim().toLowerCase();
  const shownGuests = guests.filter(g => {
    if (filter === "sent" && cardSource(g) !== "sent") return false;
    if (filter === "notsent" && cardSource(g) === "sent") return false;
    if (filter === "todo" && g.call_status) return false;
    if (["yes", "no", "busy", "picked"].includes(filter) && g.call_status !== filter) return false;
    if (filter === "entered" && !(g.scan_count > 0)) return false;
    return !t || [g.name, g.card_type, g.call_comment].some(v => String(v || "").toLowerCase().includes(t));
  });
  const shownHistory = history.filter(h => !t || [h.recipient_name, h.message_title, h.detail, h.status].some(v => String(v || "").toLowerCase().includes(t)));
  const seg = (on) => ({ padding:"6px 12px", borderRadius:8, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
    border:`1px solid ${on ? N.sky : N.border}`, background: on ? alpha(N.sky, "1a") : "transparent", color: on ? N.sky : N.textMid });
  const th = { textAlign:"left", padding:"10px 12px", fontSize:11, textTransform:"uppercase", letterSpacing:.5, color:N.textDim, borderBottom:`1px solid ${N.border}`, whiteSpace:"nowrap" };
  const td = { padding:"9px 12px", borderBottom:`1px solid ${N.border}`, fontSize:13, whiteSpace:"nowrap", maxWidth:280, overflow:"hidden", textOverflow:"ellipsis" };
  // WhatsApp / SMS status in words: sent = waiting for the delivery report, then delivered /
  // read, or failed / not on WhatsApp
  const SENT_LABEL = { sent: ["Sent (waiting)", "info"], delivered: ["Delivered", "good"], read: ["Read", "good"], failed: ["Failed", "bad"],
    invalid: ["Not on WhatsApp", "warn"], notSent: ["Not sent", "bad"], not_sent: ["Not sent", "bad"], sending: ["Sending", "info"] };
  const sentPill = (s) => {
    if (!s || /^(idle|pending)$/i.test(s)) return <span style={{color:N.textDim}}>—</span>;
    const [label, tone] = SENT_LABEL[s] || [s.replace(/_/g, " "), "info"];
    return <Pill tone={tone}>{label}</Pill>;
  };

  return (
    <div style={page}><div style={box}>
      <style>{PHONE_CSS}</style>
      {brand}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:12,flexWrap:"wrap",marginBottom:14}}>
        <div style={{minWidth:0}}>
          <h1 style={{fontSize:20,fontWeight:800}}>{event.name}</h1>
          <div style={{fontSize:12,color:N.textDim}}>{[event.event_type, event.venue_name, event.start_datetime && new Date(event.start_datetime).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" })].filter(Boolean).join(" · ")}</div>
        </div>
        <button onClick={() => refresh()} style={seg(false)}><Icon n="refresh" /> Refresh</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:10,marginBottom:16}}>
        {stats.map(([l, v, tn]) => (
          <div key={l} style={{...card, padding:"12px 14px", borderColor:alpha(TONE[tn], "33")}}>
            <div style={{fontSize:20,fontWeight:800,color:TONE[tn]}}>{v}</div>
            <div style={{fontSize:10,color:N.textDim,textTransform:"uppercase",letterSpacing:.5}}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:10}}>
        <div role="tablist" style={{display:"flex",gap:6}}>
          <button role="tab" aria-selected={view === "guests"} style={seg(view === "guests")} onClick={() => setView("guests")}><Icon n="users" /> Guests ({guests.length})</button>
          <button role="tab" aria-selected={view === "history"} style={seg(view === "history")} onClick={() => setView("history")}><Icon n="history" /> Card history ({history.length})</button>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={view === "guests" ? "Search name, card type or comment" : "Search history"} aria-label="Search"
          style={{flex:"1 1 220px",maxWidth:340,marginLeft:"auto",minHeight:36,padding:"6px 12px",borderRadius:8,border:`1px solid ${N.border}`,background:N.navy800,color:N.text,fontSize:14}} />
      </div>
      {view === "guests" && (
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
          {[["all","All"],["sent","Card sent"],["notsent","Not sent"],["todo","Not called"],["yes","Coming"],["no","Not coming"],["busy","Busy"],["entered","Entered"]].map(([k, l]) =>
            <button key={k} style={seg(filter === k)} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
      )}
      <div style={{...card, overflowX:"auto"}}>
        {view === "guests" ? (
          <table className="pv-table m-hide-2 m-hide-3 m-hide-5 m-hide-7" style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["Guest","Card type","Phone","WhatsApp","SMS","Call answer","Comment","Entered"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {shownGuests.map(g => {
                const cs = CALL_STATUSES[g.call_status];
                const st = scanStatus(g.scan_count, g.max_scans);
                return (
                  <tr key={g.id}>
                    <td style={{...td, fontWeight:700}}>{g.name || "—"}</td>
                    <td style={td}>{g.card_type || "—"}</td>
                    <td style={{...td, color:N.textDim, fontFamily:"JetBrains Mono, monospace", fontSize:12}}>{g.phone || "—"}</td>
                    <td style={td}>{sentPill(g.wa_status)}</td>
                    <td style={td}>{sentPill(g.sms_status)}</td>
                    <td style={td}>{cs ? <Pill tone={cs.tone}>{cs.label}</Pill> : <span style={{color:N.textDim}}>Not called</span>}</td>
                    <td style={{...td, color:g.call_comment ? N.textMid : N.textDim}} title={g.call_comment || ""}>{g.call_comment || "—"}</td>
                    <td style={{...td, color: st === "complete" ? N.green : st === "partial" ? N.sky : N.textDim}}>{g.scan_count || 0} / {g.max_scans || 1}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="pv-table m-hide-4 m-hide-6 m-hide-7" style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["When","Channel","Guest","Phone","Result","Message","Detail"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {shownHistory.map((h, i) => (
                <tr key={i}>
                  <td style={{...td, color:N.textDim, fontSize:12}}>{fmt(h.created_at)}</td>
                  <td style={td}><Icon n={HISTORY_CHANNELS[h.channel]?.icon || "history"} /> {HISTORY_CHANNELS[h.channel]?.label || h.channel}</td>
                  <td style={{...td, fontWeight:600}}>{h.recipient_name || "—"}</td>
                  <td style={{...td, color:N.textDim, fontFamily:"JetBrains Mono, monospace", fontSize:12}}>{h.recipient_phone || "—"}</td>
                  <td style={td}><Pill tone={/fail|invalid|not_sent|no/i.test(h.status || "") ? "bad" : /sent|delivered|ok|yes/i.test(h.status || "") ? "good" : "info"}>{(h.status || "ok").replace(/_/g, " ")}</Pill></td>
                  <td style={td}>{h.message_title || "—"}</td>
                  <td style={{...td, color:N.textMid}} title={h.detail || ""}>{h.detail || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {(view === "guests" ? !shownGuests.length : !shownHistory.length) && (
          <div style={{padding:28,textAlign:"center",color:N.textDim,fontSize:13}}><Icon n="search" /> Nothing to show{t || filter !== "all" ? " for this search / filter" : " yet"}.</div>
        )}
      </div>
      <div style={{fontSize:11,color:N.textDim,marginTop:12,textAlign:"center"}}>View only · phone numbers are partly hidden · updates every 30 seconds</div>
    </div></div>
  );
}
