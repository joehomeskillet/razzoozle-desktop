// Electron main process — Razzoozle Desktop, Mode A "LAN Direct".
//
// Lifecycle + IPC. The renderer asks main to "start hosting"; main detects the
// LAN IPv4, boots the reused Razzoozle server (local-server.ts), builds the
// join URL (http://<lan-ip>:<port>/ — a TOP-LEVEL URL the phone navigates to,
// per F4), generates a QR for it, and returns it all to the renderer.

import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import QRCode from "qrcode";

import { detectLanIpv4 } from "./reachability";
import { startHost, type RunningHost } from "./local-server";
import { DEFAULT_HOST_PORT } from "./protocol";

let mainWindow: BrowserWindow | null = null;
let running: RunningHost | null = null;

// Result handed back to the renderer after a successful "start hosting".
export interface HostStartResult {
  ok: boolean;
  /** http://<lan-ip>:<port>/ — the URL the phone navigates to (F4). */
  joinUrl?: string;
  lanIp?: string | null;
  port?: number;
  /** Data-URL PNG of the QR encoding joinUrl. */
  qrDataUrl?: string;
  /** Non-fatal warning (e.g. only loopback found). */
  warning?: string | null;
  /** Set when start failed. */
  error?: string;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.on("closed", () => (mainWindow = null));
}

// IPC: start hosting. Idempotent-ish — if already running, returns current info.
ipcMain.handle("host:start", async (): Promise<HostStartResult> => {
  try {
    const lan = detectLanIpv4();
    const port = DEFAULT_HOST_PORT;

    if (!running) {
      // Persist the reused server's data under the app's userData dir, never in
      // the Razzoozle source tree.
      running = await startHost({ port, configPath: app.getPath("userData") });
    }

    // The QR + URL must point at the host's OWN http origin (F4). If we only
    // have loopback, the URL still works locally but a phone can't reach it —
    // we surface lan.warning so the UI is honest about it.
    const ipForUrl = lan.ip ?? "127.0.0.1";
    const joinUrl = `http://${ipForUrl}:${port}/`;
    const qrDataUrl = await QRCode.toDataURL(joinUrl, { margin: 1, width: 320 });

    return {
      ok: true,
      joinUrl,
      lanIp: lan.ip,
      port,
      qrDataUrl,
      warning: lan.warning,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("host:stop", async (): Promise<{ ok: boolean }> => {
  if (running) {
    await running.stop();
    running = null;
  }
  return { ok: true };
});

app.whenReady().then(() => {
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
    if (running) {
      await running.stop();
      running = null;
    }
    if (process.platform !== "darwin") app.quit();
  })();
});
