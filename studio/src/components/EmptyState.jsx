import Icon from "../Icon";
import { N, alpha } from "../lib/theme";

export const TONE    = { good:N.green,   info:N.sky,     warn:N.amber,   bad:N.red };
export const TONE_BG = { good:N.greenBg, info:N.navy700, warn:N.amberBg, bad:N.redBg };

// Full-panel empty / loading / error placeholder. Every tab uses this for a consistent look.
export function EmptyState({ icon = "inbox", title, text, action, loading, tone = "info", compact }) {
  const col = loading ? N.sky : TONE[tone];
  return (
    <div className="nk-empty" style={compact ? { padding:"18px 8px" } : undefined} role={loading ? "status" : undefined}>
      <div className="nk-empty-icon" style={{color:col,background:alpha(col,"1a"),...(compact ? { width:44, height:44, fontSize:20 } : {})}}>
        <Icon n={loading ? "loader" : icon} />
      </div>
      {title && <div className="nk-empty-title">{title}</div>}
      {text && <div className="nk-empty-text">{text}</div>}
      {action && <div style={{marginTop:14,display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>{action}</div>}
    </div>
  );
}
