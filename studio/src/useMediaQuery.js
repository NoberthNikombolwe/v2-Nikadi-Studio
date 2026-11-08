import { useCallback, useSyncExternalStore } from "react";

// Screens this narrow get the phone scanner: one view at a time (Statistics / Scan / Guests)
// with a bottom tab bar. Same width at which ScanPanel stacks its columns and the app swaps
// its menu for the bottom navigation (the 760px media query in App.jsx's CSS).
export const SCANNER_PHONE = "(max-width: 760px)";

// True while a CSS media query matches, e.g. useMediaQuery("(max-width: 760px)"), and it
// follows the window as it is resized or the phone is turned. Always false without a
// browser window (server rendering, tests).
export default function useMediaQuery(query) {
  const subscribe = useCallback((onChange) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const m = window.matchMedia(query);
    m.addEventListener?.("change", onChange);
    return () => m.removeEventListener?.("change", onChange);
  }, [query]);
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches,
    () => false,
  );
}
