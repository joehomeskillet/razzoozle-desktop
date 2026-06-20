// LAN IPv4 detection for the host machine.
//
// Mode A "LAN Direct": the phone navigates top-level to http://<lan-ip>:<port>/
// (protocol.md §8.1 / F4). We need the host's own RFC1918 LAN address — NOT
// loopback, NOT a docker/virtual bridge — so the QR encodes a URL that a phone
// on the same Wi-Fi can actually reach.
//
// This is pure NIC enumeration via node's os.networkInterfaces(). It does NOT
// probe anything, contact STUN, or open a socket — consistent with the spec's
// no-probing stance (the gateway never probes; the host only enumerates its own
// interfaces).

import os from "node:os";

export interface LanDetectResult {
  /** The chosen LAN IPv4 (e.g. "192.168.1.42"), or null if only loopback. */
  ip: string | null;
  /** All non-internal IPv4 candidates found, best-first. */
  candidates: string[];
  /** A human warning when no usable LAN IP was found (only loopback). */
  warning: string | null;
}

// Interface-name prefixes we skip: virtual bridges, container nets, VPN/tunnel
// adapters. These are real IPv4s but never the address a phone on the Wi-Fi can
// reach, so they must not win the QR.
const SKIP_NAME_RE =
  /^(docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|wg|zt|utun|llw|awdl)/i;

// True for an RFC1918 / link-local / CGNAT IPv4 — the ranges a same-LAN phone
// can route to. We prefer these over any stray routable address.
function isPrivateIpv4(ip: string): boolean {
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  // 172.16.0.0 – 172.31.255.255
  if (ip.startsWith("172.")) {
    const second = Number(ip.split(".")[1]);
    return second >= 16 && second <= 31;
  }
  // 169.254.0.0/16 link-local (last resort — usually means no DHCP lease).
  if (ip.startsWith("169.254.")) return true;
  // 100.64.0.0/10 CGNAT — common on tethering; routable within that NAT.
  if (ip.startsWith("100.")) {
    const second = Number(ip.split(".")[1]);
    return second >= 64 && second <= 127;
  }
  return false;
}

/**
 * Enumerate the host's own interfaces and pick the best LAN IPv4 for the QR.
 *
 * Order of preference:
 *   1. A private (RFC1918) IPv4 on a non-virtual interface — the normal case.
 *   2. Any non-internal IPv4 (still better than nothing).
 *   3. null + a warning if only loopback exists.
 */
export function detectLanIpv4(): LanDetectResult {
  const ifaces = os.networkInterfaces();
  const privateCandidates: string[] = [];
  const otherCandidates: string[] = [];

  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    if (SKIP_NAME_RE.test(name)) continue;

    for (const addr of addrs) {
      // node <18 used the string "IPv4"; >=18 uses family === 4. Accept both.
      const isV4 = addr.family === "IPv4" || (addr.family as unknown) === 4;
      if (!isV4) continue;
      if (addr.internal) continue; // skip 127.0.0.1 / loopback

      if (isPrivateIpv4(addr.address)) {
        privateCandidates.push(addr.address);
      } else {
        otherCandidates.push(addr.address);
      }
    }
  }

  const candidates = [...privateCandidates, ...otherCandidates];

  if (candidates.length === 0) {
    return {
      ip: null,
      candidates: [],
      warning:
        "No LAN address found — only loopback is available. Players cannot " +
        "reach this host until it joins a Wi-Fi/Ethernet network.",
    };
  }

  return { ip: candidates[0], candidates, warning: null };
}
