// Integration smoke — desktop gateway-client <-> a REAL razzloo-gateway.
//
// This is the Phase-3 key verification. It:
//   1. Builds + boots a LOCAL razzloo-gateway (node dist/server.js) on a free
//      127.0.0.1 port (PORT/HOST env).
//   2. Points the desktop gateway-client at it via RAZZOOZLE_GATEWAY_URL.
//   3. Drives the full round-trip against the running gateway:
//        register -> assert joinCode + hostToken
//        heartbeat -> assert 200 + TTL slid forward
//        GET /api/v1/join/<code> -> assert SAME candidates, NO hostToken leak
//        update-gate GET -> assert { decision, latestVersion }
//        DELETE -> assert the code then resolves 404
//   4. Tears the gateway process down.
//
// Run AFTER `npm run build` (compiles src -> dist):  node scripts/smoke-gateway.mjs
// Override the gateway repo location with GATEWAY_DIR=<path>.

import http from "node:http";
import net from "node:net";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { GatewayClient } from "../dist/main/gateway-client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.dirname(here);
const GATEWAY_DIR =
  process.env.GATEWAY_DIR || "/nvmetank1/projects/razzloo-gateway";

// ── helpers ──────────────────────────────────────────────────────────────────

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function getJson(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: p, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        let json;
        try {
          json = body === "" ? undefined : JSON.parse(body);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode, json, body });
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("timeout")));
  });
}

