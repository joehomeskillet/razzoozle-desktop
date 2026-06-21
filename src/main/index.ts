// Electron main process — Razzoozle Desktop, Mode A "LAN Direct".
//
// Lifecycle + IPC. The renderer asks main to "start hosting"; main detects the
// LAN IPv4, boots the reused Razzoozle server (local-server.ts), builds the
// join URL (http://<lan-ip>:<port>/ — a TOP-LEVEL URL the phone navigates to,
// per F4), generates a QR for it, and returns it all to the renderer.

import { app, BrowserWindow, ipcMain, Menu, screen, Tray } from "electron";
import { autoUpdater } from "electron-updater";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";

import { detectLanIpv4, buildHostCandidates } from "./reachability";
import { startHost, type RunningHost } from "./local-server";
import { GatewayClient } from "./gateway-client";
import { ElectronTokenStore } from "./token-store";
import { ManagerPasswordStore } from "./manager-password";
import {
  DEFAULT_HOST_PORT,
  HEARTBEAT_INTERVAL_MS,
  type HostCandidate,
  DEFAULT_GATEWAY_URL,
} from "./protocol";
import { startTunnel, wsBaseFromHttp, type TunnelHandle } from "./tunnel-client";
import { RAZZOOZLE_LOGO_SVG } from "./brand-logo";
import { buildStyledQrSvg } from "./styled-qr";

let mainWindow: BrowserWindow | null = null;
let running: RunningHost | null = null;

// Active gateway session (Mode B). Null when the gateway is disabled or stopped.
interface GatewaySession {
  client: GatewayClient;
  sessionId: string;
  hostToken: string;
  tunnel?: TunnelHandle;
  joinCode: string;
  joinUrl: string;
  candidates: HostCandidate[];
  heartbeatTimer: ReturnType<typeof setInterval>;
}
let gatewaySession: GatewaySession | null = null;

// Gateway is OPT-IN. LAN-only Mode A must work with it disabled — hosting must
// never depend on the gateway being reachable. Default OFF; flip with
// RAZZOOZLE_GATEWAY_ENABLED=1 (env, dev) or the Tray toggle (persisted in
// config.json). See getUseGateway() below.

// Persisted gateway config.
interface Config {
  gatewayUrl?: string;
  /** Persisted opt-in for outside-LAN remote-join via the gateway (Mode B). */
  useGateway?: boolean;
}

function getConfigPath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

function readConfig(): Config {
  try {
    const data = fs.readFileSync(getConfigPath(), "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function writeConfig(config: Config): void {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to write config:", err);
  }
}

function getGatewayUrl(): string {
  const env = process.env.RAZZOOZLE_GATEWAY_URL?.trim();
  if (env) return env;
  const config = readConfig();
  if (config.gatewayUrl) return config.gatewayUrl;
  return DEFAULT_GATEWAY_URL;
}

/**
 * Persisted gateway opt-in. The env override (RAZZOOZLE_GATEWAY_ENABLED=1) still
 * forces ON for dev; otherwise the value persisted by the Tray toggle wins.
 */
function getUseGateway(): boolean {
  // Default ON: the gateway is the public join path (gw.razzoozle.xyz). Force
  // off with RAZZOOZLE_GATEWAY_ENABLED=0 or by persisting useGateway:false (tray).
  if (process.env.RAZZOOZLE_GATEWAY_ENABLED === "1") return true;
  if (process.env.RAZZOOZLE_GATEWAY_ENABLED === "0") return false;
  return readConfig().useGateway !== false;
}

function setUseGateway(value: boolean): void {
  const config = readConfig();
  config.useGateway = value;
  writeConfig(config);
}

// Result handed back to the renderer after a successful "start hosting".
export interface HostStartResult {
  ok: boolean;
  /** http://<lan-ip>:<port>/ — the URL the phone navigates to (F4). */
  joinUrl?: string;
  lanIp?: string | null;
  port?: number;
  /** Data-URL PNG of the QR encoding the LAN joinUrl. */
  qrDataUrl?: string;
  /** Non-fatal warning (e.g. only loopback found). */
  warning?: string | null;
  /** Set when start failed. */
  error?: string;

