import { N, alpha } from "../lib/theme";

export const TONE    = { good:N.green,   info:N.sky,     warn:N.amber,   bad:N.red };
export const TONE_BG = { good:N.greenBg, info:N.navy700, warn:N.amberBg, bad:N.redBg };

// Small coloured status label
export function Pill({ tone = "info", children }) {
  return (
    <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:5,whiteSpace:"nowrap",
      color:TONE[tone], background:TONE_BG[tone], border:`1px solid ${alpha(TONE[tone],"44")}`}}>
      {children}
    </span>
  );
}
