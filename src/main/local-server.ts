// Local LAN host server — Mode A "LAN Direct".
//
// REUSE, NOT FORK (repo-strategy.md §3/§4, F2): this module does NOT reimplement
// the game server or the web app. It (1) spawns the prebuilt @razzoozle/socket
// server as a child process on an internal loopback port, and (2) runs a thin
// public-facing HTTP front on 0.0.0.0:<port> that serves the prebuilt
// @razzoozle/web static bundle and proxies everything else (incl. the /ws
// socket.io upgrade) to that child. This mirrors the prod composition exactly —
// in prod, nginx serves web/dist on / and proxies /ws + /api + /healthz to the
// socket on 127.0.0.1:3001 (Razzoozle docker/nginx.conf). We replicate that
// single-origin layout so the phone hits ONE http origin and the web client's
// relative `io("/", { path: "/ws" })` connects with no rewrites.
//
// ponytail: For THIS Phase-1 skeleton the web bundle + socket entry are consumed
// from the LOCAL Razzoozle build at /nvmetank1/projects/Razzoozle/cd-src
// (RAZZOOZLE_SRC override). This is TEMPORARY. Per repo-strategy.md F2 this
// becomes the pinned, prebuilt, Renovate-bumped @razzoozle/{web,socket} artifact
// resolved from node_modules — NO git submodule (pnpm workspace:* won't resolve
// in a bare subtree). When the artifact pin lands, swap resolveRazzoozlePaths()
// to read node_modules instead of the local source tree; nothing else changes.

import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import {
  HOST_SERVICE,
  PING_PATH,
  PROTOCOL_VERSION,
  type DesktopHostPing,
} from "./protocol";

// The internal port @razzoozle/socket listens on (its WS_DEFAULT_PORT is 3001,
// overridable via WS_PORT). We pick a free loopback port at runtime and pass it
// in, so it never collides with anything else on the host.
interface RazzoozlePaths {
  /** Built socket entry, e.g. .../packages/socket/dist/index.cjs */
  socketEntry: string;
  /** Built web static dir containing index.html, e.g. .../packages/web/dist */
  webDist: string;
  /** cwd for the socket child (it resolves ../../config + ../../branding). */
  socketCwd: string;
}

// Minimal content-type table for the static web bundle.
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".map": "application/json; charset=utf-8",
};

// Requests whose path starts with one of these go to the socket child, NOT the
// static bundle. Everything else falls back to web/dist (SPA). Mirrors the
// nginx location blocks (Razzoozle docker/nginx.conf): /ws, /api, /healthz,
// /metrics, /r/, /plugins/, /theme/, /media/ are owned by the socket server.
const PROXY_PREFIXES = [
  "/ws",
  "/api",
  "/healthz",
  "/metrics",
  "/r/",
  "/plugins/",
  "/theme/",
  "/media/",
];

/**
 * Is this running inside a packaged (electron-builder NSIS) app? True only when
 * Electron is present AND app.isPackaged. Returns false under plain-node (the
 * smoke test) and under `electron .` dev runs. We require("electron") lazily so
 * this module still loads under plain node (scripts/smoke.mjs), where electron
 * is not available.
 */
function isPackagedApp(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require("electron") as { app?: { isPackaged?: boolean } };
    return electron?.app?.isPackaged === true;
  } catch {
    return false; // plain node (smoke) — never packaged.
  }
}

/**
 * Resolve where the prebuilt web + socket live.
 *
 * PACKAGED (electron-builder NSIS): the game is vendored and shipped via
 * electron-builder.yml `extraResources` (from: vendor/razzoozle, to: razzoozle),
 * so it lands as REAL files at <resourcesPath>/razzoozle/ (NOT inside the asar —
 * the spawned .cjs must be a real on-disk file). Layout:
 *   <resourcesPath>/razzoozle/socket/index.cjs   (self-contained, no node_modules)
 *   <resourcesPath>/razzoozle/web/dist/index.html
 *
 * DEV (plain node smoke / `electron .`): unchanged — read from the local
 * Razzoozle source tree; RAZZOOZLE_SRC overrides the root.
 *
 * ponytail (F2 debt): the dev branch is still hard-wired to the local source
 * tree. RAZZOOZLE_SRC overrides it. The packaged branch is the real artifact.
 */