  // ── Gateway (Mode B) — present only when the gateway is enabled + reachable.
  /** Was the gateway enabled for this start? */
  gatewayEnabled?: boolean;
  /** Short join code, e.g. "K7QPMX". */
  gatewayCode?: string;
  /** https://gw.razzoozle.xyz/j/<CODE> — the link a remote player opens. */
  gatewayJoinUrl?: string;
  /** Data-URL PNG of the QR encoding gatewayJoinUrl. */
  gatewayQrDataUrl?: string;
  /** Set when gateway registration was attempted but failed (non-fatal). */
  gatewayError?: string;
}

/**
 * Create the main window: frameless cream + titleBarOverlay on Win11, manager
 * endpoint auto-loaded.
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    // Window/taskbar icon (Rahoot lightning mark). Resolved dir-relative the same
    // way as `preload` below: __dirname is dist/main in dev and packaged, so this
    // points at dist/icon.ico (copied by scripts/copy-assets.mjs, shipped via
    // electron-builder `files: dist/**/*`).
    icon: path.join(__dirname, "../icon.ico"),
    backgroundColor: "#faf7f0", // opaque cream
    titleBarStyle: "hidden", // frameless (Win11 shows native controls)
    titleBarOverlay: {
      color: "#faf7f0", // cream background behind window controls
      symbolColor: "#6d28d9", // purple controls (Razzoozle brand)
      height: 40, // control bar height
    },
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Remove menu bar entirely
  Menu.setApplicationMenu(null);
  mainWindow.on("closed", () => (mainWindow = null));
}

/**
 * Write or update game.json with the manager password so the socket can
 * authenticate. Merges with existing config if present.
 */
function writeGameConfig(configPath: string, managerPassword: string): void {
  const gameJsonPath = path.join(configPath, "game.json");

  // Read existing config if present
  let config: Record<string, unknown> = {};
  if (fs.existsSync(gameJsonPath)) {
    try {
      const existing = fs.readFileSync(gameJsonPath, "utf8");
      config = JSON.parse(existing);
    } catch (err) {
      console.warn("Failed to read existing game.json; starting fresh:", err);
      config = {};
    }
  }

  // Set/overwrite the managerPassword
  config.managerPassword = managerPassword;

  // Write back
  try {
    fs.writeFileSync(gameJsonPath, JSON.stringify(config, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to write game.json:", err);
    throw err;
  }
}

/** Stable opaque host install id (§2.2, "h_…"). Persisted under userData. */
function getHostId(): string {
  const file = path.join(app.getPath("userData"), "host-id");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {
    /* first run */
  }
  const id = `h_${randomBytes(8).toString("hex")}`;
  try {
    fs.writeFileSync(file, id, "utf8");
  } catch {
    /* non-fatal: fall back to an in-memory id */
  }
  return id;
}

/**
 * Register with the gateway and start the heartbeat loop. Best-effort: any
 * failure is returned as gatewayError and does NOT abort hosting (LAN still
 * works). Re-PATCHes (replace) when the candidate set changes between beats.
 */
async function startGatewaySession(
  port: number,
): Promise<{ session?: GatewaySession; error?: string }> {
  try {
    const client = new GatewayClient({
      baseUrl: getGatewayUrl(),
      tokenStore: new ElectronTokenStore(),
    });
    const candidates = await buildHostCandidates({ port });
    if (candidates.length === 0) {
      return { error: "No reachable candidate to advertise (no LAN/public address)." };
    }
    const reg = await client.register({
      hostId: getHostId(),
      appVersion: app.getVersion(),
      candidates,
    });

    const session: GatewaySession = {
      client,
      sessionId: reg.sessionId,
      hostToken: reg.hostToken,
      joinCode: reg.joinCode,
      joinUrl: reg.joinUrl,
      candidates,
      heartbeatTimer: setInterval(() => {
        void heartbeatTick(session, port);
      }, HEARTBEAT_INTERVAL_MS),
    };
    session.heartbeatTimer.unref?.();

    // Start the R0 relay tunnel: best-effort, never blocks gateway registration.
    try {
      session.tunnel = startTunnel({
        gatewayWsBase: wsBaseFromHttp(getGatewayUrl()),
        sessionId: reg.sessionId,
        hostToken: reg.hostToken,
        hostPort: port,
        logger: (msg: string) => console.log(`[tunnel] ${msg}`),
      });
    } catch (err) {
      console.error(
        "[tunnel] startup failed:",
        err instanceof Error ? err.message : String(err),
      );
    }

    return { session };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** One heartbeat: re-detect candidates and PATCH (replace) if they changed. */
async function heartbeatTick(session: GatewaySession, port: number): Promise<void> {
  try {
    const next = await buildHostCandidates({ port });
    const changed =
      next.length > 0 && !sameCandidateUrls(session.candidates, next);
    if (changed) {
      await session.client.heartbeat(session.sessionId, session.hostToken, {
        candidateOp: "replace",
        candidates: next,
      });
      session.candidates = next;
    } else {
      await session.client.heartbeat(session.sessionId, session.hostToken);
    }
  } catch (err) {
    // Heartbeat failures are logged but never crash the host — the LAN path is
    // independent of the gateway.
    console.error(
      "[gateway] heartbeat failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Compare candidate sets by (kind,url) — order-independent. */
function sameCandidateUrls(a: HostCandidate[], b: HostCandidate[]): boolean {
  if (a.length !== b.length) return false;
  const key = (c: HostCandidate) => `${c.kind}|${c.url}`;
  const sa = new Set(a.map(key));
  return b.every((c) => sa.has(key(c)));
}

/** Stop the heartbeat loop and unregister (DELETE) from the gateway. */
async function stopGatewaySession(): Promise<void> {
  if (!gatewaySession) return;
  const s = gatewaySession;
  gatewaySession = null;

  // Close the tunnel BEFORE unregistering.
  try {
    s.tunnel?.close();
  } catch (err) {
    console.error(
      "[tunnel] close failed:",
      err instanceof Error ? err.message : String(err),
    );
  }

  clearInterval(s.heartbeatTimer);
  try {
    await s.client.unregister(s.sessionId, s.hostToken);
  } catch (err) {
    console.error(
      "[gateway] unregister failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

// IPC: start hosting. Idempotent-ish — if already running, returns current info.
// `useGateway` from the renderer toggle overrides the env default.
ipcMain.handle(
  "host:start",
  async (_evt, args?: { useGateway?: boolean }): Promise<HostStartResult> => {
    try {
      const lan = detectLanIpv4();
      const port = DEFAULT_HOST_PORT;
      const useGateway = args?.useGateway ?? getUseGateway();

      if (!running) {
        // Persist the reused server's data under the app's userData dir, never in
        // the Razzoozle source tree. host.log captures socket diagnostics (a
        // packaged Windows app has no visible console).
        const logPath = path.join(app.getPath("userData"), "host.log");
        try {
          fs.writeFileSync(logPath, `host:start ${new Date().toISOString()}\n`);
        } catch {
          /* ignore */
        }
        running = await startHost({
          port,
          configPath: app.getPath("userData"),
          logPath,
        });
      }

      // The QR + URL must point at the host's OWN http origin (F4). If we only
      // have loopback, the URL still works locally but a phone can't reach it —
      // we surface lan.warning so the UI is honest about it.
      const ipForUrl = lan.ip ?? "127.0.0.1";
      const joinUrl = `http://${ipForUrl}:${port}/`;
      const qrDataUrl = await QRCode.toDataURL(joinUrl, { margin: 1, width: 320 });

      const result: HostStartResult = {
        ok: true,
        joinUrl,
        lanIp: lan.ip,
        port,
        qrDataUrl,
        warning: lan.warning,
        gatewayEnabled: useGateway,
      };

      // Mode B: register with the gateway so remote players can discover us.
      // Best-effort — a gateway failure never blocks LAN hosting.
      if (useGateway && !gatewaySession) {
        const { session, error } = await startGatewaySession(port);
        if (session) {
          gatewaySession = session;
        } else if (error) {
          result.gatewayError = error;
        }
      }
      if (gatewaySession) {
        result.gatewayCode = gatewaySession.joinCode;
        result.gatewayJoinUrl = gatewaySession.joinUrl;
        result.gatewayQrDataUrl = await QRCode.toDataURL(gatewaySession.joinUrl, {
          margin: 1,
          width: 320,
        });
      }

      return result;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
);

