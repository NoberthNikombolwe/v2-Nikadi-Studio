import { useState, useEffect, useRef } from "react";
import { supabase } from "./lib/supabase";

// Public event microsite: #/g/<eventPublicId>/<guestPublicId>
// No login required. Data via public_event_page_data() SECURITY DEFINER RPC.

// ── Translations ─────────────────────────────────────────────────────────────
const LANG = {
  en: {
    loading:"Loading your invitation…", notFound:"Link not found",
    notFoundDesc:"This invitation link is not valid, or the organiser has removed it. Please ask the organiser to resend your link.",
    welcome:"Welcome", theDay:"The Day", saveTheDate:"Save the date",
    programme:"Programme", viewDetails:"View details", hideDetails:"Hide details",
    directions:"Get Directions", passcode:"Your passcode",
    showAtEntrance:"Show this at the entrance", entryQR:"Your entry QR code",
    scanInstruction:"Show this code at the entrance.",
    noCard:"Card being prepared by the organiser", download:"Download Card",
    downloading:"Downloading…", addToCalendar:"Add to calendar",
    seatsAllocated:"Seats allocated", dressCode:"Dress Code", gallery:"Gallery",
    hostsAndMC:"Hosts & MC", sponsors:"Sponsors & Vendors", venueAndDirections:"Venue & Directions",
    rsvpTitle:"RSVP — Confirm Attendance", rsvpWhatsapp:"Send via WhatsApp",
    willAttend:"I Will Attend", wontAttend:"I Won't Attend",
    rsvpPlaceholder:"Leave a message (optional)…",
    rsvpClosed:"RSVPs are closed for this event.", rsvpNoPhone:"No phone number on file.",
    rsvpSaving:"Saving…", rsvpSent:"Response recorded!", rsvpAlready:"Your response has been saved.",
    rsvpNotify:"Notify organiser on WhatsApp",
    eventStarted:"The event has started!", days:"Days", hours:"Hours", mins:"Mins", secs:"Secs",
    generatingQR:"Generating…", celebration:"A celebration to look forward to",
    defaultTagline:"Your invitation, venue map, ceremony and reception times are all here.",
    poweredBy:"Powered by Nikadi Studio", street:"Street", satellite:"Satellite",
    getGoogleDirections:"Open in Google Maps", lang:"SW",
    footerTagline:"Tanzania's digital event invitation platform",
    footerContact:"WhatsApp Us", footerVisit:"Visit Website",
    footerRights:"All rights reserved.",
  },
  sw: {
    loading:"Inapakia mwaliko wako…", notFound:"Kiungo hakipatikani",
    notFoundDesc:"Kiungo hiki cha mwaliko si halali, au mpangaji amekiondoa. Tafadhali omba mpangaji akutumie kiungo upya.",
    welcome:"Karibu", theDay:"Siku ya Tukio", saveTheDate:"Hifadhi Tarehe",
    programme:"Ratiba", viewDetails:"Angalia Maelezo", hideDetails:"Ficha Maelezo",
    directions:"Pata Maelekezo", passcode:"Nambari yako ya Siri",
    showAtEntrance:"Onyesha Hili Mlangoni", entryQR:"Msimbo wa QR wa Kuingia",
    scanInstruction:"Onyesha msimbo huu kwa mpangilio mlangoni.",
    noCard:"Kadi inaandaliwa na mpangaji", download:"Pakua Kadi",
    downloading:"Inapakua…", addToCalendar:"Ongeza kwenye Kalenda",
    seatsAllocated:"Viti vilivyotengwa", dressCode:"Msimbo wa Mavazi",
    gallery:"Picha za Tukio", hostsAndMC:"Waaandaji & MC", sponsors:"Wasaidizi & Wauza",
    venueAndDirections:"Mahali & Maelekezo",
    rsvpTitle:"RSVP — Thibitisha Uhudhuri", rsvpWhatsapp:"RSVP kupitia WhatsApp",
    rsvpTitle:"RSVP — Thibitisha Uhudhuri", rsvpWhatsapp:"Tuma kupitia WhatsApp",
    willAttend:"Nitahudhuria", wontAttend:"Sitahudhuria",
    rsvpPlaceholder:"Acha ujumbe (si lazima)…",
    rsvpClosed:"RSVP zimefungwa kwa tukio hili.", rsvpNoPhone:"Nambari ya simu haijapatikana.",
    rsvpSaving:"Inasalisha…", rsvpSent:"Jibu limesajiliwa!", rsvpAlready:"Jibu lako limehifadhiwa.",
    rsvpNotify:"Arifa mpangaji kupitia WhatsApp",
    eventStarted:"Tukio limeanza!", days:"Siku", hours:"Masaa", mins:"Dak", secs:"Sek",
    generatingQR:"Inaunda…", celebration:"Tukio zuri linakungoja",
    defaultTagline:"Mwaliko wako, ramani ya ukumbi, wakati wa sherehe na mapokezi yako yote yako hapa.",
    poweredBy:"Imetolewa na Nikadi Studio", street:"Barabara", satellite:"Setilaiti",
    getGoogleDirections:"Fungua kwenye Google Maps", lang:"EN",
    footerTagline:"Jukwaa la kidijitali la mialiko ya matukio Tanzania",
    footerContact:"WhatsApp Nasi", footerVisit:"Tembelea Tovuti",
    footerRights:"Haki zote zimehifadhiwa.",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (t) =>
  t ? new Date(t).toLocaleDateString("en-GB", { weekday:"long", day:"numeric", month:"long", year:"numeric" }) : null;
const fmtTime    = (t) => t ? new Date(t).toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" }) : null;
const fmtDay     = (t) => t ? new Date(t).getDate() : null;
const fmtMonth   = (t) => t ? new Date(t).toLocaleDateString("en-GB", { month:"short" }).toUpperCase() : null;
const fmtWeekdayDate = (t) =>
  t ? new Date(t).toLocaleDateString("en-GB", { weekday:"long", day:"numeric", month:"long", year:"numeric" }) : null;

// ── QR code display ───────────────────────────────────────────────────────────
function QRCodeDisplay({ text, size = 160, label }) {
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
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      if (!containerRef.current) return;
      containerRef.current.innerHTML = "";
      new window.QRCode(containerRef.current, {
        text, width: size * 2, height: size * 2,
        colorDark: "#000000", colorLight: "#ffffff",
        correctLevel: window.QRCode.CorrectLevel?.H ?? 3,
      });
      setTimeout(() => {
        const canvas = containerRef.current?.querySelector("canvas");
        if (canvas) setSrc(canvas.toDataURL("image/png"));
      }, 60);
    };
    load().catch(() => {});
  }, [text, size]);
  return (
    <>
      <div ref={containerRef} style={{ position:"absolute", left:-9999, top:-9999, pointerEvents:"none" }} aria-hidden="true" />
      {src
        ? <img src={src} alt={label || "QR code"} width={size} height={size}
            style={{ display:"block", imageRendering:"pixelated" }} />
        : <div style={{ width:size, height:size, background:"#f1f5f9", borderRadius:8,
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:"#94a3b8" }}>
            {label || "Generating…"}
          </div>
      }
    </>
  );
}