export function resolveRazzoozlePaths(): RazzoozlePaths {
  if (isPackagedApp()) {
    const base = path.join(process.resourcesPath, "razzoozle");
    return {
      socketEntry: path.join(base, "socket", "index.cjs"),
      webDist: path.join(base, "web", "dist"),
      // The socket bundle is self-contained; cwd only matters for its
      // CONFIG_PATH fallback, which StartOptions.configPath overrides anyway.
      socketCwd: path.join(base, "socket"),
    };
  }

  const root =
    process.env.RAZZOOZLE_SRC || "/nvmetank1/projects/Razzoozle/cd-src";
  const socketEntry = path.join(root, "packages/socket/dist/index.cjs");
  const webDist = path.join(root, "packages/web/dist");
  // The socket process resolves config/branding relative to its own cwd
  // (services/config.ts: ../../config). Running it from packages/socket keeps
  // that fallback intact (../../config === <root>/config).
  const socketCwd = path.join(root, "packages/socket");
  return { socketEntry, webDist, socketCwd };
}

/** Find a free TCP port on loopback (lets the OS pick, then closes). */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("could not allocate a port")));
      }
    });
  });
}

/** Poll the socket child's frozen /healthz until it answers "ok" or we give up. */
function waitForSocketHealth(
  internalPort: number,
  timeoutMs = 30000,
  shouldAbort: () => string | null = () => null,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const abort = shouldAbort();
      if (abort) {
        reject(new Error(abort));
        return;
      }
      const req = http.get(
        { host: "127.0.0.1", port: internalPort, path: "/healthz" },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            if (res.statusCode === 200 && body.trim() === "ok") {
              resolve();
            } else {
              retry();
            }
          });
        },
      );
      req.on("error", retry);
      req.setTimeout(1000, () => req.destroy());
    };
    const retry = () => {
      const abort = shouldAbort();
      if (abort) {
        reject(new Error(abort));
        return;
      }
      if (Date.now() > deadline) {
        reject(
          new Error(`socket server did not become healthy within ${timeoutMs}ms`),
        );
        return;
      }
      setTimeout(attempt, 250);
    };
    attempt();
  });
}

export interface StartOptions {
  /** Public LAN port to bind on 0.0.0.0. Defaults to DEFAULT_HOST_PORT. */
  port: number;
  /** Optional gateway sessionId to echo from /desktop-host/ping (none in LAN-only). */
  sessionId?: string;
  /** Override resolved paths (used by the smoke test). */
  paths?: RazzoozlePaths;
  /**
   * Where the reused socket server writes its config/quizz/results data.
   * Defaults to an OS-temp dir so the host NEVER writes into the Razzoozle
   * source tree. Electron main passes app.getPath("userData") here.
   */
  configPath?: string;
  /**
   * File to append host + socket diagnostics to. A packaged Windows app has no
   * visible console, so the socket's stderr is otherwise lost and a failure
   * looks like a silent stall. Electron main passes <userData>/host.log.
   */
  logPath?: string;
}

export interface RunningHost {
  /** The public port we actually bound on 0.0.0.0. */
  port: number;
  /** Stop the front server and the socket child. Idempotent. */
  stop: () => Promise<void>;
}