ipcMain.handle("host:stop", async (): Promise<{ ok: boolean }> => {
  // Unregister from the gateway BEFORE tearing down the local server (§16.9).
  await stopGatewaySession();
  if (running) {
    await running.stop();
    running = null;
  }
  return { ok: true };
});

// IPC: config getter/setter for gateway URL
ipcMain.handle("config:getGateway", (): string => {
  return getGatewayUrl();
});

ipcMain.handle(
  "config:setGateway",
  (_evt, url: string): { ok: boolean; error?: string } => {
    try {
      // Validate URL format. HTTPS-only: the rendezvous carries a Bearer token,
      // so a plaintext gateway URL is rejected (no token over http).
      if (!url.match(/^https:\/\//i)) {
        return { ok: false, error: "URL must start with https://" };
      }
      const config = readConfig();
      config.gatewayUrl = url;
      writeConfig(config);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  },
);

/**
 * Auto-login injection script: polls for password input, submits it when found.
 * Idempotent — only acts when a password field is present. Interpolates the
 * password safely via JSON.stringify to avoid injection.
 */
function createAutoLoginScript(
  password: string,
  reserveRightPx: number,
  joinBase: string,
  lanOrigin: string,
  qrSvg: string | null,
  logoSvg: string,
): string {
  // reserveRightPx is the DPI-scaled width the native window controls occupy at
  // the current display scale factor — keeps the drag strip clear of the
  // manager's top-right controls (DE / Logout) at 125%/150% Windows scale.
  const reserve = Number.isFinite(reserveRightPx) ? Math.ceil(reserveRightPx) : 138;
  return `
(function autoLogin() {
  // Game-hook: the lobby reads window.__RAZZ_JOIN_BASE as buildJoinUrl's base.
  // When the gateway is on AND a session exists this is the gateway session
  // joinUrl (remote-reachable); otherwise the active LAN http origin. Harmless
  // until the game wires it up. Set unconditionally (outside the auto-login
  // latch) so a re-inject after navigation keeps it current.
  window.__RAZZ_JOIN_BASE = ${JSON.stringify(joinBase)};
  if (window.__razzAutoLoginDone) return;
  const password = ${JSON.stringify(password)};
  let observer, interval;
  function fill() {
    if (!location.pathname.startsWith('/manager')) return;
    const inp = document.querySelector('input[type="password"]');
    if (!inp) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    if (setter) {
      setter.call(inp, password);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const form = inp.closest('form');
    if (form && form.requestSubmit) {
      form.requestSubmit();
    } else {
      const btn = document.querySelector('button[type="submit"], form button');
      if (btn) btn.click();
    }
    window.__razzAutoLoginDone = true;
    if (observer) observer.disconnect();
    if (interval) clearInterval(interval);
  }
  fill();
  observer = new MutationObserver(() => fill());
  observer.observe(document, { childList: true, subtree: true });
  interval = setInterval(fill, 250);

  // CSS shim for app titlebar spacing + desktop-only hides. Re-applied (not
  // appended) on every injection so the drag-strip reserve tracks the current
  // DPI scale factor (recomputed in the did-navigate-in-page re-inject path).
  var style = document.querySelector('[data-razzlogin-css-shim]');
  if (!style) {
    style = document.createElement('style');
    style.dataset.razzloginCssShim = '';
    document.head.appendChild(style);
  }
  style.textContent = '.app-titlebar-shim { position: fixed; top: 0; left: 0; right: ${reserve}px; height: 40px; -webkit-app-region: drag; z-index: 9999; } .app-titlebar-shim button, .app-titlebar-shim input { -webkit-app-region: no-drag; }'
    /* desktop: ComfyUI not bundled, hide image-gen */
    + ' input[placeholder^="Beschreibe das Bild"], input[placeholder^="Beschreibe das Bild"] ~ div { display: none !important; }'
    /* desktop: hide Satellit/Vorschläge/Laufende Spiele */
    + ' [id$="-tab-satellite"],[id$="-tab-submissions"],[id$="-tab-running"]{display:none !important;}'
    /* clear native window controls via Window Controls Overlay env */
    + ' .console-shell header{padding-right:max(1.5rem,calc(100vw - env(titlebar-area-width,100vw))) !important;}'
    + ' section[style*="--game-fg"] .justify-between.p-4{padding-right:max(1rem,calc(100vw - env(titlebar-area-width,100vw))) !important;}';
  if (!document.querySelector('[data-razzlogin-titlebar]')) {
    var shim = document.createElement('div');
    shim.className = 'app-titlebar-shim';
    shim.dataset.razzloginTitlebar = '';
    document.body.insertBefore(shim, document.body.firstChild);
  }

  // Lobby DOM patch (the game is read-only): render the Razzoozle wordmark in
  // place of the plain title text, and — when the gateway is on — show the
  // gateway join URL instead of the LAN origin and swap the QR to match. All
  // idempotent + best-effort (a failure never affects hosting). Built via the
  // DOM API (DOMParser/replaceChildren/textContent), no innerHTML.
  window.__razzLobbyData = {
    lan: ${JSON.stringify(lanOrigin)},
    url: ${JSON.stringify(joinBase)},
    qr: ${qrSvg ? JSON.stringify(qrSvg) : "null"},
    logo: ${JSON.stringify(logoSvg)}
  };
  window.__razzPatchLobby = function () {
    try {
      var d = window.__razzLobbyData; if (!d) return;
      // (1) logo: replace the default "Razzoozle" title text with the wordmark
      if (d.logo) {
        var hs = document.querySelectorAll('h1');
        for (var i = 0; i < hs.length; i++) {
          var h = hs[i];
          if (h.dataset.razzLogo) continue;
          if ((h.textContent || '').trim() !== 'Razzoozle') continue;
          try {
            var ls = new DOMParser().parseFromString(d.logo, 'image/svg+xml').documentElement;
            ls.removeAttribute('width'); ls.removeAttribute('height');
            ls.style.height = 'clamp(40px,8vh,64px)';
            ls.style.width = 'auto';
            ls.style.display = 'block';
            ls.style.margin = '0 auto';
            h.replaceChildren(ls);
            h.dataset.razzLogo = '1';
          } catch (e) {}
        }
      }
      // (2) join URL + (3) QR — only when the gateway is on (url differs from LAN)
      if (d.url && d.url !== d.lan) {
        var ns = document.querySelectorAll('p, span, a');
        for (var j = 0; j < ns.length; j++) {
          var el = ns[j];
          if (el.children.length === 0 && (el.textContent || '').trim() === d.lan) {
            el.textContent = d.url;
          }
        }
        if (d.qr) {
          var qd = document.querySelectorAll('.h-auto.w-auto, [class~="size-56"]');
          for (var k = 0; k < qd.length; k++) {
            var c = qd[k];
            if (c.dataset.razzQr === d.url) continue;
            if (!c.querySelector('svg')) continue;
            try {
              var qs = new DOMParser().parseFromString(d.qr, 'image/svg+xml').documentElement;
              qs.setAttribute('width', '100%'); qs.setAttribute('height', '100%');
              c.replaceChildren(qs); c.dataset.razzQr = d.url;
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
  };
  window.__razzPatchLobby();
  if (!window.__razzLobbyObs) {
    window.__razzLobbyObs = new MutationObserver(function () {
      if (window.__razzLobbyRAF) return;
      window.__razzLobbyRAF = requestAnimationFrame(function () {
        window.__razzLobbyRAF = 0; window.__razzPatchLobby();
      });
    });
    window.__razzLobbyObs.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(function () { window.__razzPatchLobby(); }, 1500);
  }
})();
`;
}

/**
 * DPI-aware width (px) to reserve on the right of the drag strip for the native
 * window controls. 138 logical px scaled by the current display's scaleFactor.
 */
function computeReserveRightPx(): number {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return 138;
    const sf = screen.getDisplayMatching(mainWindow.getBounds()).scaleFactor || 1;
    return Math.ceil(138 * sf);
  } catch {
    return 138;
  }
}

/**
 * Inject the auto-login + drag-strip + image-gen-hide script, recomputing the
 * DPI reserve at injection time. Used by both did-finish-load and the
 * did-navigate-in-page re-inject path.
 */
async function injectManagerScript(managerPassword: string): Promise<void> {
  const joinBase = resolveJoinBase();
  const lanIp = detectLanIpv4().ip ?? "127.0.0.1";
  const lanOrigin = `http://${lanIp}:${DEFAULT_HOST_PORT}`;
  // Regenerate a QR for the gateway join URL only when the gateway is on
  // (joinBase differs from the LAN origin). On-brand dark = secondary ink-violet.
  let qrSvg: string | null = null;
  if (joinBase !== lanOrigin) {
    try {
      qrSvg = buildStyledQrSvg(joinBase);
    } catch (err) {
      console.error("[lobby-patch] QR generation failed:", err);
    }
  }
  const script = createAutoLoginScript(
    managerPassword,
    computeReserveRightPx(),
    joinBase,
    lanOrigin,
    qrSvg,
    RAZZOOZLE_LOGO_SVG,
  );
  mainWindow?.webContents
    .executeJavaScript(script)
    .catch((err) => console.error("[autologin] Injection failed:", err));
}

/**
 * The base URL the game lobby should use for join links (window.__RAZZ_JOIN_BASE).
 * Prefer the gateway session joinUrl when the gateway is enabled AND a session
 * exists (remote-reachable); otherwise the active LAN http origin
 * (http://<lanIp>:<port>), falling back to loopback when no LAN exists.
 */
function resolveJoinBase(): string {
  const port = DEFAULT_HOST_PORT;
  if (getUseGateway() && gatewaySession?.joinUrl) {
    return gatewaySession.joinUrl;
  }
  const lanIp = detectLanIpv4().ip ?? "127.0.0.1";
  return `http://${lanIp}:${port}`;
}

let tray: Tray | null = null;

/**
 * Start the gateway session if enabled + not already running. Best-effort: a
 * gateway failure never blocks LAN hosting. Returns true once a session exists.
 */
async function ensureGatewaySession(port: number): Promise<boolean> {
  if (gatewaySession) return true;
  const { session, error } = await startGatewaySession(port);
  if (session) {
    gatewaySession = session;
    return true;
  }
  if (error) console.error("[gateway] session start failed:", error);
  return false;
}

/**
 * Inject a small dismissible "connection info" banner into the manager page:
 * the LAN join URL and, if a gateway session exists, the gateway join URL+code.
 * Main-process only (executeJavaScript) — no preload, no game collision.
 */
function showConnectionInfoBanner(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const lan = detectLanIpv4();
  const lanUrl = `http://${lan.ip ?? "127.0.0.1"}:${DEFAULT_HOST_PORT}/`;
  const gw = gatewaySession
    ? { url: gatewaySession.joinUrl, code: gatewaySession.joinCode }
    : null;
  const payload = JSON.stringify({ lanUrl, gw });
  const script = `
(function () {
  var data = ${payload};
  var old = document.getElementById('razz-conn-info');
  if (old) old.remove();
  // Built entirely via safe DOM APIs (textContent / setAttribute) — no innerHTML,
  // so the interpolated URLs/code can never inject markup into the manager page.
  var box = document.createElement('div');
  box.id = 'razz-conn-info';
  box.style.cssText = 'position:fixed;top:48px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#faf7f0;color:#333;border:1px solid #6d28d9;border-radius:10px;padding:14px 18px;box-shadow:0 6px 24px rgba(0,0,0,.18);font-family:sans-serif;font-size:14px;max-width:90vw;';
  function row(text) {
    var d = document.createElement('div');
    d.style.marginBottom = '6px';
    if (text != null) d.textContent = text;
    return d;
  }
  function link(url) {
    var a = document.createElement('a');
    a.setAttribute('href', url);
    a.style.color = '#6d28d9';
    a.textContent = url;
    return a;
  }
  var title = row('Verbindungs-Info');
  title.style.fontWeight = '700';
  title.style.marginBottom = '8px';
  box.appendChild(title);
  var lanRow = row('LAN-Beitritt: ');
  lanRow.appendChild(link(data.lanUrl));
  box.appendChild(lanRow);
  if (data.gw) {
    var gwRow = row('Remote-Beitritt: ');
    gwRow.appendChild(link(data.gw.url));
    box.appendChild(gwRow);
    var codeRow = row('Code: ');
    var codeStrong = document.createElement('strong');
    codeStrong.textContent = data.gw.code;
    codeRow.appendChild(codeStrong);
    box.appendChild(codeRow);
  } else {
    var offRow = row('Remote-Beitritt (Gateway) ist deaktiviert.');
    offRow.style.color = '#888';
    box.appendChild(offRow);
  }
  var close = document.createElement('button');
  close.textContent = 'Schließen';
  close.style.cssText = 'margin-top:6px;background:#6d28d9;color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;-webkit-app-region:no-drag';
  close.onclick = function () { box.remove(); };
  box.appendChild(close);
  document.body.appendChild(box);
})();
`;
  mainWindow.webContents
    .executeJavaScript(script)
    .catch((err) => console.error("[conn-info] inject failed:", err));
}

/**
 * Build the system Tray (main-process control surface — NO preload, NO second
 * window). Toggles the persisted gateway opt-in and live-(re)starts/stops the
 * session, shows connection info, and quits.
 */
function buildTray(managerPort: number): void {
  if (tray) return;
  try {
    tray = new Tray(path.join(__dirname, "../icon.ico"));
  } catch (err) {
    console.error("[tray] could not create tray:", err);
    return;
  }
  tray.setToolTip("Razzoozle");
  const rebuildMenu = (): void => {
    const menu = Menu.buildFromTemplate([
      {
        label: "Remote-Beitritt (Gateway)",
        type: "checkbox",
        checked: getUseGateway(),
        click: (item) => {
          void (async () => {
            const enabled = item.checked;
            setUseGateway(enabled);
            if (enabled) {
              await ensureGatewaySession(managerPort);
            } else {
              await stopGatewaySession();
            }
            rebuildMenu();
          })();
        },
      },
      {
        label: "Verbindungs-Info anzeigen",
        click: () => showConnectionInfoBanner(),
      },
      { type: "separator" },
      { label: "Beenden", click: () => app.quit() },
    ]);
    tray?.setContextMenu(menu);
  };
  rebuildMenu();
}

// Single-instance lock: a second launch must NOT spawn a second host (which
// would hit port 7777 EADDRINUSE and brick). Focus the existing window instead.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    createWindow();

  // Get or generate the manager password (secure, per-installation)
  const passwordStore = new ManagerPasswordStore();
  const managerPassword = passwordStore.getPassword();

  // Write game.json so the socket uses this password
  const configPath = app.getPath("userData");
  try {
    fs.mkdirSync(configPath, { recursive: true });
    writeGameConfig(configPath, managerPassword);
  } catch (err) {
    console.error("Failed to set up game config:", err);
    if (mainWindow) {
      const dataUrl = `data:text/html,<html><body style="font-family:sans-serif;padding:20px;background:#faf7f0;color:#333"><h1>Setup Error</h1><p>${encodeURIComponent(
        `Failed to write game config: ${err instanceof Error ? err.message : String(err)}`,
      )}</p></body></html>`;
      await mainWindow
        .loadURL(dataUrl)
        .catch((e) => console.error("[error-page] load failed:", e));
      mainWindow.show();
    }
    return;
  }

  // Start the local server and load the manager endpoint
  try {
    const port = DEFAULT_HOST_PORT;
    const logPath = path.join(configPath, "host.log");
    running = await startHost({
      port,
      configPath,
      logPath,
    });

    // Mode B: register with the gateway when the persisted opt-in is on. The
    // direct auto-start path otherwise never registers (LAN still works either
    // way — gateway failures never block hosting).
    if (getUseGateway()) {
      await ensureGatewaySession(port);
    }

    // System tray control surface (toggle gateway / show info / quit). Main-
    // process only — no preload, no second BrowserWindow, no game collision.
    buildTray(port);

    // Load the manager from the ACTIVE LAN IP so window.location.origin becomes
    // that LAN address — the game lobby's join URL + QR then encode the direct-
    // LAN address (reachable by same-Wi-Fi players), not loopback. The front
    // server binds 0.0.0.0, so the host can load its own LAN IP. Falls back to
    // loopback when no LAN exists. The nav-guard below is pathname-based
    // (origin-agnostic) and reuses this SAME host, so a guard redirect never
    // flips the origin back to 127.0.0.1.
    const lanIp = detectLanIpv4().ip;
    const host = lanIp ?? '127.0.0.1';
    const managerUrl = `http://${host}:${port}/manager`;

    // Navigation guard helper
    const isHostRoute = (p: string) => p.startsWith('/manager') || p.startsWith('/party/manager') || p.startsWith('/r/');

    // Add will-navigate guard
    mainWindow!.webContents.on('will-navigate', (e, url) => {
      try {
        const p = new URL(url).pathname;
        if (!isHostRoute(p)) {
          e.preventDefault();
          mainWindow?.webContents
            .loadURL(managerUrl)
            .catch((reloadErr) => console.error('[nav-guard] reload failed:', reloadErr));
        }
      } catch (e) {
        console.error('[nav-guard]', e);
      }
    });

    // Deny window open requests
    mainWindow!.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // Register listeners BEFORE loadURL
    mainWindow!.webContents.on('did-finish-load', () => {
      injectManagerScript(managerPassword);
    });

    mainWindow!.webContents.on('did-navigate-in-page', async () => {
      try {
        const gp = new URL(mainWindow!.webContents.getURL()).pathname;
        if (!isHostRoute(gp)) {
          mainWindow!.webContents
            .loadURL(managerUrl)
            .catch((reloadErr) => console.error('[nav-guide] reload failed:', reloadErr));
          return;
        }
        if (gp === '/manager/config') {
          mainWindow!.show();
        }
        // Bare /manager is the post-logout login form. The session-wide auto-
        // login latch must reset so the next login screen is filled again;
        // otherwise the host is stuck on an empty login form forever. NOT for
        // /manager/config (already past login).
        if (gp === '/manager') {
          await mainWindow!.webContents
            .executeJavaScript('window.__razzAutoLoginDone = false')
            .catch(() => {});
        }
      } catch (e) {
        console.error('[nav-guard]', e);
      }
      injectManagerScript(managerPassword);
    });

    // Arm the fallback show-timer BEFORE loadURL so a loadURL rejection (which
    // jumps to the catch) can't leave the window invisible forever.
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show();
      }
    }, 7000);

    await mainWindow!.loadURL(managerUrl);

  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : String(err);
    console.error("Failed to start host:", err);
    if (mainWindow) {
      const dataUrl = `data:text/html,<html><body style="font-family:sans-serif;padding:20px;background:#faf7f0;color:#333"><h1>Start Error</h1><p>${encodeURIComponent(
        errorMsg,
      )}</p><pre style="background:#f0f0f0;padding:10px;overflow:auto;max-height:300px;font-size:12px">${encodeURIComponent(
        errorMsg,
      )}</pre></body></html>`;
      await mainWindow
        .loadURL(dataUrl)
        .catch((e) => console.error("[error-page] load failed:", e));
      mainWindow.show();
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // electron-updater (F3): only in the packaged app, GitHub provider already
  // configured in electron-builder.yml. allowPrerelease so beta tags are seen.
  // We notify, never force quitAndInstall without the user's involvement.
  if (app.isPackaged) {
    const updateLogPath = path.join(app.getPath("userData"), "host.log");
    const updLog = (line: string): void => {
      console.log(line);
      try {
        fs.appendFileSync(updateLogPath, `${new Date().toISOString()} ${line}\n`);
      } catch {
        /* logging must never throw */
      }
    };
    autoUpdater.allowPrerelease = true;
    autoUpdater.on("update-available", (info) =>
      updLog(`[updater] update-available ${info?.version ?? ""}`),
    );
    autoUpdater.on("update-downloaded", (info) =>
      updLog(`[updater] update-downloaded ${info?.version ?? ""}`),
    );
    autoUpdater.on("error", (err) =>
      updLog(`[updater] error ${err instanceof Error ? err.message : String(err)}`),
    );
    autoUpdater.checkForUpdatesAndNotify().catch((err) =>
      updLog(`[updater] check failed ${err instanceof Error ? err.message : String(err)}`),
    );
  }
  });
}

app.on("window-all-closed", () => {
  void (async () => {
    await stopGatewaySession();
    if (running) {
      await running.stop();
      running = null;
    }
    if (process.platform !== "darwin") app.quit();
  })();
});
