// Starts and stops the door scanner's camera so it is always really released.
//
// A phone lets only one page hold the camera. The old scanner called the QR library's
// stop() from inside its own "code found" callback; when a card was read before the camera
// had finished starting, that stop() failed quietly and the camera kept running hidden in
// the background — so "Scan next card" could not open it again until the screen was locked.
// This controller fixes the order of things:
//   - only the first code of a scan counts (the camera reads several frames a second)
//   - stopping waits for a start still in progress, then stops the library, then calls
//     `release` (which stops any camera track left on the page)
//   - a new start waits until the previous camera is fully released
//   - stopping while a start is still loading cancels that start
//
//   createCamera({ create, release, nextFrame })
//     create()    → Promise<instance>  e.g. new Html5Qrcode(boxId)   (start / stop / clear / getState)
//     release()   → stops leftover tracks and empties the camera box
//     nextFrame() → Promise, resolves once the box is on screen (requestAnimationFrame)
//   camera.start({ constraints, config, onCode }) → "started" | "cancelled" | "busy" (throws if it can't start)
//   camera.stop() → Promise (safe to call any time, any number of times)

export const CAM_SCANNING = 2;   // Html5QrcodeScannerState.SCANNING
export const CAM_PAUSED = 3;     // Html5QrcodeScannerState.PAUSED

export const createCamera = ({ create, release = () => {}, nextFrame = () => Promise.resolve() }) => {
  let instance = null;     // the library object of the current scan
  let starting = null;     // promise of a start in progress
  let stopping = null;     // promise of a release in progress
  let session = 0;         // bumped by every start and stop, so a stale start knows it was cancelled
  let handled = false;     // this scan has already read a code

  const stop = () => {
    session++;
    if (stopping) return stopping;
    const s = instance;
    instance = null;
    stopping = (async () => {
      try { await starting; } catch { /* the start failed — nothing is running */ }
      if (s) {
        try {
          const st = typeof s.getState === "function" ? s.getState() : null;
          if (st === CAM_SCANNING || st === CAM_PAUSED || s.isScanning) await s.stop();
        } catch { /* already stopped */ }
        try { s.clear(); } catch { /* nothing to clear */ }
      }
      try { release(); } catch { /* the box is gone */ }
    })().finally(() => { stopping = null; });
    return stopping;
  };

  const start = async ({ constraints, config, onCode }) => {
    if (starting) return "busy";
    const my = ++session;
    handled = false;
    let s = null, mine = null;
    try {
      if (stopping) await stopping;           // the last scan's camera must be fully released first
      await nextFrame();
      if (session !== my) return "cancelled";
      release();
      s = await create();
      if (session !== my) return "cancelled"; // stopped while loading: this instance never started
      instance = s;
      mine = starting = s.start(constraints, config, (text) => {
        if (handled || session !== my) return;
        handled = true;
        setTimeout(() => { stop(); }, 0);     // never stop from inside the library's own callback
        onCode(text);
      }, () => {});
      await starting;
      return session === my ? "started" : "cancelled";
    } catch (e) {
      if (session !== my) return "cancelled"; // stopped on purpose while starting
      if (instance === s) instance = null;
      try { s?.clear(); } catch { /* nothing to clear */ }
      try { release(); } catch { /* the box is gone */ }
      throw e;
    } finally {
      if (starting === mine) starting = null;   // a newer start keeps its own
    }
  };

  return { start, stop, get busy() { return !!starting; } };
};