// Serve one file from web/dist. Returns true if handled.
function tryServeStatic(
  webDist: string,
  reqPath: string,
  res: http.ServerResponse,
): boolean {
  // Strip query, decode, and resolve safely inside webDist (no traversal).
  const clean = decodeURIComponent((reqPath.split("?")[0] || "/").trim());
  const rel = clean === "/" ? "index.html" : clean.replace(/^\/+/, "");
  const abs = path.normalize(path.join(webDist, rel));
  if (!abs.startsWith(path.normalize(webDist))) return false; // traversal guard

  let filePath = abs;
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {
    return false;
  }
  if (!fs.existsSync(filePath)) return false;

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// Proxy a plain (non-upgrade) request to the socket child on loopback.
function proxyHttp(
  internalPort: number,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  const proxyReq = http.request(
    {
      host: "127.0.0.1",
      port: internalPort,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(proxyReq);
}

/**
 * Start the LAN host: spawn the reused socket server, then bring up the public
 * front on 0.0.0.0:<port>. Resolves once both are listening + healthy.
 */
export async function startHost(opts: StartOptions): Promise<RunningHost> {
  const paths = opts.paths ?? resolveRazzoozlePaths();

  if (!fs.existsSync(paths.socketEntry)) {
    throw new Error(
      `Razzoozle socket build not found at ${paths.socketEntry}. ` +
        `Build it: (cd <razzoozle> && pnpm --filter @razzoozle/socket build).`,
    );
  }
  if (!fs.existsSync(path.join(paths.webDist, "index.html"))) {
    throw new Error(
      `Razzoozle web build not found at ${paths.webDist}/index.html. ` +
        `Build it: (cd <razzoozle> && pnpm --filter @razzoozle/web build).`,
    );
  }

  const internalPort = await findFreePort();

  // Diagnostics: a packaged Windows app has no visible console, so the socket's
  // stderr is otherwise lost and any failure looks like a silent stall. Keep an
  // in-memory ring buffer AND append to opts.logPath (<userData>/host.log).
  const logBuf: string[] = [];
  const log = (line: string): void => {
    logBuf.push(line);
    if (logBuf.length > 400) logBuf.shift();
    if (opts.logPath) {
      try {
        fs.appendFileSync(opts.logPath, line + "\n");
      } catch {
        /* logging must never throw */
      }
    }
  };
  log(`[host] packaged=${isPackagedApp()} execPath=${process.execPath}`);
  log(`[host] socketEntry=${paths.socketEntry}`);
  log(`[host] webDist=${paths.webDist}`);
  log(`[host] internalPort=${internalPort} publicPort=${opts.port}`);

  // The reused socket server persists config/quizz/results under CONFIG_PATH
  // (or ../../config relative to its cwd if unset). Default it to an OS-temp dir
  // so the host never writes into the Razzoozle source tree; Electron main
  // overrides this with app.getPath("userData").
  const configPath =
    opts.configPath ?? path.join(os.tmpdir(), "razzoozle-desktop-config");
  fs.mkdirSync(configPath, { recursive: true });

  // Spawn the prebuilt socket server (no fork, no source build). It binds its
  // own http+socket.io on WS_PORT on all interfaces; we only ever talk to it on
  // 127.0.0.1 and never expose it directly.
  //
  // A packaged app ships NO system `node`, so we run the cjs entry through
  // Electron's OWN binary (process.execPath) in node mode via
  // ELECTRON_RUN_AS_NODE=1 — that turns the Electron exe into a plain Node
  // runtime (no Chromium, no app window). In dev/smoke process.execPath is
  // already a real node/electron that can run the file, so we leave that env
  // unset there.
  const childEnv: Record<string, string> = {};
  if (process.env.PATH) childEnv.PATH = process.env.PATH;
  if (process.env.HOME) childEnv.HOME = process.env.HOME;
  if (process.env.TMPDIR) childEnv.TMPDIR = process.env.TMPDIR;
  if (process.env.SystemRoot) childEnv.SystemRoot = process.env.SystemRoot;
  childEnv.WS_PORT = String(internalPort);
  childEnv.CONFIG_PATH = configPath;
  if (isPackagedApp()) childEnv.ELECTRON_RUN_AS_NODE = "1";

  const child: ChildProcess = spawn(
    process.execPath,
    [paths.socketEntry],
    {
      cwd: paths.socketCwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (d: Buffer) => log(`[socket] ${String(d).trimEnd()}`));
  child.stderr?.on("data", (d: Buffer) => log(`[socket:err] ${String(d).trimEnd()}`));

  let childExited = false;
  let exitInfo = "";
  let spawnError: Error | null = null;
  // A ChildProcess 'error' (the spawn itself failing) with NO listener throws an
  // uncaught exception that crashes main and freezes the renderer on "Starting…".
  child.on("error", (e: Error) => {
    spawnError = e;
    log(`[socket:spawn-error] ${e.message}`);
  });
  child.on("exit", (code, sig) => {
    childExited = true;
    exitInfo = `code=${code ?? "null"} signal=${sig ?? "null"}`;
    log(`[socket] exited ${exitInfo}`);
  });

  try {
    // Fail FAST if the child dies / fails to launch — don't wait the full
    // timeout for a /healthz that can never arrive.
    await waitForSocketHealth(internalPort, 30000, () =>
      spawnError
        ? `socket failed to launch: ${spawnError.message}`
        : childExited
          ? `socket exited before becoming healthy (${exitInfo})`
          : null,
    );
  } catch (err) {
    if (!childExited) child.kill();
    const tail = logBuf.slice(-25).join("\n");
    const base = err instanceof Error ? err.message : String(err);
    throw new Error(`${base}\n--- host.log (tail) ---\n${tail}`);
  }

  // The ping payload — protocol.md §15. NO game data.
  const pingBody: DesktopHostPing = {
    ok: true,
    service: HOST_SERVICE,
    protocolVersion: PROTOCOL_VERSION,
    ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
  };

  const front = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const pathOnly = url.split("?")[0] || "/";

    // 1) Our own host endpoint — served locally, never proxied (no game data).
    if (pathOnly === PING_PATH) {
      const body = JSON.stringify(pingBody);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
        // Allow the post-navigation same-origin verification fetch.
        "cache-control": "no-store",
      });
      res.end(body);
      return;
    }

    // 2) Socket-owned routes (api/ws-http-handshake/healthz/etc.) → proxy.
    if (PROXY_PREFIXES.some((p) => pathOnly.startsWith(p))) {
      proxyHttp(internalPort, req, res);
      return;
    }

    // 3) Static web bundle, else SPA fallback to index.html.
    if (tryServeStatic(paths.webDist, url, res)) return;
    if (tryServeStatic(paths.webDist, "/index.html", res)) return;

    res.writeHead(404);
    res.end();
  });

  // socket.io upgrades to a raw WebSocket on /ws — forward the upgrade to the
  // child by piping the two TCP sockets together.
  front.on("upgrade", (req, clientSocket, head) => {
    const proxyReq = http.request({
      host: "127.0.0.1",
      port: internalPort,
      method: req.method,
      path: req.url,
      headers: req.headers,
    });
    proxyReq.on("upgrade", (proxyRes, proxySocket) => {
      const headers = Object.entries(proxyRes.headers)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
        .join("\r\n");
      clientSocket.write(
        `HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n\r\n`,
      );
      if (head && head.length) proxySocket.write(head);
      proxySocket.pipe(clientSocket);
      clientSocket.pipe(proxySocket);
      proxySocket.on("error", () => clientSocket.destroy());
      clientSocket.on("error", () => proxySocket.destroy());
    });
    proxyReq.on("error", () => clientSocket.destroy());
    proxyReq.end();
  });

  await new Promise<void>((resolve, reject) => {
    front.once("error", reject);
    // Bind on 0.0.0.0 so phones on the LAN can reach it (repo goal #1).
    front.listen(opts.port, "0.0.0.0", () => resolve());
  });

  const stop = async (): Promise<void> => {
    await new Promise<void>((resolve) => front.close(() => resolve()));
    if (!childExited) child.kill();
  };

  return { port: opts.port, stop };
}
