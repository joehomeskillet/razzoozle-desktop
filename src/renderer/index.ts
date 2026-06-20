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
  gatewayEnabled?: boolean;
  gatewayCode?: string;
  gatewayJoinUrl?: string;
  gatewayQrDataUrl?: string;
  gatewayError?: string;
}

interface RazzoozleApi {
  startHosting: (opts?: { useGateway?: boolean }) => Promise<HostStartResult>;
  stopHosting: () => Promise<{ ok: boolean }>;
}

// Classic script (NOT a module) so dist/renderer/index.js runs as a plain
// <script> over file:// in the packaged app. tsc emits a CommonJS `exports`
// wrapper for any module file, which throws `exports is not defined` in the
// renderer. A global Window augmentation in a script file is a top-level
// `interface` (no `declare global`, which is module-only).
interface Window {
  razzoozle: RazzoozleApi;
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
const useGatewayEl = $<HTMLInputElement>("useGateway");
const gatewayBox = $<HTMLElement>("gatewayBox");
const gatewayQr = $<HTMLImageElement>("gatewayQr");
const gatewayUrl = $<HTMLElement>("gatewayUrl");
const gatewayCode = $<HTMLElement>("gatewayCode");
const gatewayError = $<HTMLElement>("gatewayError");

startBtn.addEventListener("click", () => {
  void (async () => {
    startBtn.disabled = true;
    startBtn.textContent = "Starting…";

    const res = await window.razzoozle.startHosting({
      useGateway: useGatewayEl.checked,
    });

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

    // Gateway (Mode B) — show the join link + QR, or the honest failure note.
    if (res.gatewayJoinUrl && res.gatewayCode) {
      if (res.gatewayQrDataUrl) gatewayQr.src = res.gatewayQrDataUrl;
      gatewayUrl.textContent = res.gatewayJoinUrl;
      gatewayCode.textContent = res.gatewayCode;
      gatewayBox.hidden = false;
    } else {
      gatewayBox.hidden = true;
    }
    if (res.gatewayError) {
      gatewayError.hidden = false;
      gatewayError.textContent = `Gateway unavailable (LAN still works): ${res.gatewayError}`;
    } else {
      gatewayError.hidden = true;
    }

    panel.classList.add("show");
    startBtn.textContent = "Hosting";
    // TODO: replace the "—" player-count placeholder with a live count once the
    // host server exposes a connected-socket count to main (socket.io has it via
    // io.engine.clientsCount; not wired into the LAN-only skeleton).
  })();
});
