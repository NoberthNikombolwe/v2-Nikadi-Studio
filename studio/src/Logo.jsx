// The Nikadi "NH" mark as an inline SVG. Fills with the current text colour and sizes to
// the box it sits in, so it drops into any of the round/square logo badges.
export default function Logo({ size = "72%", title }) {
  return (
    <svg viewBox="22 44 116 72" width={size} height={size} fill="currentColor" role={title ? "img" : undefined}
      aria-label={title} aria-hidden={title ? undefined : true} style={{display:"block"}}>
      <path d="M122.67,49.5v24.4h-36.59l-12.04.05-.11,18.24-36.59-42.69h-12.2v60.99h12.2v-42.69l36.43,42.5c.11.12.26.2.43.2h11.94l-.03-24.4h36.58v24.4h12.2v-60.99h-12.2Z" />
    </svg>
  );
}
