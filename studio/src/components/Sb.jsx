import { Children, isValidElement, Fragment } from "react";
import Icon from "../Icon";
import { N, alpha } from "../lib/theme";

// Compact icon-style action button used inside table rows.
// Text is wrapped in .nk-sb-label (tables hide it for icon-only buttons),
// and the text + title become the tooltip and accessible name.
export function Sb({ bg, col, border, children, onClick, title, disabled, label, className }) {
  const icons = [], text = [];
  const walk = (node) => Children.toArray(node).forEach(c => {
    if (isValidElement(c) && c.type === Fragment) walk(c.props.children);
    else if (isValidElement(c) && c.type === Icon) icons.push(c);
    else text.push(c);
  });
  walk(children);
  const plain = (n) => Children.toArray(n).map(c => typeof c === "string" || typeof c === "number" ? c : isValidElement(c) ? plain(c.props.children) : "").join("");
  const name = (label || plain(text)).trim();
  const tip  = name && title && title !== name ? `${name} — ${title}` : (name || title);
  const hasText = text.some(c => typeof c !== "string" || c.trim());
  return (
    <button type="button" className={`nk-btn-sm${icons.length ? (hasText ? " has-icon" : " icon-only") : ""}${className ? ` ${className}` : ""}`} onClick={onClick} title={tip} aria-label={tip} disabled={disabled}
      style={{ background:bg, color:col, borderColor:border||alpha(col,"44"), opacity:disabled?0.5:1 }}>
      {icons}
      {hasText && <span className="nk-sb-label">{text}</span>}
    </button>
  );
}
