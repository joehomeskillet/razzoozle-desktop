// Renderer — minimal host UI. Talks to main ONLY through window.razzoozle
// (exposed by the preload). No node, no direct IPC.

interface HostStartResult {
  ok: boolean;
  joinUrl?: string;
  lanIp?: string | null;
  port?: number;
  qrDataUrl?: string;
  warning?: string | null;
  error?: string;
}

interface RazzoozleApi {
  startHosting: () => Promise<HostStartResult>;
  stopHosting: () => Promise<{ ok: boolean }>;
}

declare global {
  interface Window {
    razzoozle: RazzoozleApi;
  }
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const startBtn = $<HTMLButtonElement>("startBtn");
const panel = $<HTMLElement>("panel");
const qr = $<HTMLImageElement>("qr");
const joinUrlEl = $<HTMLElement>("joinUrl");
const lanInfo = $<HTMLElement>("lanInfo");
const warningEl = $<HTMLElement>("warning");

startBtn.addEventListener("click", () => {
  void (async () => {
    startBtn.disabled = true;
    startBtn.textContent = "Starting…";

    const res = await window.razzoozle.startHosting();

    if (!res.ok) {
      startBtn.disabled = false;
      startBtn.textContent = "Start hosting";
      warningEl.hidden = false;
      warningEl.textContent = `Could not start: ${res.error ?? "unknown error"}`;
      panel.classList.add("show");
      return;
    }

    if (res.qrDataUrl) qr.src = res.qrDataUrl;
    joinUrlEl.textContent = res.joinUrl ?? "";
    lanInfo.textContent = res.lanIp
      ? `Host: ${res.lanIp}:${res.port}`
      : `Host: (no LAN IP)`;

    if (res.warning) {
      warningEl.hidden = false;
      warningEl.textContent = res.warning;
    } else {
      warningEl.hidden = true;
    }

    panel.classList.add("show");
    startBtn.textContent = "Hosting";
    // TODO: replace the "—" player-count placeholder with a live count once the
    // host server exposes a connected-socket count to main (socket.io has it via
    // io.engine.clientsCount; not wired into the LAN-only skeleton).
  })();
});

export {};
