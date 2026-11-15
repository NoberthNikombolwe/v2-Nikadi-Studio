import { useState, useEffect, useRef } from "react";
import { supabase } from "./lib/supabase";

// Public event microsite: #/g/<eventPublicId>/<guestPublicId>
// No login required. Data via public_event_page_data() SECURITY DEFINER RPC.

const fmtDate = (t) =>
  t ? new Date(t).toLocaleDateString("en-GB", { weekday:"long", day:"numeric", month:"long", year:"numeric" }) : null;

const fmtTime = (t) => {
  if (!t) return null;
  const d = new Date(t);
  return d.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });
};

function Countdown({ target }) {
  const [left, setLeft] = useState(null);
  useEffect(() => {
    const calc = () => {
      const diff = new Date(target) - Date.now();
      if (diff <= 0) { setLeft({ done: true }); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000)  / 60000);
      const s = Math.floor((diff % 60000)    / 1000);
      setLeft({ d, h, m, s });
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!left) return null;
  if (left.done) return <div style={{ fontSize:14, opacity:0.7 }}>Sherehe imeanza!</div>;
  const Box = ({ n, label }) => (
    <div style={{ textAlign:"center", minWidth:60 }}>
      <div style={{ fontSize:38, fontWeight:900, lineHeight:1, fontVariantNumeric:"tabular-nums" }}>{String(n).padStart(2,"0")}</div>
      <div style={{ fontSize:11, opacity:0.7, letterSpacing:1, textTransform:"uppercase" }}>{label}</div>
    </div>
  );
  return (
    <div style={{ display:"flex", gap:16, justifyContent:"center", flexWrap:"wrap" }}>
      <Box n={left.d} label="Days" />
      <Box n={left.h} label="Hours" />
      <Box n={left.m} label="Mins" />
      <Box n={left.s} label="Secs" />
    </div>
  );
}

function LeafletMap({ lat, lng, venueName, venueAddress }) {
  const mapRef = useRef(null);
  const instanceRef = useRef(null);
  const [satellite, setSatellite] = useState(false);
  const layerRef = useRef(null);

  useEffect(() => {
    let destroyed = false;
    const load = async () => {
      if (!mapRef.current || instanceRef.current) return;
      // Load Leaflet CSS
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }
      // Load Leaflet JS
      if (!window.L) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }
      if (destroyed || !mapRef.current) return;
      const L = window.L;
      const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: false }).setView([lat, lng], 15);
      const street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors", maxZoom: 19,
      });
      const satelliteLayer = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Tiles &copy; Esri", maxZoom: 19 }
      );
      street.addTo(map);
      layerRef.current = { street, satelliteLayer, active: "street" };
      L.marker([lat, lng]).addTo(map).bindPopup(venueName || "Venue").openPopup();
      instanceRef.current = map;
    };
    load().catch(() => {});
    return () => { destroyed = true; if (instanceRef.current) { instanceRef.current.remove(); instanceRef.current = null; } };
  }, [lat, lng, venueName]);

  useEffect(() => {
    if (!instanceRef.current || !layerRef.current) return;
    const L = window.L;
    if (!L) return;
    const { street, satelliteLayer } = layerRef.current;
    if (satellite) { instanceRef.current.removeLayer(street); satelliteLayer.addTo(instanceRef.current); }
    else { instanceRef.current.removeLayer(satelliteLayer); street.addTo(instanceRef.current); }
  }, [satellite]);

  const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

  return (
    <div>
      <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap" }}>
        <button onClick={() => setSatellite(false)}
          style={{ padding:"6px 14px", borderRadius:8, border:"1px solid rgba(255,255,255,0.2)", fontSize:12,
            background: !satellite ? "rgba(255,255,255,0.15)" : "transparent", color:"inherit", cursor:"pointer", fontFamily:"inherit" }}>
          Street
        </button>
        <button onClick={() => setSatellite(true)}
          style={{ padding:"6px 14px", borderRadius:8, border:"1px solid rgba(255,255,255,0.2)", fontSize:12,
            background: satellite ? "rgba(255,255,255,0.15)" : "transparent", color:"inherit", cursor:"pointer", fontFamily:"inherit" }}>
          Satellite
        </button>
        <a href={googleUrl} target="_blank" rel="noreferrer"
          style={{ padding:"6px 14px", borderRadius:8, border:"1px solid rgba(255,255,255,0.2)", fontSize:12,
            background:"transparent", color:"inherit", cursor:"pointer", fontFamily:"inherit", textDecoration:"none",
            display:"inline-flex", alignItems:"center", gap:6 }}>
          Get Directions
        </a>
      </div>
      <div ref={mapRef} style={{ height:300, borderRadius:12, overflow:"hidden", border:"1px solid rgba(255,255,255,0.1)" }} />
      {venueAddress && <div style={{ marginTop:8, fontSize:12, opacity:0.7 }}>{venueAddress}</div>}
    </div>
  );
}

