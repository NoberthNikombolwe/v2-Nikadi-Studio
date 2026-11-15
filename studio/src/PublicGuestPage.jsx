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

const fmtDay = (t) => t ? new Date(t).getDate() : null;
const fmtMonth = (t) => t ? new Date(t).toLocaleDateString("en-GB", { month:"short" }).toUpperCase() : null;
const fmtWeekdayDate = (t) =>
  t ? new Date(t).toLocaleDateString("en-GB", { weekday:"long", day:"numeric", month:"long", year:"numeric" }) : null;

// Generates a QR code image from `text` using qrcodejs loaded from CDN.
// Renders into a hidden div, then copies the canvas/img src to display cleanly.
function QRCodeDisplay({ text, size = 160 }) {
  const containerRef = useRef(null);
  const [src, setSrc] = useState(null);

  useEffect(() => {
    if (!text || !containerRef.current) return;
    containerRef.current.innerHTML = "";
    const load = async () => {
      if (!window.QRCode) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://unpkg.com/qrcodejs@1.0.0/qrcode.min.js";
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      if (!containerRef.current) return;
      containerRef.current.innerHTML = "";
      new window.QRCode(containerRef.current, {
        text,
        width: size * 2,   // render 2× for sharpness on retina
        height: size * 2,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: window.QRCode.CorrectLevel?.H ?? 3,
      });
      // Extract data URL after QRCode renders (it uses canvas internally)
      setTimeout(() => {
        const canvas = containerRef.current?.querySelector("canvas");
        if (canvas) setSrc(canvas.toDataURL("image/png"));
      }, 60);
    };
    load().catch(() => {});
  }, [text, size]);

  return (
    <>
      {/* hidden render target */}
      <div ref={containerRef} style={{ position:"absolute", left:-9999, top:-9999, pointerEvents:"none" }} aria-hidden="true" />
      {src
        ? <img src={src} alt="Entry QR code" width={size} height={size} style={{ display:"block", imageRendering:"pixelated" }} />
        : <div style={{ width:size, height:size, background:"#f1f5f9", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:"#94a3b8" }}>Generating…</div>
      }
    </>
  );
}

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
  if (left.done) return <div style={{ fontSize:13, color:"#64748b", textAlign:"center", padding:"8px 0" }}>The event has started!</div>;
  const Box = ({ n, label }) => (
    <div style={{ textAlign:"center", minWidth:52 }}>
      <div style={{ fontSize:30, fontWeight:900, lineHeight:1, fontVariantNumeric:"tabular-nums" }}>{String(n).padStart(2,"0")}</div>
      <div style={{ fontSize:10, color:"#64748b", letterSpacing:1, textTransform:"uppercase", marginTop:2 }}>{label}</div>
    </div>
  );
  return (
    <div style={{ display:"flex", gap:12, justifyContent:"center", flexWrap:"wrap", padding:"12px 0" }}>
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
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }
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
  const btnStyle = (active) => ({
    padding:"6px 14px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:12, fontWeight:600,
    background: active ? "#1e3a8a" : "#fff", color: active ? "#fff" : "#374151",
    cursor:"pointer", fontFamily:"inherit",
  });

  return (
    <div>
      <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap" }}>
        <button onClick={() => setSatellite(false)} style={btnStyle(!satellite)}>Street</button>
        <button onClick={() => setSatellite(true)}  style={btnStyle(satellite)}>Satellite</button>
        <a href={googleUrl} target="_blank" rel="noreferrer"
          style={{ ...btnStyle(false), display:"inline-flex", alignItems:"center", gap:6, textDecoration:"none" }}>
          Get Directions
        </a>
      </div>
      <div ref={mapRef} style={{ height:280, borderRadius:12, overflow:"hidden", border:"1px solid #e2e8f0" }} />
      {venueAddress && <div style={{ marginTop:8, fontSize:12, color:"#64748b" }}>{venueAddress}</div>}
    </div>
  );
}

