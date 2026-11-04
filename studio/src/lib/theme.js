// Light / dark theme support. The colour values live in src/index.css as CSS variables
// (--nk-<token>) with a dark and a light set; `N` hands components var(...) references, so
// switching theme is just changing <html data-theme> — no re-render of styles needed.
//
// Preference: "system" (default — follow the browser/OS prefers-color-scheme), "light" or
// "dark", remembered in localStorage under nikadi_theme.

export const THEME_KEY = "nikadi_theme";
export const THEME_PREFS = ["system", "light", "dark"];

const TOKENS = [
  "navy900", "navy800", "navy700", "navy600", "navy500", "navy400", "navy300",
  "sky", "accent", "accentHover", "gold",
  "green", "greenBg", "red", "redBg", "amber", "amberBg", "purple", "purpleBg", "teal", "tealBg",
  "text", "textMid", "textDim", "border", "cardBg",
];

// Colour tokens for inline styles and the CSS string, e.g. N.sky → "var(--nk-sky)"
export const N = Object.freeze(Object.fromEntries(TOKENS.map(t => [t, `var(--nk-${t})`])));

// A colour at partial opacity. Replaces the old "#rrggbb" + "44" suffix trick, which
// doesn't work on var(...) colours. `a` is the old two-digit hex alpha ("44") or 0–1.
export const alpha = (color, a) => {
  const frac = typeof a === "string" ? parseInt(a, 16) / 255 : a;
  return `color-mix(in srgb, ${color} ${Math.round(frac * 100)}%, transparent)`;
};

// The saved preference, or "system" when none (or storage is unavailable)
export const getThemePref = () => {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return THEME_PREFS.includes(v) ? v : "system";
  } catch { return "system"; }
};

// Applies and remembers a preference. "system" removes data-theme so the
// prefers-color-scheme media query in index.css decides.
export const applyTheme = (pref) => {
  const root = document.documentElement;
  if (pref === "light" || pref === "dark") root.dataset.theme = pref;
  else delete root.dataset.theme;
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch { /* private mode / blocked storage: the theme still applies for this visit */ }
};

// The next preference for the header toggle: system → light → dark → system
export const nextThemePref = (pref) => THEME_PREFS[(THEME_PREFS.indexOf(pref) + 1) % THEME_PREFS.length];