export default function PublicGuestPage({ eventPublicId, guestPublicId }) {
  const [state,  setState]  = useState("loading");
  const [data,   setData]   = useState(null);
  const [error,  setError]  = useState(null);
  const [rsvpState, setRsvpState] = useState("idle"); // idle | attending | not-attending | submitted | error
  const [rsvpMsg,   setRsvpMsg]   = useState("");
  const [dlBusy,    setDlBusy]    = useState(false);

  useEffect(() => {
    if (!supabase) { setState("error"); setError("Not connected to the database."); return; } // eslint-disable-line react-hooks/set-state-in-effect -- loads data from the database
    supabase.rpc("public_event_page_data", {
      p_event_public_id: eventPublicId,
      p_guest_public_id: guestPublicId,
    }).then(({ data: row, error: e }) => {
      if (e) { setState("error"); setError(e.message); return; }
      if (!row) { setState("notfound"); return; }
      setData(row); setState("found");
    });
  }, [eventPublicId, guestPublicId]);

  // Set OG meta tags for social sharing thumbnails
  useEffect(() => {
    if (!data) return;
    const ps = data.page_settings || {};
    const title = `${data.guest_name || "You"} — ${data.event_name || "Event"}`;
    const desc  = `${data.event_type || "Invitation"} · ${fmtDate(data.start_datetime) || ""} · ${data.venue_name || ""}`.replace(/ · $/, "");
    const img   = data.card_url || ps.hero_image_url || "";
    const setMeta = (prop, content, attr = "property") => {
      let el = document.querySelector(`meta[${attr}="${prop}"]`);
      if (!el) { el = document.createElement("meta"); el.setAttribute(attr, prop); document.head.appendChild(el); }
      el.content = content;
    };
    document.title = title;
    setMeta("og:title",       title);
    setMeta("og:description", desc);
    if (img) setMeta("og:image", img);
    setMeta("og:type",        "website");
    setMeta("twitter:card",   "summary_large_image", "name");
    setMeta("twitter:title",  title,                 "name");
    if (img) setMeta("twitter:image", img, "name");
  }, [data]);

  const downloadCard = async () => {
    if (!data?.card_url) return;
    setDlBusy(true);
    try {
      const resp = await fetch(data.card_url);
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `invitation-${data.guest_name || "card"}.${blob.type.split("/")[1] || "jpg"}`.replace(/\s+/g,"_");
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { /* download failed silently */ }
    setDlBusy(false);
  };

  const submitRsvp = async (attending) => {
    if (rsvpState === "submitted") return;
    setRsvpState(attending ? "attending" : "not-attending");
    if (!supabase) { setRsvpState("error"); return; }
    const { data: res } = await supabase.rpc("submit_rsvp", {
      p_event_public_id: eventPublicId,
      p_guest_public_id: guestPublicId,
      p_attending:       attending,
      p_message:         rsvpMsg || null,
    });
    if (res?.ok) setRsvpState("submitted");
    else setRsvpState("error");
  };

  // Loading / error / not-found states use a minimal shell
  const minPage = { minHeight:"100vh", background:"#0A0F1E", color:"#fff", fontFamily:"'Plus Jakarta Sans', sans-serif",
    display:"flex", flexDirection:"column", alignItems:"center", padding:"40px 16px" };
  const Brand = () => (
    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:32 }}>
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="32" height="32" style={{ borderRadius:8 }} />
      <div style={{ fontWeight:800, fontSize:14 }}>Nikadi Studio</div>
    </div>
  );

  if (state === "loading") return (
    <div style={minPage}>
      <Brand />
      <div style={{ color:"rgba(255,255,255,0.5)", fontSize:14 }}>Loading your invitation…</div>
    </div>
  );
  if (state === "error") return (
    <div style={minPage}>
      <Brand />
      <div style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,0,0,0.3)", borderRadius:16, padding:28, maxWidth:420, textAlign:"center" }}>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.6)" }}>{error}</div>
      </div>
    </div>
  );
  if (state === "notfound") return (
    <div style={minPage}>
      <Brand />
      <div style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:16, padding:36, maxWidth:420, textAlign:"center" }}>
        <div style={{ fontWeight:800, fontSize:17, marginBottom:8 }}>Link not found</div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", lineHeight:1.6 }}>
          This invitation link is not valid, or the organiser has removed it.
          Please ask the organiser to resend your link.
        </div>
      </div>
    </div>
  );

  const ps  = data.page_settings || {};
  const bg  = ps.bg_color       || "#0A0F1E";
  const fg  = ps.text_color     || "#FFFFFF";
  const pri = ps.primary_color  || "#00C2FF";
  const acc = ps.accent_color   || "#7C3AED";

  const hosts    = Array.isArray(ps.hosts)    ? ps.hosts    : [];
  const schedule = Array.isArray(ps.schedule) ? ps.schedule : [];
  const gallery  = Array.isArray(ps.gallery)  ? ps.gallery  : [];

  const hasLocation = ps.venue_lat && ps.venue_lng;

  const Section = ({ title, children, accent: sAcc }) => (
    <section style={{ marginBottom:48 }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
        <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.1)" }} />
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase", color: sAcc || pri }}>
          {title}
        </div>
        <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.1)" }} />
      </div>
      {children}
    </section>
  );

  return (
    <div style={{ minHeight:"100vh", background:bg, color:fg, fontFamily:"'Plus Jakarta Sans', sans-serif" }}>

      {/* ── Hero ── */}
      <div style={{ position:"relative", minHeight:"100svh", display:"flex", flexDirection:"column",
        justifyContent:"flex-end", overflow:"hidden" }}>
        {ps.hero_image_url ? (
          <img src={ps.hero_image_url} alt="" style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover" }} />
        ) : (
          <div style={{ position:"absolute", inset:0, background:`linear-gradient(135deg, ${bg} 0%, ${acc} 100%)` }} />
        )}
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0.1) 100%)" }} />
        <div style={{ position:"relative", padding:"40px 24px calc(env(safe-area-inset-bottom, 0px) + 48px)", maxWidth:680, margin:"0 auto", width:"100%" }}>
          {data.event_type && (
            <div style={{ display:"inline-block", background:"rgba(255,255,255,0.15)", backdropFilter:"blur(8px)",
              border:"1px solid rgba(255,255,255,0.25)", borderRadius:8, padding:"4px 14px", fontSize:11,
              fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", marginBottom:16 }}>
              {data.event_type}
            </div>
          )}
          <h1 style={{ fontSize:"clamp(28px, 7vw, 52px)", fontWeight:900, lineHeight:1.1, marginBottom:12 }}>
            {data.event_name}
          </h1>
          {ps.tagline && <p style={{ fontSize:16, opacity:0.8, marginBottom:20, lineHeight:1.5 }}>{ps.tagline}</p>}
          <div style={{ fontSize:14, opacity:0.75, marginBottom:ps.show_countdown !== false && data.start_datetime ? 32 : 0 }}>
            {fmtDate(data.start_datetime)}{fmtTime(data.start_datetime) ? ` · ${fmtTime(data.start_datetime)}` : ""}
            {data.venue_name ? ` · ${data.venue_name}` : ""}
          </div>
          {ps.show_countdown !== false && data.start_datetime && (
            <Countdown target={data.start_datetime} />
          )}
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{ maxWidth:720, margin:"0 auto", padding:"48px 20px" }}>

        {/* Guest card */}
        {data.guest_name && (
          <section style={{ marginBottom:48 }}>
            <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)",
              borderRadius:20, overflow:"hidden", boxShadow:`0 8px 40px rgba(0,0,0,0.4)` }}>
              <div style={{ padding:"22px 24px", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ fontSize:11, opacity:0.5, textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>Mwaliko kwa</div>
                <div style={{ fontSize:26, fontWeight:900 }}>{data.guest_name}</div>
                <div style={{ display:"flex", gap:8, marginTop:8, flexWrap:"wrap" }}>
                  {data.card_type && (
                    <span style={{ display:"inline-flex", alignItems:"center", gap:6, background:"rgba(255,255,255,0.1)",
                      border:"1px solid rgba(255,255,255,0.15)", borderRadius:6, padding:"3px 10px", fontSize:12, fontWeight:700 }}>
                      {data.card_type}
                    </span>
                  )}
                  {data.card_code && (
                    <span style={{ display:"inline-flex", alignItems:"center", fontFamily:"'JetBrains Mono', monospace",
                      background:`${pri}22`, border:`1px solid ${pri}55`, borderRadius:6, padding:"3px 10px",
                      fontSize:13, fontWeight:700, letterSpacing:2, color:pri }}>
                      {data.card_code}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ padding:24 }}>
                {data.card_url ? (
                  <>
                    <div style={{ borderRadius:12, overflow:"hidden", marginBottom:16 }}>
                      <img src={data.card_url} alt={`Invitation card for ${data.guest_name}`}
                        style={{ width:"100%", display:"block", borderRadius:12 }}
                        onError={e => { e.currentTarget.style.display="none"; }} />
                    </div>
                    <button onClick={downloadCard} disabled={dlBusy}
                      style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 20px", borderRadius:10, border:`1px solid ${pri}`,
                        background:"transparent", color:pri, cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700, opacity:dlBusy?0.6:1 }}>
                      {dlBusy ? "Downloading…" : "Download Card"}
                    </button>
                  </>
                ) : (
                  <div style={{ textAlign:"center", padding:"32px 0", opacity:0.5, fontSize:13 }}>
                    Card being prepared by the organiser
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Schedule / Ratiba */}
        {schedule.length > 0 && (
          <Section title="Ratiba ya Siku">
            <div style={{ position:"relative" }}>
              <div style={{ position:"absolute", left:16, top:0, bottom:0, width:2, background:`${pri}44` }} />
              {schedule.map((item, i) => (
                <div key={i} style={{ display:"flex", gap:16, marginBottom:24, position:"relative" }}>
                  <div style={{ width:34, height:34, borderRadius:"50%", background:acc, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, zIndex:1 }}>
                    {String(i + 1).padStart(2,"0")}
                  </div>
                  <div style={{ flex:1, paddingTop:6 }}>
                    <div style={{ display:"flex", gap:12, alignItems:"baseline", flexWrap:"wrap" }}>
                      {item.time && <span style={{ fontSize:12, fontWeight:700, color:pri, fontVariantNumeric:"tabular-nums" }}>{item.time}</span>}
                      <span style={{ fontSize:15, fontWeight:700 }}>{item.title}</span>
                    </div>
                    {item.description && <div style={{ fontSize:13, opacity:0.65, marginTop:4, lineHeight:1.5 }}>{item.description}</div>}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Dress code */}
        {(ps.dress_code_text || ps.dress_code_image_url) && (
          <Section title="Dress Code">
            <div style={{ display:"grid", gridTemplateColumns: ps.dress_code_image_url ? "1fr 1fr" : "1fr", gap:20, alignItems:"start" }}>
              {ps.dress_code_text && (
                <div style={{ fontSize:14, lineHeight:1.7, opacity:0.85, whiteSpace:"pre-wrap" }}>{ps.dress_code_text}</div>
              )}
              {ps.dress_code_image_url && (
                <img src={ps.dress_code_image_url} alt="Dress code" style={{ width:"100%", borderRadius:12 }} />
              )}
            </div>
          </Section>
        )}

        {/* Gallery */}
        {gallery.filter(Boolean).length > 0 && (
          <Section title="Picha za Mahusiano">
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))", gap:10 }}>
              {gallery.filter(Boolean).map((url, i) => (
                <img key={i} src={url} alt="" style={{ width:"100%", aspectRatio:"1", objectFit:"cover", borderRadius:10 }} />
              ))}
            </div>
          </Section>
        )}

        {/* Hosts */}
        {hosts.filter(h => h.name).length > 0 && (
          <Section title="Wahusika Wakuu">
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))", gap:16 }}>
              {hosts.filter(h => h.name).map((h, i) => (
                <div key={i} style={{ textAlign:"center" }}>
                  {h.photo_url ? (
                    <img src={h.photo_url} alt={h.name} style={{ width:80, height:80, borderRadius:"50%", objectFit:"cover", margin:"0 auto 10px", display:"block", border:`2px solid ${acc}` }} />
                  ) : (
                    <div style={{ width:80, height:80, borderRadius:"50%", background:`${acc}44`, margin:"0 auto 10px", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28 }}>
                      {h.name.charAt(0)}
                    </div>
                  )}
                  <div style={{ fontWeight:700, fontSize:14 }}>{h.name}</div>
                  {h.role && <div style={{ fontSize:12, opacity:0.6, marginTop:2 }}>{h.role}</div>}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* RSVP */}
        {ps.rsvp_enabled && (
          <Section title="RSVP — Pongezi na Uthibitisho" accent={acc}>
            {rsvpState === "submitted" ? (
              <div style={{ textAlign:"center", padding:32, background:`${acc}22`, border:`1px solid ${acc}44`, borderRadius:16 }}>
                <div style={{ fontSize:24, marginBottom:8 }}>Asante!</div>
                <div style={{ fontSize:14, opacity:0.75, lineHeight:1.6 }}>Jibu lako limepokelewa. Tunakushukuru kwa pongezi zako.</div>
              </div>
            ) : (
              <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:16, padding:24 }}>
                {ps.rsvp_message && <p style={{ fontSize:14, opacity:0.8, lineHeight:1.6, marginBottom:20 }}>{ps.rsvp_message}</p>}
                <textarea value={rsvpMsg} onChange={e => setRsvpMsg(e.target.value)}
                  placeholder="Andika ujumbe wako wa pongezi (si lazima)…"
                  style={{ width:"100%", minHeight:90, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.15)",
                    borderRadius:10, padding:"12px 14px", color:fg, fontFamily:"inherit", fontSize:13, resize:"vertical",
                    marginBottom:16, boxSizing:"border-box" }} />
                {rsvpState === "error" && <div style={{ color:"#ff6b6b", fontSize:13, marginBottom:12 }}>Kuna tatizo. Jaribu tena.</div>}
                <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                  <button onClick={() => submitRsvp(true)}
                    disabled={rsvpState==="attending"||rsvpState==="not-attending"}
                    style={{ flex:1, padding:"12px 20px", borderRadius:10, border:`2px solid ${pri}`, background:`${pri}22`,
                      color:pri, cursor:"pointer", fontFamily:"inherit", fontSize:14, fontWeight:700, minWidth:120 }}>
                    Nitafika
                  </button>
                  <button onClick={() => submitRsvp(false)}
                    disabled={rsvpState==="attending"||rsvpState==="not-attending"}
                    style={{ flex:1, padding:"12px 20px", borderRadius:10, border:"2px solid rgba(255,255,255,0.2)",
                      background:"transparent", color:fg, cursor:"pointer", fontFamily:"inherit", fontSize:14, fontWeight:700, minWidth:120, opacity:0.75 }}>
                    Sitafika
                  </button>
                </div>
              </div>
            )}
          </Section>
        )}

        {/* Location */}
        {hasLocation && (
          <Section title="Mahali pa Sherehe">
            {ps.venue_description && <p style={{ fontSize:14, opacity:0.8, lineHeight:1.6, marginBottom:16 }}>{ps.venue_description}</p>}
            <LeafletMap lat={ps.venue_lat} lng={ps.venue_lng} venueName={data.venue_name} venueAddress={data.venue_address} />
          </Section>
        )}

      </div>

      {/* Footer */}
      <div style={{ textAlign:"center", padding:"24px 16px", borderTop:"1px solid rgba(255,255,255,0.06)", fontSize:11, opacity:0.4 }}>
        Powered by Nikadi Studio
      </div>
    </div>
  );
}