// ── Countdown ─────────────────────────────────────────────────────────────────
function Countdown({ target, t }) {
  const [left, setLeft] = useState(null);
  useEffect(() => {
    const calc = () => {
      const diff = new Date(target) - Date.now();
      if (diff <= 0) { setLeft({ done: true }); return; }
      setLeft({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000)  / 60000),
        s: Math.floor((diff % 60000)    / 1000),
      });
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [target]);
  if (!left) return null;
  if (left.done) return <div style={{ fontSize:13, color:"#64748b", textAlign:"center", padding:"8px 0" }}>{t.eventStarted}</div>;
  const Box = ({ n, label }) => (
    <div style={{ textAlign:"center", minWidth:60 }}>
      <div style={{ fontSize:34, fontWeight:900, lineHeight:1, fontVariantNumeric:"tabular-nums" }}>{String(n).padStart(2,"0")}</div>
      <div style={{ fontSize:10, color:"#64748b", letterSpacing:1, textTransform:"uppercase", marginTop:3 }}>{label}</div>
    </div>
  );
  return (
    <div style={{ display:"flex", gap:16, justifyContent:"center", flexWrap:"wrap", padding:"14px 0" }}>
      <Box n={left.d} label={t.days} />
      <Box n={left.h} label={t.hours} />
      <Box n={left.m} label={t.mins} />
      <Box n={left.s} label={t.secs} />
    </div>
  );
}

