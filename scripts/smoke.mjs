// Smoke check — runs WITHOUT Electron (headless-friendly).
//
// Verifies the three load-bearing pieces of the Phase-1 LAN-host skeleton:
//   1. LAN IPv4 detection (reachability.ts).
//   2. The reused Razzoozle server boots and GET /desktop-host/ping returns the
//      correct JSON ({ok:true, service, protocolVersion:1}).
//   3. A real QR encoding http://<lan-ip>:<port>/ is generated.
//
// Run AFTER `npm run build` (compiles src -> dist):  node scripts/smoke.mjs
// Override the Razzoozle build location with RAZZOOZLE_SRC=<path>.

import http from "node:http";
import assert from "node:assert/strict";

import { detectLanIpv4 } from "../dist/main/reachability.js";
import { startHost } from "../dist/main/local-server.js";
import { PING_PATH, PROTOCOL_VERSION, HOST_SERVICE } from "../dist/main/protocol.js";
import QRCode from "qrcode";

const PORT = Number(process.env.SMOKE_PORT) || 7799;

function getJson(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(body) });
        } catch (e) {
          reject(new Error(`bad JSON from ${path}: ${body}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("timeout")));
  });
}

let host;
try {
  // 1) LAN IPv4 detection.
  const lan = detectLanIpv4();
  console.log(`[1/3] LAN detect: ip=${lan.ip ?? "(none)"} ` +
    `candidates=[${lan.candidates.join(", ")}]` +
    (lan.warning ? ` warning="${lan.warning}"` : ""));
  // The function must always return the documented shape.
  assert.ok("ip" in lan && "candidates" in lan && "warning" in lan,
    "detectLanIpv4 returned an unexpected shape");

  // 2) Boot the reused host server + ping.
  host = await startHost({ port: PORT });
  console.log(`[2/3] host server up on 0.0.0.0:${host.port}`);

  const ping = await getJson(PORT, PING_PATH);
  console.log(`      ${PING_PATH} -> ${ping.status} ${JSON.stringify(ping.json)}`);
  assert.equal(ping.status, 200, "ping status must be 200");
  assert.equal(ping.json.ok, true, "ping.ok must be true");
  assert.equal(ping.json.service, HOST_SERVICE, "ping.service mismatch");
  assert.equal(ping.json.protocolVersion, PROTOCOL_VERSION, "ping.protocolVersion mismatch");

  // Bonus: the reused socket server's frozen /healthz must proxy through.
  const health = await new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: PORT, path: "/healthz" }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: b.trim() }));
    }).on("error", reject);
  });
  assert.equal(health.status, 200, "/healthz proxy status");
  assert.equal(health.body, "ok", "/healthz proxy body");
  console.log(`      /healthz (proxied to reused socket) -> ${health.status} "${health.body}"`);

  // 3) QR for the join URL.
  const ip = lan.ip ?? "127.0.0.1";
  const joinUrl = `http://${ip}:${PORT}/`;
  const qr = await QRCode.toDataURL(joinUrl);
  assert.ok(qr.startsWith("data:image/png;base64,"), "QR must be a PNG data URL");
  assert.ok(qr.length > 200, "QR data URL looks too short");
  console.log(`[3/3] QR generated for ${joinUrl} (${qr.length} bytes data-url)`);

  console.log("\nSMOKE OK");
  await host.stop();
  process.exit(0);
} catch (err) {
  console.error("\nSMOKE FAILED:", err instanceof Error ? err.message : err);
  if (host) await host.stop().catch(() => {});
  process.exit(1);
}