export default function PublicGuestPage({ eventPublicId, guestPublicId }) {
  const [state,  setState]  = useState("loading");
  const [data,   setData]   = useState(null);
  const [error,  setError]  = useState(null);
  const [rsvpState, setRsvpState] = useState("idle");
  const [rsvpMsg,   setRsvpMsg]   = useState("");
  const [dlBusy,    setDlBusy]    = useState(false);
  const [openSched, setOpenSched] = useState(null); // expanded schedule item index

  useEffect(() => {
    if (!supabase) { setState("error"); setError("Not connected to the database."); return; } // eslint-disable-line react-hooks/set-state-in-effect
    supabase.rpc("public_event_page_data", {
      p_event_public_id: eventPublicId,
      p_guest_public_id: guestPublicId,
    }).then(({ data: row, error: e }) => {
      if (e) { setState("error"); setError(e.message); return; }
      if (!row) { setState("notfound"); return; }
      setData(row); setState("found");
    });
  }, [eventPublicId, guestPublicId]);

  useEffect(() => {
    if (!data) return;
    const ps = data.page_settings || {};
    const webName = ps.web_event_name || data.event_name || "Event";
    const title = `${data.guest_name || "You"} — ${webName}`;
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
    if (res?.ok) {
      setRsvpState("submitted");
      // Fire-and-forget WA notification — guest is not blocked on its result
      supabase.functions.invoke("notify-rsvp", { body: {
        event_public_id: eventPublicId,
        guest_name:      data?.guest_name   || null,
        card_type:       data?.card_type    || null,
        attending,
        message:         rsvpMsg || null,
      }}).catch(() => {});
    } else {
      setRsvpState("error");
    }
  };

  // Loading / error / not-found states
  const minPage = { minHeight:"100vh", background:"#f8f9fa", color:"#1a202c", fontFamily:"'Plus Jakarta Sans', sans-serif",
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
      <div style={{ color:"#64748b", fontSize:14 }}>Loading your invitation…</div>
    </div>
  );
  if (state === "error") return (
    <div style={minPage}>
      <Brand />
      <div style={{ background:"#fff", border:"1px solid #fecaca", borderRadius:16, padding:28, maxWidth:420, textAlign:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.08)" }}>
        <div style={{ fontSize:13, color:"#ef4444" }}>{error}</div>
      </div>
    </div>
  );
  if (state === "notfound") return (
    <div style={minPage}>
      <Brand />
      <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:16, padding:36, maxWidth:420, textAlign:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.08)" }}>
        <div style={{ fontWeight:800, fontSize:17, marginBottom:8, color:"#1a202c" }}>Link not found</div>
        <div style={{ fontSize:13, color:"#64748b", lineHeight:1.6 }}>
          This invitation link is not valid, or the organiser has removed it.
          Please ask the organiser to resend your link.
        </div>
      </div>
    </div>
  );

  const ps  = data.page_settings || {};
  const pri = ps.primary_color  || "#1e3a8a";
  const acc = ps.accent_color   || "#7c3aed";

  const hosts    = Array.isArray(ps.hosts)    ? ps.hosts    : [];
  const schedule = Array.isArray(ps.schedule) ? ps.schedule : [];
  const gallery  = Array.isArray(ps.gallery)  ? ps.gallery  : [];
  const hasLocation = ps.venue_lat && ps.venue_lng;

  // Build "add to calendar" .ics download
  const addToCalendar = () => {
    if (!data.start_datetime) return;
    const pad = (n) => String(n).padStart(2,"0");
    const toIcs = (d) => { const dt = new Date(d); return `${dt.getFullYear()}${pad(dt.getMonth()+1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`; };
    const start = toIcs(data.start_datetime);
    const end   = data.end_datetime ? toIcs(data.end_datetime) : start;
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0",
      "BEGIN:VEVENT",
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${(ps.web_event_name || data.event_name || "Event").replace(/,/g,"\\,")}`,
      `DESCRIPTION:Invitation for ${data.guest_name || "you"}`,
      data.venue_name ? `LOCATION:${data.venue_name}` : "",
      "END:VEVENT", "END:VCALENDAR",
    ].filter(Boolean).join("\r\n");
    const blob = new Blob([ics], { type:"text/calendar" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${(data.event_name || "event").replace(/\s+/g,"_")}.ics`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Shared card styles ──────────────────────────────────────────────────
  const card = {
    background:"#ffffff", borderRadius:16, border:"1px solid #e2e8f0",
    boxShadow:"0 2px 12px rgba(0,0,0,0.06)", overflow:"hidden",
  };
  const sectionLabel = { fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:"#94a3b8", marginBottom:4 };

  // ── Responsive CSS injected once ───────────────────────────────────────
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800;900&display=swap');
    .pg-wrap { min-height:100vh; background:#f8f3f0; color:#0f172a; font-family:'Plus Jakarta Sans',sans-serif; }
    .pg-top  { max-width:1100px; margin:0 auto; padding:24px 20px 0; display:flex; align-items:center; justify-content:space-between; }
    .pg-hero { max-width:1100px; margin:0 auto; padding:28px 20px 0; }
    .pg-grid { max-width:1100px; margin:0 auto; padding:24px 20px 48px; display:grid; gap:24px; grid-template-columns:1fr; }
    .pg-left-sticky { position:static; }
    .pg-below { max-width:1100px; margin:0 auto; padding:0 20px 48px; }
    @media (min-width:768px) {
      .pg-grid { grid-template-columns: minmax(300px,420px) 1fr; align-items:start; }
      .pg-left-sticky { position:sticky; top:24px; }
    }
    .sched-item { background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; margin-bottom:10px; }
    .sched-header { display:flex; align-items:center; gap:12; padding:14px 18px; cursor:pointer; user-select:none; }
    .sched-header:hover { background:#f8fafc; }
    .sched-body { padding:0 18px 14px; font-size:13px; color:#64748b; line-height:1.6; }
    .pg-btn { display:flex; align-items:center; justify-content:center; gap:8px; padding:12px 20px; border-radius:10px; font-family:inherit; font-size:14px; font-weight:700; cursor:pointer; border:none; transition:opacity 0.15s; }
    .pg-btn:disabled { opacity:0.6; cursor:default; }
    .pg-btn:hover:not(:disabled) { opacity:0.88; }
  `;

  return (
    <div className="pg-wrap">
      <style>{css}</style>

      {/* ── Top navigation bar ── */}
      <div className="pg-top">
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="28" height="28" style={{ borderRadius:6 }} />
          <span style={{ fontWeight:800, fontSize:13, color:"#64748b" }}>Nikadi Studio</span>
        </div>
        {data.event_type && (
          <span style={{ fontSize:11, fontWeight:700, letterSpacing:1, textTransform:"uppercase",
            background:`${pri}18`, color:pri, border:`1px solid ${pri}30`, borderRadius:6, padding:"4px 12px" }}>
            {data.event_type}
          </span>
        )}
      </div>

      {/* ── Greeting header ── */}
      <div className="pg-hero">
        <div style={{ background:"#fff", borderRadius:16, border:"1px solid #e2e8f0",
          boxShadow:"0 2px 12px rgba(0,0,0,0.06)", padding:"24px 28px" }}>
          {data.event_type && (
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:pri, marginBottom:6 }}>
              A celebration to look forward to
            </div>
          )}
          <h1 style={{ fontSize:"clamp(22px,4vw,32px)", fontWeight:900, lineHeight:1.2, margin:"0 0 6px", color:"#0f172a" }}>
            Welcome, {data.guest_name || "Guest"}
          </h1>
          <p style={{ fontSize:14, color:"#64748b", margin:0, lineHeight:1.5 }}>
            {ps.tagline || "Your invitation, venue map, ceremony and reception times are all here."}
          </p>
        </div>
      </div>

      {/* ── Two-column main grid ── */}
      <div className="pg-grid">

        {/* ── LEFT COLUMN: card + actions ── */}
        <div className="pg-left-sticky">
          <div style={card}>
            {/* Card image */}
            {data.card_url ? (
              <div style={{ background:"#f1f5f9", padding:"20px 20px 0" }}>
                <img src={data.card_url} alt={`Invitation card for ${data.guest_name}`}
                  style={{ width:"100%", display:"block", borderRadius:10 }}
                  onError={e => { e.currentTarget.style.display="none"; }} />
              </div>
            ) : (
              <div style={{ background:"#f1f5f9", height:260, display:"flex", alignItems:"center", justifyContent:"center", color:"#94a3b8", fontSize:13 }}>
                Card being prepared by the organiser
              </div>
            )}

            {/* Card meta */}
            <div style={{ padding:"16px 20px" }}>
              {(data.card_type || data.card_code) && (
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
                  {data.card_type && (
                    <span style={{ fontSize:12, fontWeight:700, padding:"3px 10px", borderRadius:6,
                      background:"#f1f5f9", border:"1px solid #e2e8f0", color:"#374151" }}>
                      {data.card_type}
                    </span>
                  )}
                  {data.card_code && (
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:12, fontWeight:700,
                      padding:"3px 10px", borderRadius:6, letterSpacing:2,
                      background:`${pri}12`, border:`1px solid ${pri}30`, color:pri }}>
                      {data.card_code}
                    </span>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display:"flex", gap:10, flexDirection:"column" }}>
                {data.card_url && (
                  <button className="pg-btn" onClick={downloadCard} disabled={dlBusy}
                    style={{ background:acc, color:"#fff", width:"100%" }}>
                    {dlBusy ? "Downloading…" : "Download Card"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN: event details ── */}
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

          {/* Event name + countdown */}
          <div style={card}>
            <div style={{ padding:"22px 24px" }}>
              <div style={sectionLabel}>The Day</div>
              <h2 style={{ fontSize:"clamp(18px,3vw,26px)", fontWeight:900, margin:"0 0 6px", lineHeight:1.2, color:"#0f172a", textTransform:"uppercase" }}>
                {ps.web_event_name || data.event_name}
              </h2>
              {ps.event_description && (
                <p style={{ fontSize:13, color:"#64748b", margin:"0 0 16px", lineHeight:1.6 }}>{ps.event_description}</p>
              )}
              {ps.show_countdown !== false && data.start_datetime && <Countdown target={data.start_datetime} />}
            </div>
          </div>

          {/* Date widget */}
          {data.start_datetime && (
            <div style={card}>
              <div style={{ padding:"18px 20px", display:"flex", gap:16, alignItems:"center" }}>
                <div style={{ background:pri, borderRadius:12, padding:"12px 18px", textAlign:"center", flexShrink:0, minWidth:72 }}>
                  <div style={{ fontSize:36, fontWeight:900, color:"#fff", lineHeight:1, fontVariantNumeric:"tabular-nums" }}>
                    {fmtDay(data.start_datetime)}
                  </div>
                  <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.8)", letterSpacing:1, textTransform:"uppercase" }}>
                    {fmtMonth(data.start_datetime)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:10, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:"#94a3b8", marginBottom:4 }}>Save the date</div>
                  <div style={{ fontSize:15, fontWeight:700, color:"#0f172a", lineHeight:1.4 }}>
                    {fmtWeekdayDate(data.start_datetime)}
                  </div>
                  {fmtTime(data.start_datetime) && (
                    <div style={{ fontSize:13, color:"#64748b", marginTop:2 }}>
                      {fmtTime(data.start_datetime)}
                      {data.end_datetime ? ` – ${fmtTime(data.end_datetime)}` : ""}
                    </div>
                  )}
                  {data.venue_name && (
                    <div style={{ fontSize:13, color:"#64748b", marginTop:2 }}>{data.venue_name}</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Programme */}
          {schedule.length > 0 && (
            <div style={card}>
              <div style={{ padding:"18px 20px 8px" }}>
                <div style={sectionLabel}>Programme</div>
              </div>
              <div style={{ padding:"0 12px 12px" }}>
                {schedule.map((item, i) => (
                  <div key={i} className="sched-item">
                    <div className="sched-header" role="button" tabIndex={0}
                      onClick={() => setOpenSched(openSched === i ? null : i)}
                      onKeyDown={e => (e.key === "Enter" || e.key === " ") && setOpenSched(openSched === i ? null : i)}>
                      <div style={{ width:36, height:36, borderRadius:8, background:`${pri}15`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="12" rx="2" stroke={pri} strokeWidth="1.4"/><path d="M5 1v2M11 1v2M1 6h14" stroke={pri} strokeWidth="1.4" strokeLinecap="round"/></svg>
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.5, textTransform:"uppercase", color:"#64748b" }}>{item.title}</div>
                        {item.time && <div style={{ fontSize:13, fontWeight:700, color:pri, marginTop:1 }}>{item.time}</div>}
                      </div>
                      {item.description && (
                        <div style={{ fontSize:12, color:"#94a3b8", display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
                          View details
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transform: openSched === i ? "rotate(180deg)" : "none", transition:"transform 0.2s" }}>
                            <path d="M3 5l4 4 4-4" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      )}
                    </div>
                    {openSched === i && item.description && (
                      <div className="sched-body">{item.description}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Seats + Add to calendar */}
          <div style={card}>
            <div style={{ padding:"18px 20px" }}>
              {data.card_type && (
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, paddingBottom:14, borderBottom:"1px solid #f1f5f9" }}>
                  <span style={{ fontSize:13, color:"#64748b" }}>Seats allocated</span>
                  <span style={{ fontSize:13, fontWeight:700, color:"#0f172a" }}>
                    {ps.seats_label || "1 seat"}
                  </span>
                </div>
              )}
              {data.start_datetime && (
                <button className="pg-btn" onClick={addToCalendar}
                  style={{ background:pri, color:"#fff", width:"100%" }}>
                  Add to calendar
                </button>
              )}
            </div>
          </div>

          {/* Passcode */}
          {data.card_code && (
            <div style={card}>
              <div style={{ padding:"18px 20px" }}>
                <div style={sectionLabel}>Show this at the entrance</div>
                <div style={{ marginTop:8, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                  <div style={{ fontSize:13, color:"#64748b" }}>Your passcode</div>
                  <div style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:16, fontWeight:800, letterSpacing:3,
                    padding:"8px 18px", borderRadius:8, border:`2px solid ${pri}`, color:pri, background:`${pri}0a` }}>
                    {data.card_code}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* QR code */}
          {data.card_code && (
            <div id="pg-qr" style={card}>
              <div style={{ padding:"22px 20px", textAlign:"center" }}>
                <div style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:"#94a3b8", marginBottom:16 }}>
                  Your entry QR code
                </div>
                <div style={{ display:"inline-flex", padding:16, background:"#fff", borderRadius:12, border:"1px solid #e2e8f0", marginBottom:14 }}>
                  <QRCodeDisplay text={data.card_code} size={150} />
                </div>
                <div style={{ fontSize:12, color:"#64748b", lineHeight:1.6 }}>
                  Show this code to your usher at the entrance.
                </div>
              </div>
            </div>
          )}

          {/* RSVP */}
          {ps.rsvp_enabled && (
            <div style={card}>
              <div style={{ padding:"22px 20px" }}>
                <div style={sectionLabel}>RSVP — Confirm Attendance</div>
                {rsvpState === "submitted" ? (
                  <div style={{ textAlign:"center", padding:"24px 0" }}>
                    <div style={{ fontSize:20, fontWeight:800, color:"#0f172a", marginBottom:6 }}>Thank you!</div>
                    <div style={{ fontSize:13, color:"#64748b", lineHeight:1.6 }}>Your RSVP has been received. We look forward to seeing you!</div>
                  </div>
                ) : (
                  <>
                    {ps.rsvp_message && <p style={{ fontSize:13, color:"#64748b", lineHeight:1.6, margin:"0 0 16px" }}>{ps.rsvp_message}</p>}
                    <textarea value={rsvpMsg} onChange={e => setRsvpMsg(e.target.value)}
                      placeholder="Leave a message (optional)…"
                      style={{ width:"100%", minHeight:80, background:"#f8fafc", border:"1px solid #e2e8f0",
                        borderRadius:10, padding:"10px 14px", color:"#0f172a", fontFamily:"inherit", fontSize:13,
                        resize:"vertical", marginBottom:12, boxSizing:"border-box" }} />
                    {rsvpState === "error" && <div style={{ color:"#ef4444", fontSize:13, marginBottom:10 }}>Something went wrong. Please try again.</div>}
                    <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                      <button className="pg-btn" onClick={() => submitRsvp(true)}
                        disabled={rsvpState==="attending"||rsvpState==="not-attending"}
                        style={{ flex:1, background:pri, color:"#fff", minWidth:120 }}>
                        I Will Attend
                      </button>
                      <button className="pg-btn" onClick={() => submitRsvp(false)}
                        disabled={rsvpState==="attending"||rsvpState==="not-attending"}
                        style={{ flex:1, background:"transparent", color:"#374151", border:"2px solid #e2e8f0", minWidth:120 }}>
                        I Won&apos;t Attend
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* RSVP closed notice */}
          {!ps.rsvp_enabled && (
            <div style={{ ...card }}>
              <div style={{ padding:"16px 20px" }}>
                <div style={{ fontSize:13, color:"#94a3b8", textAlign:"center" }}>RSVPs are closed for this event.</div>
              </div>
            </div>
          )}

        </div>{/* end right column */}
      </div>{/* end grid */}

      {/* ── Below-the-fold sections (full width) ── */}
      <div className="pg-below">

        {/* Dress code */}
        {(ps.dress_code_text || ps.dress_code_image_url) && (
          <div style={{ ...card, marginBottom:24, padding:"24px 28px" }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:"#94a3b8", marginBottom:16 }}>Dress Code</div>
            <div style={{ display:"grid", gridTemplateColumns: ps.dress_code_image_url ? "1fr 1fr" : "1fr", gap:20, alignItems:"start" }}>
              {ps.dress_code_text && (
                <div style={{ fontSize:14, lineHeight:1.7, color:"#374151", whiteSpace:"pre-wrap" }}>{ps.dress_code_text}</div>
              )}
              {ps.dress_code_image_url && (
                <img src={ps.dress_code_image_url} alt="Dress code" style={{ width:"100%", borderRadius:12 }}
                  onError={e => { e.currentTarget.style.display = "none"; }} />
              )}
            </div>
          </div>
        )}

        {/* Gallery */}
        {gallery.filter(Boolean).length > 0 && (
          <div style={{ ...card, marginBottom:24, padding:"24px 28px" }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:"#94a3b8", marginBottom:16 }}>Gallery</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))", gap:10 }}>
              {gallery.filter(Boolean).map((url, i) => (
                <img key={i} src={url} alt="" style={{ width:"100%", aspectRatio:"1", objectFit:"cover", borderRadius:10 }}
                  onError={e => { e.currentTarget.style.display = "none"; }} />
              ))}
            </div>
          </div>
        )}

        {/* Hosts */}
        {hosts.filter(h => h.name).length > 0 && (
          <div style={{ ...card, marginBottom:24, padding:"24px 28px" }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:"#94a3b8", marginBottom:16 }}>Hosts & MC</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))", gap:16 }}>
              {hosts.filter(h => h.name).map((h, i) => (
                <div key={i} style={{ textAlign:"center" }}>
                  {h.photo_url ? (
                    <img src={h.photo_url} alt={h.name}
                      style={{ width:72, height:72, borderRadius:"50%", objectFit:"cover", margin:"0 auto 10px", display:"block", border:`2px solid ${acc}` }}
                      onError={e => { e.currentTarget.style.display = "none"; }} />
                  ) : (
                    <div style={{ width:72, height:72, borderRadius:"50%", background:`${acc}22`, margin:"0 auto 10px", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, fontWeight:700, color:acc }}>
                      {h.name.charAt(0)}
                    </div>
                  )}
                  <div style={{ fontWeight:700, fontSize:14, color:"#0f172a" }}>{h.name}</div>
                  {h.role && <div style={{ fontSize:12, color:"#64748b", marginTop:2 }}>{h.role}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Location */}
        {hasLocation && (
          <div style={{ ...card, marginBottom:24, padding:"24px 28px" }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:"#94a3b8", marginBottom:16 }}>Venue & Directions</div>
            {ps.venue_description && <p style={{ fontSize:14, color:"#374151", lineHeight:1.6, marginBottom:16 }}>{ps.venue_description}</p>}
            <LeafletMap lat={ps.venue_lat} lng={ps.venue_lng} venueName={data.venue_name} venueAddress={data.venue_address} />
          </div>
        )}

      </div>

      {/* Footer */}
      <div style={{ textAlign:"center", padding:"20px 16px", borderTop:"1px solid #e2e8f0", fontSize:11, color:"#94a3b8" }}>
        Powered by Nikadi Studio
      </div>
    </div>
  );
}