// ── Map ───────────────────────────────────────────────────────────────────────
function LeafletMap({ lat, lng, venueName, venueAddress, t }) {
  const mapRef      = useRef(null);
  const instanceRef = useRef(null);
  const layerRef    = useRef(null);
  const [satellite, setSatellite] = useState(false);
  useEffect(() => {
    let destroyed = false;
    const load = async () => {
      if (!mapRef.current || instanceRef.current) return;
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css"; link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }
      if (!window.L) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      if (destroyed || !mapRef.current) return;
      const L = window.L;
      const map = L.map(mapRef.current, { zoomControl:true, scrollWheelZoom:false }).setView([lat, lng], 15);
      const street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        { attribution:"&copy; OpenStreetMap contributors", maxZoom:19 });
      const satLayer = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution:"Tiles &copy; Esri", maxZoom:19 });
      street.addTo(map);
      layerRef.current = { street, satLayer };
      L.marker([lat, lng]).addTo(map).bindPopup(venueName || "Venue").openPopup();
      instanceRef.current = map;
    };
    load().catch(() => {});
    return () => { destroyed = true; if (instanceRef.current) { instanceRef.current.remove(); instanceRef.current = null; } };
  }, [lat, lng, venueName]);
  useEffect(() => {
    if (!instanceRef.current || !layerRef.current || !window.L) return;
    const { street, satLayer } = layerRef.current;
    if (satellite) { instanceRef.current.removeLayer(street); satLayer.addTo(instanceRef.current); }
    else { instanceRef.current.removeLayer(satLayer); street.addTo(instanceRef.current); }
  }, [satellite]);
  const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const btn = (active) => ({
    padding:"6px 14px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:12, fontWeight:600,
    background: active ? "#1e3a8a" : "#fff", color: active ? "#fff" : "#374151",
    cursor:"pointer", fontFamily:"inherit",
  });
  return (
    <div>
      <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap" }}>
        <button onClick={() => setSatellite(false)} style={btn(!satellite)}>{t.street}</button>
        <button onClick={() => setSatellite(true)}  style={btn(satellite)}>{t.satellite}</button>
        <a href={googleUrl} target="_blank" rel="noreferrer"
          style={{ ...btn(false), display:"inline-flex", alignItems:"center", gap:6, textDecoration:"none" }}>
          {t.getGoogleDirections}
        </a>
      </div>
      <div ref={mapRef} style={{ height:300, borderRadius:12, overflow:"hidden", border:"1px solid #e2e8f0" }} />
      {venueAddress && <div style={{ marginTop:8, fontSize:12, color:"#64748b" }}>{venueAddress}</div>}
    </div>
  );
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
function Lightbox({ images, startIndex, onClose }) {
  const [idx,     setIdx]    = useState(startIndex);
  const [visible, setVisible]= useState(false);
  const [zoom,    setZoom]   = useState(1);
  const [sliding, setSliding]= useState(null); // "left" | "right" | null
  const [dlBusy,  setDlBusy] = useState(false);
  const [dims,    setDims]   = useState(null); // { w, h } — fitted pixel size

  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  // Compute the largest size that fits the viewport while keeping aspect ratio
  const fitDims = (natW, natH) => {
    const availW = Math.floor(window.innerWidth  * 0.88);
    const availH = Math.floor(window.innerHeight * 0.74); // reserve ~26% for bars + padding
    const ratio  = natW / natH;
    let w = availW, h = availW / ratio;
    if (h > availH) { h = availH; w = h * ratio; }
    setDims({ w: Math.round(w), h: Math.round(h) });
  };

  const handleImgLoad = (e) => fitDims(e.target.naturalWidth, e.target.naturalHeight);

  const navigate = (dir) => {
    if (sliding) return;
    setZoom(1);
    setDims(null);
    setSliding(dir);
    setTimeout(() => {
      setIdx(i => dir === "right"
        ? (i + 1) % images.length
        : (i - 1 + images.length) % images.length);
      setSliding(null);
    }, 280);
  };
  const prev    = () => navigate("left");
  const next    = () => navigate("right");
  const zoomIn  = () => setZoom(z => Math.min(z + 0.5, 4));
  const zoomOut = () => setZoom(z => Math.max(z - 0.5, 1));

  const download = async () => {
    if (dlBusy) return;
    setDlBusy(true);
    try {
      const resp = await fetch(images[idx]);
      const blob = await resp.blob();
      const ext  = blob.type.split("/")[1] || "jpg";
      const a    = document.createElement("a");
      a.href     = URL.createObjectURL(blob);
      a.download = `photo-${idx + 1}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch { /* silent */ }
    setDlBusy(false);
  };

  const multi = images.length > 1;

  const slideAnim = sliding === "right"
    ? "lb-slide-out-left 0.28s ease forwards"
    : sliding === "left"
      ? "lb-slide-out-right 0.28s ease forwards"
      : "lb-slide-in 0.28s ease forwards";

  const btnStyle = {
    width:40, height:40, borderRadius:"50%", background:"rgba(255,255,255,0.12)",
    border:"1px solid rgba(255,255,255,0.2)", color:"#fff", fontSize:16,
    cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
    backdropFilter:"blur(8px)", fontFamily:"inherit", lineHeight:1,
  };

  // Container shrinks/grows to match the loaded image's aspect ratio
  const containerStyle = dims ? {
    width:  dims.w,
    height: dims.h,
    transition: "width 0.2s ease, height 0.2s ease",
  } : {
    // Placeholder while image loads
    minWidth: 120, minHeight: 80,
    maxWidth: "88vw", maxHeight: "74vh",
  };

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:9000, display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", padding:"16px",
      background: visible ? "rgba(0,0,0,0.93)" : "rgba(0,0,0,0)",
      transition:"background 0.25s ease",
    }}>
      <style>{`
        @keyframes lb-slide-in        { from { opacity:0; transform:translateX(60px) scale(0.96) } to { opacity:1; transform:translateX(0) scale(1) } }
        @keyframes lb-slide-out-left  { from { opacity:1; transform:translateX(0) } to { opacity:0; transform:translateX(-80px) } }
        @keyframes lb-slide-out-right { from { opacity:1; transform:translateX(0) } to { opacity:0; transform:translateX(80px) } }
      `}</style>

      {/* Top bar */}
      <div style={{
        position:"absolute", top:12, left:0, right:0, display:"flex",
        alignItems:"center", gap:8, padding:"0 60px",
      }}>
        {multi && (
          <span style={{ color:"rgba(255,255,255,0.7)", fontSize:13, fontWeight:600, letterSpacing:1 }}>
            {idx + 1} / {images.length}
          </span>
        )}
        <div style={{ flex:1 }} />
        <button style={{ ...btnStyle, opacity: zoom <= 1 ? 0.4 : 1 }} onClick={zoomOut}
          disabled={zoom <= 1} aria-label="Zoom out" title="Zoom out">－</button>
        <span style={{ color:"rgba(255,255,255,0.6)", fontSize:12, minWidth:36, textAlign:"center" }}>
          {Math.round(zoom * 100)}%
        </span>
        <button style={{ ...btnStyle, opacity: zoom >= 4 ? 0.4 : 1 }} onClick={zoomIn}
          disabled={zoom >= 4} aria-label="Zoom in" title="Zoom in">＋</button>
        <button style={{ ...btnStyle, opacity: dlBusy ? 0.5 : 1 }} onClick={download}
          disabled={dlBusy} aria-label="Download" title="Download">
          {dlBusy ? "…" : "↓"}
        </button>
      </div>

      {/* Close */}
      <button onClick={onClose} style={{ position:"absolute", top:12, right:12, ...btnStyle, fontSize:18 }}
        aria-label="Close">✕</button>

      {/* Image container — sized to match the photo's aspect ratio */}
      <div style={{
        ...containerStyle,
        marginTop: 52,
        borderRadius: 12,
        boxShadow: "0 20px 80px rgba(0,0,0,0.6)",
        overflow: zoom > 1 ? "auto" : "hidden",
        position: "relative",
        background: "rgba(255,255,255,0.03)",
      }}>
        {!dims && (
          <div style={{
            position:"absolute", inset:0, display:"flex",
            alignItems:"center", justifyContent:"center",
            color:"rgba(255,255,255,0.3)", fontSize:13,
          }}>loading…</div>
        )}
        <img
          key={idx}
          src={images[idx]}
          alt=""
          onLoad={handleImgLoad}
          style={{
            display:"block",
            width: dims ? "100%" : 0,
            height: dims ? "100%" : 0,
            objectFit: "cover",
            transform: `scale(${zoom})`,
            transformOrigin: "center center",
            transition: zoom > 1 ? "transform 0.2s ease" : undefined,
            cursor: zoom > 1 ? "zoom-in" : "default",
            animation: slideAnim,
          }}
        />
      </div>

      {/* Prev / Next */}
      {multi && (
        <>
          <button onClick={prev} style={{
            ...btnStyle, position:"absolute", left:12, top:"50%", transform:"translateY(-50%)",
            width:48, height:48, fontSize:20,
          }} aria-label="Previous">‹</button>
          <button onClick={next} style={{
            ...btnStyle, position:"absolute", right:12, top:"50%", transform:"translateY(-50%)",
            width:48, height:48, fontSize:20,
          }} aria-label="Next">›</button>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PublicGuestPage({ eventPublicId, guestPublicId }) {
  const [state,    setState]  = useState("loading");
  const [data,     setData]   = useState(null);
  const [error,    setError]  = useState(null);
  const [dlBusy,   setDlBusy]   = useState(false);
  const [rsvpMsg,  setRsvpMsg]  = useState("");
  const [rsvpBusy, setRsvpBusy] = useState(false);
  const [rsvpDone, setRsvpDone] = useState(null); // "yes" | "no" | null
  const [rsvpErr,  setRsvpErr]  = useState(null);
  const [openSched, setOpenSched] = useState(null);
  const [lang,      setLang]      = useState("en");
  const [lightbox,  setLightbox]  = useState(null); // { images:[], idx:0 }

  const t = LANG[lang];
  const toggleLang = () => setLang(l => l === "en" ? "sw" : "en");

  // Opens Google Maps navigation from the user's current GPS position to the destination.
  // If the destination is already a URL, opens it directly (can't inject origin into short links).
  // Falls back to destination-only if geolocation is unavailable or denied.
  const openDirections = (locationText) => {
    if (!locationText) return;
    const loc = locationText.trim();
    if (/^https?:\/\//i.test(loc)) {
      window.open(loc, "_blank", "noopener,noreferrer");
      return;
    }
    const destUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(loc)}&travelmode=driving`;
    if (!navigator.geolocation) { window.open(destUrl, "_blank", "noopener,noreferrer"); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const url = `https://www.google.com/maps/dir/?api=1&origin=${coords.latitude},${coords.longitude}&destination=${encodeURIComponent(loc)}&travelmode=driving`;
        window.open(url, "_blank", "noopener,noreferrer");
      },
      () => window.open(destUrl, "_blank", "noopener,noreferrer"),
      { timeout: 6000, maximumAge: 60000 },
    );
  };

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
    const ps      = data.page_settings || {};
    const webName = ps.web_event_name || data.event_name || "Event";
    const title   = `${data.guest_name || "You"} — ${webName}`;
    const datePart = fmtDate(data.start_datetime) || "";
    const descParts = [ps.tagline, data.event_type, data.venue_name, datePart].filter(Boolean);
    const desc    = descParts.length ? descParts.join(" · ") : `Personalised event invitation — Nikadi Studio`;
    const img     = data.card_url || ps.hero_image_url || "";
    const canonical = `${window.location.origin}/g/${eventPublicId}/${guestPublicId}`;
    const keywords  = [webName, data.event_type, data.venue_name, "event invitation", "Nikadi Studio"].filter(Boolean).join(", ");

    const setMeta = (prop, content, attr = "property") => {
      let el = document.querySelector(`meta[${attr}="${prop}"]`);
      if (!el) { el = document.createElement("meta"); el.setAttribute(attr, prop); document.head.appendChild(el); }
      el.content = content;
    };
    const setLink = (rel, href) => {
      let el = document.querySelector(`link[rel="${rel}"]`);
      if (!el) { el = document.createElement("link"); el.rel = rel; document.head.appendChild(el); }
      el.href = href;
    };

    document.title = title;
    setMeta("description",    desc,    "name");
    setMeta("keywords",       keywords,"name");
    setMeta("robots",         "noindex, nofollow", "name");
    setLink("canonical",      canonical);
    setMeta("og:title",       title);
    setMeta("og:description", desc);
    setMeta("og:type",        "website");
    setMeta("og:url",         canonical);
    setMeta("twitter:card",   "summary_large_image", "name");
    setMeta("twitter:title",  title,   "name");
    setMeta("twitter:description", desc, "name");
    if (img) { setMeta("og:image", img); setMeta("twitter:image", img, "name"); }
  }, [data, eventPublicId, guestPublicId]);

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
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { /* download failed silently */ }
    setDlBusy(false);
  };

  const openRsvpWhatsapp = (attending, ps) => {
    const phone = ps?.rsvp_notify_phone;
    if (!phone) return;
    const name   = data?.guest_name || "";
    const evt    = ps.web_event_name || data?.event_name || "";
    const status = lang === "sw"
      ? (attending ? "Nitahudhuria" : "Sitahudhuria")
      : (attending ? "I will attend" : "I won't attend");
    const extra  = rsvpMsg.trim() ? `\n\n${rsvpMsg.trim()}` : "";
    const msg    = lang === "sw"
      ? `Habari, mimi ni ${name}. RSVP kwa ${evt}: ${status}.${extra}`
      : `Hi, I'm ${name}. RSVP for ${evt}: ${status}.${extra}`;
    const normalized = String(phone).replace(/\D/g, "");
    window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  };

  const handleRsvp = async (attending) => {
    if (rsvpBusy || rsvpDone) return;
    setRsvpBusy(true);
    setRsvpErr(null);
    try {
      if (supabase) {
        const { data: result, error } = await supabase.rpc("submit_rsvp", {
          p_event_public_id: eventPublicId,
          p_guest_public_id: guestPublicId,
          p_attending:       attending,
          p_message:         rsvpMsg.trim() || null,
        });
        if (error) { setRsvpErr(error.message); setRsvpBusy(false); return; }
        if (result?.ok === false) { setRsvpErr(result.error || "Could not save"); setRsvpBusy(false); return; }
      }
      setRsvpDone(attending ? "yes" : "no");
      openRsvpWhatsapp(attending, data?.page_settings || {});
    } catch (e) { setRsvpErr(e.message); }
    finally { setRsvpBusy(false); }
  };

  const addToCalendar = () => {
    if (!data?.start_datetime) return;
    const pad = (n) => String(n).padStart(2,"0");
    const toIcs = (d) => { const dt = new Date(d); return `${dt.getFullYear()}${pad(dt.getMonth()+1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`; };
    const start = toIcs(data.start_datetime);
    const end   = data.end_datetime ? toIcs(data.end_datetime) : start;
    const ps    = data.page_settings || {};
    const ics   = ["BEGIN:VCALENDAR","VERSION:2.0","BEGIN:VEVENT",`DTSTART:${start}`,`DTEND:${end}`,
      `SUMMARY:${(ps.web_event_name || data.event_name || "Event").replace(/,/g,"\\,")}`,
      `DESCRIPTION:Invitation for ${data.guest_name || "you"}`,
      data.venue_name ? `LOCATION:${data.venue_name}` : "",
      "END:VEVENT","END:VCALENDAR"].filter(Boolean).join("\r\n");
    const blob = new Blob([ics], { type:"text/calendar" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${(data.event_name || "event").replace(/\s+/g,"_")}.ics`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Loading / error / not-found ─────────────────────────────────────────
  const minPage = { minHeight:"100vh", background:"#f8f9fa", color:"#1a202c",
    fontFamily:"'Plus Jakarta Sans', sans-serif", display:"flex", flexDirection:"column",
    alignItems:"center", padding:"40px 16px" };
  const Brand = () => (
    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:32 }}>
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="32" height="32" style={{ borderRadius:8 }} />
      <div style={{ fontWeight:800, fontSize:14 }}>Nikadi Studio</div>
    </div>
  );
  if (state === "loading") return (
    <div style={minPage}><Brand /><div style={{ color:"#64748b", fontSize:14 }}>{t.loading}</div></div>
  );
  if (state === "error") return (
    <div style={minPage}><Brand />
      <div style={{ background:"#fff", border:"1px solid #fecaca", borderRadius:16, padding:28, maxWidth:420, textAlign:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.08)" }}>
        <div style={{ fontSize:13, color:"#ef4444" }}>{error}</div>
      </div>
    </div>
  );
  if (state === "notfound") return (
    <div style={minPage}><Brand />
      <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:16, padding:36, maxWidth:420, textAlign:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.08)" }}>
        <div style={{ fontWeight:800, fontSize:17, marginBottom:8, color:"#1a202c" }}>{t.notFound}</div>
        <div style={{ fontSize:13, color:"#64748b", lineHeight:1.6 }}>{t.notFoundDesc}</div>
      </div>
    </div>
  );

  const ps  = data.page_settings || {};
  const pri = ps.primary_color || "#1e3a8a";
  const acc = ps.accent_color  || "#7c3aed";

  const hosts    = Array.isArray(ps.hosts)    ? ps.hosts    : [];
  const schedule = Array.isArray(ps.schedule) ? ps.schedule : [];
  const gallery  = (Array.isArray(ps.gallery) ? ps.gallery : []).filter(Boolean);
  const hasLocation = !!ps.venue_location_url;

  // Try to extract lat/lng from a Google Maps share URL so we can show a Leaflet map.
  // Handles: /@lat,lng  and  ?q=lat,lng  and  query=lat,lng
  const extractLatLng = (url) => {
    if (!url) return null;
    let m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    m = url.match(/[?&](?:q|query)=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    return null;
  };
  const mapCoords = extractLatLng(ps.venue_location_url);

  // gallery images for lightbox (also include hero if present)
  const openGallery  = (idx) => setLightbox({ images: gallery, idx });
  const openSingle   = (url) => setLightbox({ images:[url], idx:0 });

  const card = {
    background:"#ffffff", borderRadius:16, border:"1px solid #e2e8f0",
    boxShadow:"0 2px 12px rgba(0,0,0,0.06)", overflow:"hidden",
  };
  const sectionLabel = { fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:"#94a3b8", marginBottom:4 };

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800;900&display=swap');
    * { box-sizing: border-box; }
    .pg-wrap { min-height:100vh; background:#f5f4f2; color:#0f172a; font-family:'Plus Jakarta Sans',sans-serif; }
    .pg-top  { max-width:1100px; margin:0 auto; padding:20px 20px 0; display:flex; align-items:center; justify-content:space-between; }
    .pg-hero-img { max-width:1100px; margin:16px auto 0; padding:0 20px; }
    .pg-hero-img img { width:100%; max-height:380px; object-fit:cover; border-radius:16px;
      box-shadow:0 8px 32px rgba(0,0,0,0.14); display:block; cursor:pointer;
      transition:transform 0.3s ease, box-shadow 0.3s ease; }
    .pg-hero-img img:hover { transform:scale(1.012); box-shadow:0 16px 48px rgba(0,0,0,0.22); }
    .pg-greeting { max-width:1100px; margin:0 auto; padding:20px 20px 0; }
    .pg-grid { max-width:1100px; margin:0 auto; padding:24px 20px 48px; display:grid; gap:20px; grid-template-columns:1fr; }
    .pg-left-sticky { position:static; }
    .pg-below { max-width:1100px; margin:0 auto; padding:0 20px 48px; }
    @media (min-width:768px) {
      .pg-grid { grid-template-columns: minmax(320px,420px) 1fr; align-items:start; }
      .pg-left-sticky { position:sticky; top:20px; }
    }
    /* Gallery grid */
    .pg-gallery-grid { display:grid; gap:10px;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
    .pg-gallery-grid.single { grid-template-columns:1fr; }
    .pg-gallery-grid.two    { grid-template-columns:1fr 1fr; }
    .pg-gallery-item { position:relative; border-radius:12px; overflow:hidden; cursor:pointer;
      aspect-ratio:4/3; background:#e2e8f0; }
    .pg-gallery-item.featured { aspect-ratio:16/9; }
    .pg-gallery-item img { width:100%; height:100%; object-fit:cover; display:block;
      transition:transform 0.35s ease; }
    .pg-gallery-item:hover img { transform:scale(1.07); }
    .pg-gallery-item::after { content:''; position:absolute; inset:0;
      background:rgba(0,0,0,0); transition:background 0.3s ease; border-radius:12px; }
    .pg-gallery-item:hover::after { background:rgba(0,0,0,0.22); }
    .pg-gallery-expand { position:absolute; inset:0; display:flex; align-items:center;
      justify-content:center; opacity:0; transition:opacity 0.25s ease; z-index:1; }
    .pg-gallery-item:hover .pg-gallery-expand { opacity:1; }
    /* Hosts */
    .pg-host-card { display:flex; gap:20px; align-items:flex-start; padding:16px 0;
      border-bottom:1px solid #f1f5f9; }
    .pg-host-card:last-child { border-bottom:none; padding-bottom:0; }
    .pg-host-photo-wrap { flex-shrink:0; }
    .pg-host-photo { width:150px; height:150px; border-radius:50%; object-fit:cover;
      display:block; border:3px solid transparent;
      transition:transform 0.25s ease, box-shadow 0.25s ease; cursor:pointer; }
    .pg-host-photo:hover { transform:scale(1.06); box-shadow:0 8px 24px rgba(0,0,0,0.2); }
    @media (max-width:420px) {
      .pg-host-card { flex-direction:column; align-items:center; text-align:center; }
      .pg-host-photo { width:140px; height:140px; }
    }
    /* Sponsors */
    .pg-sponsor-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,180px)); gap:16px; margin-top:14px; justify-content:center; }
    .pg-sponsor-card { border:1px solid #e2e8f0; border-radius:12px; padding:16px 14px;
      display:flex; flex-direction:column; align-items:center; text-align:center; gap:8px;
      transition:box-shadow 0.2s ease, transform 0.2s ease; }
    .pg-sponsor-card:hover { box-shadow:0 4px 20px rgba(0,0,0,0.08); transform:translateY(-2px); }
    .pg-sponsor-logo { width:72px; height:72px; object-fit:contain; border-radius:8px; }
    .pg-sponsor-badge { display:inline-block; padding:2px 8px; border-radius:20px;
      font-size:10px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; }
    /* Schedule */
    .sched-item { background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; margin-bottom:10px; }
    .sched-header { display:flex; align-items:center; gap:12px; padding:16px 18px; cursor:pointer; user-select:none; }
    .sched-header:hover { background:#f8fafc; }
    .sched-body { padding:0 18px 16px; }
    /* Buttons */
    .pg-btn { display:flex; align-items:center; justify-content:center; gap:8px; padding:13px 20px;
      border-radius:10px; font-family:inherit; font-size:14px; font-weight:700; cursor:pointer;
      border:none; transition:opacity 0.15s, transform 0.12s; }
    .pg-btn:disabled { opacity:0.6; cursor:default; }
    .pg-btn:hover:not(:disabled) { opacity:0.88; transform:translateY(-1px); }
    /* Dress code image */
    .pg-dc-img { width:100%; border-radius:12px; cursor:pointer; display:block;
      transition:transform 0.3s ease, box-shadow 0.3s ease; max-height:420px; object-fit:cover; }
    .pg-dc-img:hover { transform:scale(1.015); box-shadow:0 8px 28px rgba(0,0,0,0.18); }
    /* Lang toggle */
    .pg-lang-btn { padding:5px 12px; border-radius:8px; border:1px solid #e2e8f0; font-size:12px;
      font-weight:700; cursor:pointer; background:#fff; color:#374151; font-family:inherit;
      transition:background 0.15s; letter-spacing:0.5px; }
    .pg-lang-btn:hover { background:#f1f5f9; }
  `;

  return (
    <div className="pg-wrap">
      <style>{css}</style>

      {lightbox && (
        <Lightbox images={lightbox.images} startIndex={lightbox.idx} onClose={() => setLightbox(null)} />
      )}

      {/* ── Top bar ── */}
      <div className="pg-top">
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="28" height="28" style={{ borderRadius:6 }} />
          <span style={{ fontWeight:800, fontSize:13, color:"#64748b" }}>Nikadi Studio</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {data.event_type && (
            <span style={{ fontSize:11, fontWeight:700, letterSpacing:1, textTransform:"uppercase",
              background:`${pri}18`, color:pri, border:`1px solid ${pri}30`, borderRadius:6, padding:"4px 10px" }}>
              {data.event_type}
            </span>
          )}
          <button className="pg-lang-btn" onClick={toggleLang}>{t.lang}</button>
        </div>
      </div>

      {/* ── Hero banner image ── */}
      {ps.hero_image_url && (
        <div className="pg-hero-img">
          <img src={ps.hero_image_url} alt="Event banner"
            onClick={() => openSingle(ps.hero_image_url)}
            onError={e => { e.currentTarget.parentElement.style.display = "none"; }} />
        </div>
      )}

      {/* ── Greeting card ── */}
      <div className="pg-greeting">
        <div style={{ background:"#fff", borderRadius:16, border:"1px solid #e2e8f0",
          boxShadow:"0 2px 12px rgba(0,0,0,0.06)", padding:"22px 28px" }}>
          {data.event_type && (
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:pri, marginBottom:6 }}>
              {t.celebration}
            </div>
          )}
          <h1 style={{ fontSize:"clamp(22px,4vw,32px)", fontWeight:900, lineHeight:1.2, margin:"0 0 6px", color:"#0f172a" }}>
            {t.welcome}, {data.guest_name || "Guest"}
          </h1>
          <p style={{ fontSize:14, color:"#64748b", margin:0, lineHeight:1.5 }}>
            {ps.tagline || t.defaultTagline}
          </p>
        </div>
      </div>

      {/* ── Two-column grid ── */}
      <div className="pg-grid">

        {/* ── LEFT: card + actions ── */}
        <div className="pg-left-sticky">
          <div style={card}>
            {data.card_url ? (
              <div style={{ background:"#f1f5f9", padding:"20px 20px 0", cursor:"pointer" }}
                onClick={() => openSingle(data.card_url)}>
                <img src={data.card_url} alt={`Invitation card for ${data.guest_name}`}
                  style={{ width:"100%", display:"block", borderRadius:10,
                    transition:"transform 0.3s ease", boxShadow:"0 4px 16px rgba(0,0,0,0.1)" }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.02)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ""; }}
                  onError={e => { e.currentTarget.style.display="none"; }} />
              </div>
            ) : (
              <div style={{ background:"#f1f5f9", height:280, display:"flex", alignItems:"center",
                justifyContent:"center", color:"#94a3b8", fontSize:13 }}>
                {t.noCard}
              </div>
            )}
            <div style={{ padding:"18px 20px" }}>
              {(data.card_type || (data.card_code && ps.show_passcode !== false)) && (
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
                  {data.card_type && (
                    <span style={{ fontSize:12, fontWeight:700, padding:"3px 10px", borderRadius:6,
                      background:"#f1f5f9", border:"1px solid #e2e8f0", color:"#374151" }}>
                      {data.card_type}
                    </span>
                  )}
                  {data.card_code && ps.show_passcode !== false && (
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:12, fontWeight:700,
                      padding:"3px 10px", borderRadius:6, letterSpacing:2,
                      background:`${pri}12`, border:`1px solid ${pri}30`, color:pri }}>
                      {data.card_code}
                    </span>
                  )}
                </div>
              )}
              <div style={{ display:"flex", gap:10, flexDirection:"column" }}>
                {data.card_url && (
                  <button className="pg-btn" onClick={downloadCard} disabled={dlBusy}
                    style={{ background:acc, color:"#fff", width:"100%" }}>
                    {dlBusy ? t.downloading : t.download}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT: event details ── */}
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

          {/* Event name + countdown */}
          <div style={card}>
            <div style={{ padding:"22px 24px" }}>
              <div style={sectionLabel}>{t.theDay}</div>
              <h2 style={{ fontSize:"clamp(18px,3vw,26px)", fontWeight:900, margin:"0 0 6px",
                lineHeight:1.2, color:"#0f172a", textTransform:"uppercase" }}>
                {ps.web_event_name || data.event_name}
              </h2>
              {ps.show_countdown !== false && data.start_datetime && <Countdown target={data.start_datetime} t={t} />}
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
                  <div style={{ fontSize:10, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:"#94a3b8", marginBottom:4 }}>
                    {t.saveTheDate}
                  </div>
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
                <div style={sectionLabel}>{t.programme}</div>
              </div>
              <div style={{ padding:"0 12px 12px" }}>
                {schedule.map((item, i) => {
                  const hasDetail  = item.description;
                  const hasLocation = item.location?.trim();
                  // mapsUrl is a truthy flag only — actual URL built dynamically in openDirections
                  const mapsUrl = hasLocation || null;
                  return (
                    <div key={i} className="sched-item">
                      <div className="sched-header" role="button" tabIndex={0}
                        onClick={() => hasDetail && setOpenSched(openSched === i ? null : i)}
                        onKeyDown={e => hasDetail && (e.key==="Enter"||e.key===" ") && setOpenSched(openSched===i?null:i)}
                        style={{ cursor: hasDetail ? "pointer" : "default" }}>
                        <div style={{ width:38, height:38, borderRadius:8, background:`${pri}15`,
                          display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <rect x="1" y="2" width="14" height="12" rx="2" stroke={pri} strokeWidth="1.4"/>
                            <path d="M5 1v2M11 1v2M1 6h14" stroke={pri} strokeWidth="1.4" strokeLinecap="round"/>
                          </svg>
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:13, fontWeight:700, color:"#0f172a" }}>{item.title}</div>
                          {item.time && <div style={{ fontSize:12, fontWeight:700, color:pri, marginTop:2 }}>{item.time}</div>}
                        </div>
                        {hasDetail && (
                          <div style={{ fontSize:11, color:"#94a3b8", display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
                            {openSched === i ? t.hideDetails : t.viewDetails}
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                              style={{ transform: openSched===i ? "rotate(180deg)" : "none", transition:"transform 0.2s" }}>
                              <path d="M3 5l4 4 4-4" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                        )}
                      </div>
                      {(openSched===i && hasDetail) && (
                        <div className="sched-body">
                          <div style={{ fontSize:13, color:"#64748b", lineHeight:1.6, marginBottom: mapsUrl ? 10 : 0 }}>
                            {item.description}
                          </div>
                          {mapsUrl && (
                            <button onClick={() => openDirections(item.location)}
                              style={{ display:"inline-flex", alignItems:"center", gap:6, fontSize:12, fontWeight:700,
                                color:pri, padding:"6px 12px", borderRadius:8, cursor:"pointer",
                                border:`1px solid ${pri}40`, background:`${pri}0d`, fontFamily:"inherit",
                                transition:"background 0.15s" }}>
                              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                                <path d="M7 1a4 4 0 014 4c0 3-4 8-4 8S3 8 3 5a4 4 0 014-4z" stroke={pri} strokeWidth="1.4"/>
                                <circle cx="7" cy="5" r="1.4" fill={pri}/>
                              </svg>
                              {t.directions}
                            </button>
                          )}
                        </div>
                      )}
                      {/* Show directions even without description if location exists */}
                      {openSched !== i && mapsUrl && !hasDetail && (
                        <div className="sched-body" style={{ paddingTop:0 }}>
                          <button onClick={() => openDirections(item.location)}
                            style={{ display:"inline-flex", alignItems:"center", gap:6, fontSize:12, fontWeight:700,
                              color:pri, padding:"6px 12px", borderRadius:8, cursor:"pointer",
                              border:`1px solid ${pri}40`, background:`${pri}0d`, fontFamily:"inherit" }}>
                            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                              <path d="M7 1a4 4 0 014 4c0 3-4 8-4 8S3 8 3 5a4 4 0 014-4z" stroke={pri} strokeWidth="1.4"/>
                              <circle cx="7" cy="5" r="1.4" fill={pri}/>
                            </svg>
                            {t.directions}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Seats + Add to calendar */}
          <div style={card}>
            <div style={{ padding:"18px 20px" }}>
              {data.card_type && (
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                  marginBottom:16, paddingBottom:14, borderBottom:"1px solid #f1f5f9" }}>
                  <span style={{ fontSize:13, color:"#64748b" }}>{t.seatsAllocated}</span>
                  <span style={{ fontSize:13, fontWeight:700, color:"#0f172a" }}>{ps.seats_label || "1 seat"}</span>
                </div>
              )}
              {data.start_datetime && (
                <button className="pg-btn" onClick={addToCalendar}
                  style={{ background:pri, color:"#fff", width:"100%" }}>
                  {t.addToCalendar}
                </button>
              )}
            </div>
          </div>

          {/* Passcode + QR code — hidden when organiser turns off show_passcode */}
          {data.card_code && ps.show_passcode !== false && (
            <>
              <div style={card}>
                <div style={{ padding:"18px 20px" }}>
                  <div style={sectionLabel}>{t.showAtEntrance}</div>
                  <div style={{ marginTop:8, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                    <div style={{ fontSize:13, color:"#64748b" }}>{t.passcode}</div>
                    <div style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:18, fontWeight:900, letterSpacing:4,
                      padding:"10px 20px", borderRadius:10, border:`2px solid ${pri}`, color:pri, background:`${pri}0a` }}>
                      {data.card_code}
                    </div>
                  </div>
                </div>
              </div>

              <div style={card}>
                <div style={{ padding:"22px 20px", textAlign:"center" }}>
                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase",
                    color:"#94a3b8", marginBottom:16 }}>{t.entryQR}</div>
                  <div style={{ display:"inline-flex", padding:18, background:"#fff", borderRadius:14,
                    border:"1px solid #e2e8f0", marginBottom:14, boxShadow:"0 2px 12px rgba(0,0,0,0.06)" }}>
                    <QRCodeDisplay text={data.card_code} size={180} label={t.generatingQR} />
                  </div>
                  <div style={{ fontSize:12, color:"#64748b", lineHeight:1.6 }}>{t.scanInstruction}</div>
                </div>
              </div>
            </>
          )}

          {/* RSVP */}
          {ps.rsvp_enabled && (
            <div style={card}>
              <div style={{ padding:"22px 20px" }}>
                <div style={sectionLabel}>{t.rsvpTitle}</div>
                {ps.rsvp_message && (
                  <p style={{ fontSize:13, color:"#64748b", lineHeight:1.6, margin:"0 0 16px" }}>{ps.rsvp_message}</p>
                )}
                <textarea
                  value={rsvpMsg}
                  onChange={e => setRsvpMsg(e.target.value)}
                  placeholder={t.rsvpPlaceholder}
                  style={{ width:"100%", minHeight:76, background:"#f8fafc", border:"1px solid #e2e8f0",
                    borderRadius:10, padding:"10px 14px", color:"#0f172a", fontFamily:"inherit",
                    fontSize:13, resize:"vertical", marginBottom:12, boxSizing:"border-box" }} />
                {rsvpDone ? (
                  <div style={{ textAlign:"center", padding:"16px 0" }}>
                    <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"10px 20px",
                      background: rsvpDone==="yes" ? "#dcfce7" : "#fef2f2",
                      border: `1px solid ${rsvpDone==="yes" ? "#86efac" : "#fca5a5"}`,
                      borderRadius:10, fontSize:14, fontWeight:700,
                      color: rsvpDone==="yes" ? "#15803d" : "#b91c1c" }}>
                      {rsvpDone==="yes" ? "✓" : "✕"} {t.rsvpSent}
                    </div>
                    <div style={{ marginTop:10, fontSize:12, color:"#64748b" }}>
                      {rsvpDone==="yes" ? t.willAttend : t.wontAttend}
                    </div>
                    {ps.rsvp_notify_phone && (
                      <button className="pg-btn" style={{ margin:"12px auto 0", background:"#25D366", color:"#fff", fontSize:13, padding:"10px 20px" }}
                        onClick={() => openRsvpWhatsapp(rsvpDone==="yes", ps)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink:0 }}>
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                        </svg>
                        {t.rsvpNotify}
                      </button>
                    )}
                  </div>
                ) : (
                  <div>
                    <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                      {/* Will attend */}
                      <button className="pg-btn" onClick={() => handleRsvp(true)} disabled={rsvpBusy}
                        style={{ flex:1, minWidth:120, background:"#25D366", color:"#fff",
                          display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                          fontSize:14, fontWeight:700 }}>
                        {rsvpBusy ? "…" : t.willAttend}
                      </button>
                      {/* Won't attend */}
                      <button className="pg-btn" onClick={() => handleRsvp(false)} disabled={rsvpBusy}
                        style={{ flex:1, minWidth:120, background:"transparent", color:"#374151",
                          border:"2px solid #e2e8f0", display:"flex", alignItems:"center",
                          justifyContent:"center", gap:8, fontSize:14, fontWeight:700 }}>
                        {rsvpBusy ? "…" : t.wontAttend}
                      </button>
                    </div>
                    {rsvpErr && (
                      <div style={{ marginTop:8, fontSize:12, color:"#ef4444", textAlign:"center" }}>{rsvpErr}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {!ps.rsvp_enabled && (
            <div style={card}>
              <div style={{ padding:"14px 20px" }}>
                <div style={{ fontSize:13, color:"#94a3b8", textAlign:"center" }}>{t.rsvpClosed}</div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Below-the-fold sections ── */}
      <div className="pg-below">

        {/* Dress code */}
        {(ps.dress_code_text || ps.dress_code_image_url) && (
          <div style={{ ...card, marginBottom:24, padding:"24px 28px" }}>
            <div style={sectionLabel}>{t.dressCode}</div>
            <div style={{ marginTop:12, display:"grid",
              gridTemplateColumns: ps.dress_code_image_url ? "1fr 1fr" : "1fr", gap:24, alignItems:"start" }}>
              {ps.dress_code_text && (
                <div style={{ fontSize:14, lineHeight:1.7, color:"#374151", whiteSpace:"pre-wrap" }}>
                  {ps.dress_code_text}
                </div>
              )}
              {ps.dress_code_image_url && (
                <img src={ps.dress_code_image_url} alt="Dress code" className="pg-dc-img"
                  onClick={() => openSingle(ps.dress_code_image_url)}
                  onError={e => { e.currentTarget.style.display="none"; }} />
              )}
            </div>
          </div>
        )}

        {/* Gallery */}
        {gallery.length > 0 && (
          <div style={{ ...card, marginBottom:24, padding:"24px 28px" }}>
            <div style={sectionLabel}>{t.gallery}</div>
            <div style={{ marginTop:14 }}>
              <div className={`pg-gallery-grid${gallery.length===1?" single":gallery.length===2?" two":""}`}>
                {gallery.map((url, i) => (
                  <div key={i}
                    className={`pg-gallery-item${i===0 && gallery.length>=3 ? " featured" : ""}`}
                    style={i===0 && gallery.length>=3 ? { gridColumn:"span 2" } : {}}
                    onClick={() => openGallery(i)}
                    role="button" tabIndex={0}
                    onKeyDown={e => (e.key==="Enter"||e.key===" ") && openGallery(i)}
                    aria-label={`View image ${i+1}`}>
                    <img src={url} alt=""
                      onError={e => { e.currentTarget.parentElement.style.display="none"; }} />
                    <div className="pg-gallery-expand">
                      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                        <circle cx="18" cy="18" r="17" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.5)" strokeWidth="1"/>
                        <path d="M13 13h3M13 13v3M23 23h-3M23 23v-3M23 13h-3M23 13v3M13 23h3M13 23v-3"
                          stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Hosts */}
        {hosts.filter(h => h.name).length > 0 && (
          <div style={{ ...card, marginBottom:24, padding:"24px 28px" }}>
            <div style={sectionLabel}>{t.hostsAndMC}</div>
            <div style={{ marginTop:4 }}>
              {hosts.filter(h => h.name).map((h, i) => (
                <div key={i} className="pg-host-card">
                  <div className="pg-host-photo-wrap">
                    {h.photo_url ? (
                      <img src={h.photo_url} alt={h.name} className="pg-host-photo"
                        style={{ border:`3px solid ${acc}` }}
                        onClick={() => openSingle(h.photo_url)}
                        onError={e => { e.currentTarget.style.display="none"; }} />
                    ) : (
                      <div style={{ width:110, height:110, borderRadius:"50%", background:`${acc}22`,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        fontSize:32, fontWeight:800, color:acc, border:`3px solid ${acc}40`,
                        flexShrink:0 }}>
                        {h.name.charAt(0)}
                      </div>
                    )}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:800, fontSize:18, color:"#0f172a", lineHeight:1.2 }}>{h.name}</div>
                    {h.role && (
                      <div style={{ display:"inline-block", marginTop:5, padding:"3px 10px",
                        background:`${acc}18`, color:acc, borderRadius:20,
                        fontSize:12, fontWeight:700, letterSpacing:0.4 }}>
                        {h.role}
                      </div>
                    )}
                    {h.bio && (
                      <p style={{ marginTop:10, fontSize:14, color:"#374151", lineHeight:1.7,
                        whiteSpace:"pre-wrap" }}>{h.bio}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sponsors & Vendors */}
        {(ps.sponsors || []).filter(s => s.name).length > 0 && (
          <div style={{ ...card, marginBottom:24, padding:"24px 28px" }}>
            <div style={sectionLabel}>{t.sponsors}</div>
            <div className="pg-sponsor-grid">
              {(ps.sponsors || []).filter(s => s.name).map((s, i) => {
                const badgeColor = s.category === "Vendor" ? "#f59e0b"
                  : s.category === "Partner" ? "#10b981"
                  : s.category === "Media"   ? "#6366f1"
                  : pri;
                const inner = (
                  <div key={i} className="pg-sponsor-card">
                    {s.logo_url ? (
                      <img src={s.logo_url} alt={s.name} className="pg-sponsor-logo"
                        onError={e => { e.currentTarget.style.display="none"; }} />
                    ) : (
                      <div style={{ width:72, height:72, borderRadius:8,
                        background:`${badgeColor}18`, display:"flex",
                        alignItems:"center", justifyContent:"center",
                        fontSize:26, fontWeight:800, color:badgeColor }}>
                        {s.name.charAt(0)}
                      </div>
                    )}
                    <div style={{ fontWeight:700, fontSize:14, color:"#0f172a", lineHeight:1.3 }}>{s.name}</div>
                    <span className="pg-sponsor-badge"
                      style={{ background:`${badgeColor}18`, color:badgeColor }}>
                      {s.category || "Sponsor"}
                    </span>
                    {s.description && (
                      <div style={{ fontSize:12, color:"#64748b", lineHeight:1.5 }}>{s.description}</div>
                    )}
                  </div>
                );
                return s.website
                  ? <a key={i} href={s.website} target="_blank" rel="noopener noreferrer"
                      style={{ textDecoration:"none" }}>{inner}</a>
                  : <div key={i}>{inner}</div>;
              })}
            </div>
          </div>
        )}

        {/* Venue & Directions */}
        {(hasLocation || ps.venue_description) && (
          <div style={{ ...card, marginBottom:24, padding:"24px 28px" }}>
            <div style={sectionLabel}>{t.venueAndDirections}</div>
            <div style={{ marginTop:12 }}>
              {ps.venue_description && (
                <p style={{ fontSize:14, color:"#374151", lineHeight:1.6, marginBottom:16 }}>
                  {ps.venue_description}
                </p>
              )}
              {mapCoords && (
                <div style={{ marginBottom:16 }}>
                  <LeafletMap lat={mapCoords.lat} lng={mapCoords.lng}
                    venueName={data.venue_name} venueAddress={data.venue_address} t={t} />
                </div>
              )}
              {hasLocation && (
                <a href={ps.venue_location_url} target="_blank" rel="noopener noreferrer"
                  className="pg-btn"
                  style={{ background:pri, color:"#fff", display:"inline-flex",
                    textDecoration:"none", width:"100%", boxSizing:"border-box" }}>
                  <svg width="16" height="16" viewBox="0 0 14 14" fill="none" style={{ flexShrink:0 }}>
                    <path d="M7 1a4 4 0 014 4c0 3-4 8-4 8S3 8 3 5a4 4 0 014-4z" stroke="#fff" strokeWidth="1.4"/>
                    <circle cx="7" cy="5" r="1.4" fill="#fff"/>
                  </svg>
                  {t.directions}
                </a>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Footer */}
      <footer style={{ borderTop:"1px solid #e2e8f0", background:"#fff", marginTop:8 }}>
        <div style={{ maxWidth:1100, margin:"0 auto", padding:"40px 20px 28px",
          display:"flex", flexDirection:"column", alignItems:"center", gap:28 }}>

          {/* Brand */}
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="36" height="36"
                style={{ borderRadius:10 }} />
              <span style={{ fontWeight:900, fontSize:18, color:"#0f172a", letterSpacing:"-0.3px" }}>
                Nikadi Studio
              </span>
            </div>
            <p style={{ fontSize:13, color:"#64748b", margin:0, textAlign:"center" }}>
              {t.footerTagline}
            </p>
          </div>

          {/* Links */}
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", justifyContent:"center" }}>
            <a href="https://nikadi.co.tz" target="_blank" rel="noopener noreferrer"
              style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"9px 18px",
                borderRadius:10, border:"1px solid #e2e8f0", fontSize:13, fontWeight:600,
                color:"#374151", textDecoration:"none", background:"#f8fafc",
                transition:"background 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.background="#f1f5f9"; }}
              onMouseLeave={e => { e.currentTarget.style.background="#f8fafc"; }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="6" stroke="#64748b" strokeWidth="1.3"/>
                <path d="M7 1c-1.5 2-2.5 3.8-2.5 6s1 4 2.5 6M7 1c1.5 2 2.5 3.8 2.5 6s-1 4-2.5 6M1 7h12"
                  stroke="#64748b" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              {t.footerVisit}
            </a>
            <a href="https://wa.me/255750301111" target="_blank" rel="noopener noreferrer"
              style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"9px 18px",
                borderRadius:10, border:"1px solid #25D36640", fontSize:13, fontWeight:600,
                color:"#15803d", textDecoration:"none", background:"#dcfce7",
                transition:"background 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.background="#bbf7d0"; }}
              onMouseLeave={e => { e.currentTarget.style.background="#dcfce7"; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#25D366" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              {t.footerContact}
            </a>
          </div>

          {/* Copyright */}
          <div style={{ fontSize:11, color:"#94a3b8", textAlign:"center" }}>
            &copy; {new Date().getFullYear()} Nikadi Studio. {t.footerRights}
            &ensp;&middot;&ensp;{t.poweredBy}
          </div>

        </div>
      </footer>
    </div>
  );
}
