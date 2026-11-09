import { LOGO_PATH, LOGO_VIEWBOX } from "./lib/qrLogo";

// The Nikadi "NH" mark as an inline SVG. Fills with the current text colour and sizes to
// the box it sits in, so it drops into any of the round/square logo badges. The same mark
// is drawn in the middle of card QR codes (src/lib/qrLogo.js holds its shape).
export default function Logo({ size = "72%", title }) {
  return (
    <svg viewBox={LOGO_VIEWBOX.join(" ")} width={size} height={size} fill="currentColor" role={title ? "img" : undefined}
      aria-label={title} aria-hidden={title ? undefined : true} style={{display:"block"}}>
      <path d={LOGO_PATH} />
    </svg>
  );
}
