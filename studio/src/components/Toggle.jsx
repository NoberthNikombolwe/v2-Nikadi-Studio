import { N } from "../lib/theme";

export const Toggle = ({ checked, onChange, label, disabled }) => (
  <label style={{display:"inline-flex",alignItems:"center",gap:8,fontSize:13,color:N.textMid,cursor:disabled ? "default" : "pointer",marginBottom:10}}>
    <input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)} style={{width:18,height:18,accentColor:"var(--nk-accent)"}} /> {label}
  </label>
);
