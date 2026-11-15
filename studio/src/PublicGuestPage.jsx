import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase";
import Icon from "./Icon";
import { N, alpha } from "./lib/theme";

// Public guest invitation page: #/g/<eventPublicId>/<guestPublicId>
// No login required. Shows the guest's personalised event invitation card.
// Data comes from the public_guest_card() SECURITY DEFINER RPC — only the
// event name/type/date/venue and the guest's name, card type and card image
// are returned; no phone numbers or private fields are exposed.

const fmt = (t) =>
  t ? new Date(t).toLocaleDateString("en-GB", { weekday:"long", day:"numeric", month:"long", year:"numeric" }) : null;

export default function PublicGuestPage({ eventPublicId, guestPublicId }) {
  const [state, setState] = useState("loading");   // loading | found | notfound | error
  const [data,  setData]  = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!supabase) { setState("error"); setError("This site is not connected to the database."); return; } // eslint-disable-line react-hooks/set-state-in-effect -- loads data from the database
    supabase.rpc("public_guest_card", {
      p_event_public_id: eventPublicId,
      p_guest_public_id: guestPublicId,
    }).then(({ data: rows, error: e }) => {
      if (e) { setState("error"); setError(e.message); return; }
      if (!rows?.length) { setState("notfound"); return; }
      setData(rows[0]); setState("found");
    });
  }, [eventPublicId, guestPublicId]);

  const page = {
    minHeight: "100vh",
    background: N.navy900,
    color: N.text,
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "calc(env(safe-area-inset-top, 0px) + 24px) 16px calc(env(safe-area-inset-bottom, 0px) + 40px)",
  };

  const brand = (
    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:28 }}>
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="36" height="36"
        style={{ borderRadius:10 }} />
      <div>
        <div style={{ fontWeight:800, fontSize:15 }}>Nikadi Studio</div>
        <div style={{ fontSize:10, color:N.textDim }}>Personalised invitation</div>
      </div>
    </div>
  );

  if (state === "loading") return (
    <div style={page}>
      {brand}
      <div style={{ color:N.textDim, fontSize:14, display:"flex", alignItems:"center", gap:8 }}>
        <Icon n="loader" /> Loading your invitation…
      </div>
    </div>
  );

  if (state === "error") return (
    <div style={page}>
      {brand}
      <div style={{ background:N.navy800, border:`1px solid ${alpha(N.red,"44")}`, borderRadius:16, padding:28, maxWidth:420, width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:28, color:N.red, marginBottom:12 }}><Icon n="alert" /></div>
        <div style={{ fontWeight:800, marginBottom:6 }}>Something went wrong</div>
        <div style={{ fontSize:13, color:N.textDim }}>{error}</div>
      </div>
    </div>
  );

  if (state === "notfound") return (
    <div style={page}>
      {brand}
      <div style={{ background:N.navy800, border:`1px solid ${N.border}`, borderRadius:16, padding:36, maxWidth:420, width:"100%", textAlign:"center" }}>
        <div style={{ width:56, height:56, borderRadius:"50%", background:alpha(N.amber,"1a"), display:"grid", placeItems:"center", fontSize:26, color:N.amber, margin:"0 auto 16px" }}>
          <Icon n="link" />
        </div>
        <div style={{ fontWeight:800, fontSize:17, marginBottom:8 }}>Link not found</div>
        <div style={{ fontSize:13, color:N.textDim, lineHeight:1.6 }}>
          This invitation link is not valid, or the event organiser has removed it.
          Please ask the organiser to resend your link.
        </div>
      </div>
    </div>
  );

  const { event_name, event_type, start_datetime, venue_name, guest_name, card_type, card_url } = data;
  const dateStr  = fmt(start_datetime);

  return (
    <div style={page}>
      {brand}
      <div style={{ maxWidth:520, width:"100%" }}>
        {/* Event header */}
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <div style={{ display:"inline-block", background:alpha(N.accent,"1a"), border:`1px solid ${alpha(N.accent,"33")}`,
            borderRadius:8, padding:"4px 14px", fontSize:11, fontWeight:700, color:N.accent, letterSpacing:.5,
            textTransform:"uppercase", marginBottom:12 }}>
            {event_type || "Event"}
          </div>
          <h1 style={{ fontSize:24, fontWeight:800, lineHeight:1.2, marginBottom:8 }}>{event_name}</h1>
          {(dateStr || venue_name) && (
            <div style={{ fontSize:13, color:N.textDim }}>
              {[dateStr, venue_name].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>

        {/* Guest card */}
        <div style={{ background:N.navy800, border:`1px solid ${N.border}`, borderRadius:20, overflow:"hidden",
          boxShadow:`0 8px 40px ${alpha(N.accent,"18")}` }}>

          {/* Guest name banner */}
          <div style={{ padding:"20px 24px", borderBottom:`1px solid ${N.border}` }}>
            <div style={{ fontSize:11, color:N.textDim, textTransform:"uppercase", letterSpacing:.8, marginBottom:4 }}>
              Invitation for
            </div>
            <div style={{ fontSize:22, fontWeight:800, color:N.text }}>{guest_name || "Guest"}</div>
            {card_type && (
              <div style={{ marginTop:6, display:"inline-flex", alignItems:"center", gap:6,
                background:alpha(N.sky,"12"), border:`1px solid ${alpha(N.sky,"33")}`,
                borderRadius:6, padding:"3px 10px", fontSize:12, fontWeight:700, color:N.sky }}>
                <Icon n="users" size="0.9em" /> {card_type}
              </div>
            )}
          </div>

          {/* Card image area */}
          <div style={{ padding:24 }}>
            {card_url ? (
              <div style={{ borderRadius:12, overflow:"hidden", boxShadow:`0 4px 20px ${alpha(N.accent,"22")}` }}>
                <img
                  src={card_url}
                  alt={`Invitation card for ${guest_name}`}
                  style={{ width:"100%", display:"block", borderRadius:12 }}
                  onError={e => { e.currentTarget.style.display = "none"; e.currentTarget.nextSibling.style.display = "flex"; }}
                />
                <div style={{ display:"none", flexDirection:"column", alignItems:"center", justifyContent:"center",
                  padding:36, background:N.navy700, borderRadius:12, gap:10, color:N.textDim, fontSize:13 }}>
                  <Icon n="image" size="2em" />
                  <span>Card image could not load</span>
                </div>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                padding:40, background:N.navy700, borderRadius:12, gap:12, textAlign:"center" }}>
                <div style={{ width:52, height:52, borderRadius:"50%", background:alpha(N.sky,"1a"),
                  display:"grid", placeItems:"center", fontSize:24, color:N.sky }}>
                  <Icon n="image" />
                </div>
                <div>
                  <div style={{ fontWeight:700, marginBottom:4 }}>Card being prepared</div>
                  <div style={{ fontSize:12, color:N.textDim, lineHeight:1.5 }}>
                    Your personalised invitation card will appear here once the organiser uploads it.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop:16, textAlign:"center", fontSize:11, color:N.textDim }}>
          Powered by Nikadi Studio · nikadi.com
        </div>
      </div>
    </div>
  );
}