async function waitForGateway(port, deadlineMs = 15000) {
  const end = Date.now() + deadlineMs;
  // The update-gate is an unauthenticated GET that always 200s for a good channel.
  while (Date.now() < end) {
    try {
      const r = await getJson(port, "/api/v1/update/stable?appVersion=0.0.0");
      if (r.status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("gateway did not become ready in time");
}

// ── boot the gateway ─────────────────────────────────────────────────────────

function ensureGatewayBuilt() {
  const serverJs = path.join(GATEWAY_DIR, "dist", "server.js");
  if (existsSync(serverJs)) return;
  if (!existsSync(path.join(GATEWAY_DIR, "node_modules"))) {
    console.log("[smoke] installing gateway deps…");
    const i = spawnSync("npm", ["i"], { cwd: GATEWAY_DIR, stdio: "inherit" });
    if (i.status !== 0) throw new Error("gateway npm i failed");
  }
  console.log("[smoke] building gateway…");
  const b = spawnSync("npm", ["run", "build"], {
    cwd: GATEWAY_DIR,
    stdio: "inherit",
  });
  if (b.status !== 0) throw new Error("gateway build failed");
}

let gateway;
let exitCode = 1;
try {
  ensureGatewayBuilt();
  const port = await freePort();

  gateway = spawn(process.execPath, [path.join(GATEWAY_DIR, "dist", "server.js")], {
    cwd: GATEWAY_DIR,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  gateway.stdout.on("data", (d) => process.stdout.write(`[gw] ${d}`));
  gateway.stderr.on("data", (d) => process.stderr.write(`[gw] ${d}`));

  await waitForGateway(port);
  console.log(`[smoke] gateway up on 127.0.0.1:${port}`);

  // Point the client at the local gateway (env override).
  process.env.RAZZOOZLE_GATEWAY_URL = `http://127.0.0.1:${port}`;
  const client = new GatewayClient({ baseUrl: process.env.RAZZOOZLE_GATEWAY_URL });

  // LAN + a manual candidate. (A public-ipv4 echo is unreachable in the sandbox;
  // that path degrades to "skip" — protocol still validates these two.)
  const candidates = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      kind: "lan",
      url: "http://192.168.1.42:7777",
      priority: 0,
      observedFrom: "host",
      verified: false,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      kind: "manual",
      url: "http://host.example.com:7777",
      priority: 15,
      observedFrom: "manual",
      verified: false,
    },
  ];

  // 1) REGISTER -> joinCode + hostToken.
  const reg = await client.register({
    hostId: "h_smoke_0123456789",
    appVersion: "0.1.0",
    candidates,
  });
  assert.ok(/^[BCDFGHJKLMNPQRSTVWXZ2-9]{6}$/.test(reg.joinCode), "joinCode shape");
  assert.ok(reg.hostToken && reg.hostToken.startsWith("ht_"), "hostToken issued");
  assert.ok(reg.sessionId, "sessionId issued");
  assert.equal(reg.joinUrl, `https://gw.razzoozle.xyz/j/${reg.joinCode}`, "joinUrl");
  const expiresAt1 = Date.parse(reg.expiresAt);
  console.log(`[1/5] register -> code=${reg.joinCode} token=ht_… session=${reg.sessionId}`);

  // 2) HEARTBEAT -> 200 + TTL slid forward.
  await new Promise((r) => setTimeout(r, 1100)); // ensure a measurable TTL slide
  const hb = await client.heartbeat(reg.sessionId, reg.hostToken);
  assert.equal(hb.status, "online", "status online after heartbeat");
  assert.ok(!("hostToken" in hb), "heartbeat view must NOT include hostToken");
  const expiresAt2 = Date.parse(hb.expiresAt);
  assert.ok(expiresAt2 > expiresAt1, "expiresAt must slide forward on heartbeat");
  console.log(`[2/5] heartbeat -> online, TTL +${expiresAt2 - expiresAt1}ms`);

  // 3) RESOLVE /api/v1/join/<code> -> SAME candidates, NO hostToken leak.
  const resolved = await getJson(port, `/api/v1/join/${reg.joinCode}`);
  assert.equal(resolved.status, 200, "join resolve 200");
  assert.equal(resolved.json.joinCode, reg.joinCode, "resolved joinCode");
  assert.ok(!/hostToken/i.test(resolved.body), "join body must NOT leak hostToken");
  const sentUrls = candidates.map((c) => `${c.kind}|${c.url}`).sort();
  const gotUrls = resolved.json.candidates.map((c) => `${c.kind}|${c.url}`).sort();
  assert.deepEqual(gotUrls, sentUrls, "resolved candidates must match what we sent");
  // observedFrom / hostId must not be exposed to joiners (§7).
  assert.ok(
    resolved.json.candidates.every((c) => !("observedFrom" in c)),
    "join candidates must not expose observedFrom",
  );
  console.log(`[3/5] resolve -> ${gotUrls.length} candidates match, no token leak`);

  // 4) UPDATE-GATE -> { decision, latestVersion }.
  const gate = await client.updateGate("stable", "0.1.0");
  assert.ok(gate.decision === "go" || gate.decision === "hold", "decision enum");
  assert.ok(typeof gate.latestVersion === "string" && gate.latestVersion.length > 0, "latestVersion");
  assert.equal(gate.repo, "joehomeskillet/razzoozle-desktop", "repo constant");
  console.log(`[4/5] update-gate -> decision=${gate.decision} latest=${gate.latestVersion}`);

  // 5) DELETE -> then the code resolves 404 (no oracle).
  await client.unregister(reg.sessionId, reg.hostToken);
  const after = await getJson(port, `/api/v1/join/${reg.joinCode}`);
  assert.equal(after.status, 404, "deleted session resolves 404");
  assert.equal(after.json.error, "unknown_join_code", "404 unknown_join_code");
  console.log(`[5/5] delete -> code now 404 unknown_join_code`);

  console.log("\nGATEWAY SMOKE OK");
  exitCode = 0;
} catch (err) {
  console.error("\nGATEWAY SMOKE FAILED:", err instanceof Error ? err.stack : err);
  exitCode = 1;
} finally {
  if (gateway && !gateway.killed) {
    gateway.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    if (!gateway.killed) gateway.kill("SIGKILL");
  }
  process.exit(exitCode);
}

void desktopRoot;
