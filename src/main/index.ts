// Electron main process — Razzoozle Desktop, Mode A "LAN Direct".
//
// Lifecycle + IPC. The renderer asks main to "start hosting"; main detects the
// LAN IPv4, boots the reused Razzoozle server (local-server.ts), builds the
// join URL (http://<lan-ip>:<port>/ — a TOP-LEVEL URL the phone navigates to,
// per F4), generates a QR for it, and returns it all to the renderer.

import { app, BrowserWindow, ipcMain, Menu } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";

import { detectLanIpv4, buildHostCandidates } from "./reachability";
import { startHost, type RunningHost } from "./local-server";
import { GatewayClient } from "./gateway-client";
import { ElectronTokenStore } from "./token-store";
import {
  DEFAULT_HOST_PORT,
  HEARTBEAT_INTERVAL_MS,
  type HostCandidate,
  DEFAULT_GATEWAY_URL,
} from "./protocol";

let mainWindow: BrowserWindow | null = null;
let running: RunningHost | null = null;

// Active gateway session (Mode B). Null when the gateway is disabled or stopped.
interface GatewaySession {
  client: GatewayClient;
  sessionId: string;
  hostToken: string;
  joinCode: string;
  joinUrl: string;
  candidates: HostCandidate[];
  heartbeatTimer: ReturnType<typeof setInterval>;
}
let gatewaySession: GatewaySession | null = null;

// Gateway is OPT-IN. LAN-only Mode A must work with it disabled — hosting must
// never depend on the gateway being reachable. Default OFF; flip with
// RAZZOOZLE_GATEWAY_ENABLED=1 (or the UI toggle, passed per host:start call).
function gatewayEnabledByDefault(): boolean {
  return process.env.RAZZOOZLE_GATEWAY_ENABLED === "1";
}

// Persisted gateway URL config.
interface Config {
  gatewayUrl?: string;
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

function createWindow(): void {
  let win: BrowserWindow;

  // Use MicaBrowserWindow on Windows, fall back to BrowserWindow on other platforms
  if (process.platform === "win32") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
      const mica = require("mica-electron") as typeof import("mica-electron");
      win = new mica.MicaBrowserWindow({
        width: 720,
        height: 760,
        webPreferences: {
          preload: path.join(__dirname, "../preload/index.js"),
          contextIsolation: true,
          nodeIntegration: false,
        },
        autoHideMenuBar: true,
        backgroundColor: "#00000000", // Transparent so Mica shows through
      });

      // Apply Mica material and light theme
      try {
        // Cast the instance to access Mica-specific methods
        const micaWin = win as unknown as {
          setLightTheme(): void;
          setMicaEffect(): void;
        };
        micaWin.setLightTheme();
        if (mica.IS_WINDOWS_11) {
          micaWin.setMicaEffect();
        }
      } catch (err) {
        console.error("Failed to apply Mica effect:", err);
      }
    } catch (err) {
      console.error("Failed to load mica-electron, falling back to standard BrowserWindow:", err);
      win = new BrowserWindow({
        width: 720,
        height: 760,
        webPreferences: {
          preload: path.join(__dirname, "../preload/index.js"),
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
    }
  } else {
    // Non-Windows: use standard BrowserWindow
    win = new BrowserWindow({
      width: 720,
      height: 760,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
  }

  mainWindow = win;
  void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.on("closed", () => (mainWindow = null));
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
      const useGateway = args?.useGateway ?? gatewayEnabledByDefault();

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
      // Validate URL format
      if (!url.match(/^https?:\/\//i)) {
        return { ok: false, error: "URL must start with http:// or https://" };
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

app.whenReady().then(() => {
  // Remove the menu bar
  Menu.setApplicationMenu(null);

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // TODO(F3): wire the update flow here on a timer / menu action:
  //   1. GET https://gw.razzoozle.xyz/api/v1/update/stable?appVersion=<v>
  //      -> { decision, latestVersion, repo }  (gateway = decision only)
  //   2. on "go": electron-updater NATIVE github provider fetches latest.yml + .exe
  //   3. verify minisign(latest.yml) against the bundled pubkey BEFORE install
  // See electron-builder.yml NOTE block + ci-cd-update-channel.md §5. Stubbed
  // out of this LAN-host skeleton (no gateway dependency for Mode A).
});

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
