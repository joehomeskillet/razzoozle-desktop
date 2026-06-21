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
import dgram from "node:dgram";
import { randomUUID } from "node:crypto";

import type { HostCandidate } from "./protocol";

// Cached default-route source IP (the address the kernel would use to reach the
// public internet = the active NIC). undefined = not yet probed; null = probe
// done but produced nothing. Computed once at host-start and reused so the hot
// path never blocks.
let cachedDefaultRouteIp: string | null | undefined = undefined;

/**
 * Best-effort default-route source IP via the UDP-connect trick. `connect()` on
 * a UDP socket sends NO datagram — it only makes the kernel select the source IP
 * it would use to reach the target, i.e. the active default-route NIC's IP.
 *
 * Synchronous-ish: createSocket + connect resolve the local address immediately
 * on every platform we ship (Win/macOS/Linux) without any network round-trip, so
 * we read s.address() inside a tight try/finally and close right away. Degrades
 * to null on ANY error — it must never throw or block hosting. Result is cached.
 */
function detectDefaultRouteIpv4(): string | null {
  if (cachedDefaultRouteIp !== undefined) return cachedDefaultRouteIp;
  let ip: string | null = null;
  let s: dgram.Socket | null = null;
  try {
    s = dgram.createSocket("udp4");
    // No datagram is sent; connect() only triggers kernel source-IP selection.
    s.connect(80, "1.1.1.1");
    const addr = s.address();
    if (addr && typeof addr.address === "string" && addr.address !== "0.0.0.0") {
      ip = addr.address;
    }
  } catch {
    ip = null; // degrade silently — never block hosting
  } finally {
    try {
      s?.close();
    } catch {
      /* ignore */
    }
  }
  cachedDefaultRouteIp = ip;
  return ip;
}

/** The /24 prefix of an IPv4 (e.g. "192.168.1.42" -> "192.168.1."), or null. */
function slash24(ip: string): string | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.`;
}

export interface LanDetectResult {
  /** The chosen LAN IPv4 (e.g. "192.168.1.42"), or null if only loopback. */
  ip: string | null;
  /** All non-internal IPv4 candidates found, best-first. */
  candidates: string[];
  /** A human warning when no usable LAN IP was found (only loopback). */
  warning: string | null;
}

// Interface-name fragments we skip: virtual bridges, container nets, VPN/tunnel
// adapters — plus the Windows friendly virtual-adapter names (vEthernet (WSL),
// Tailscale, ZeroTier, Hyper-V, Npcap loopback, Bluetooth PAN, …). These are
// real IPv4s but never the address a phone on the Wi-Fi can reach, so they must
// not win the QR. Substring + case-insensitive so "vEthernet (WSL)" is caught
// even though the OS-prefix anchor would miss the friendly Windows name.
const SKIP_NAME_RE =
  /(docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|wg|zt|utun|llw|awdl|vethernet|wsl|tailscale|zerotier|hyper-v|loopback pseudo|npcap|bluetooth)/i;

// RFC1918 LAN ranges — the addresses a same-LAN phone can actually route to.
// These are the only ones we PREFER for the QR.
function isRfc1918(ip: string): boolean {
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  // 172.16.0.0 – 172.31.255.255
  if (ip.startsWith("172.")) {
    const second = Number(ip.split(".")[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

// "Weak" LAN addresses — technically private but a poor QR target:
//   169.254.0.0/16 link-local — almost always means NO DHCP lease.
//   100.64.0.0/10 CGNAT — tethering/carrier NAT; routable only within that NAT.
// Demoted, never preferred: only used if no real NIC exists.
function isWeakLan(ip: string): boolean {
  if (ip.startsWith("169.254.")) return true;
  if (ip.startsWith("100.")) {
    const second = Number(ip.split(".")[1]);
    return second >= 64 && second <= 127;
  }
  return false;
}

/**
 * Enumerate the host's own interfaces and pick the best LAN IPv4 for the QR.
 *
 * Order of preference (a real RFC1918 LAN IP ALWAYS wins; 169.254 link-local and
 * 100.64/10 CGNAT are demoted so they never become candidates[0] when a real NIC
 * exists):
 *   1. RFC1918 (10./192.168./172.16-31.) on a non-virtual interface. Within this
 *      bucket: the IP matching the active default-route source IP (or sharing its
 *      /24) wins; then a 192.168.* tiebreak (home Wi-Fi); else enumeration order.
 *   2. Any other non-internal routable IPv4 (still better than a weak address).
 *   3. Weak LAN: 169.254 link-local / 100.64-127 CGNAT (last resort).
 *   4. null + a warning if only loopback exists.
 */
export function detectLanIpv4(): LanDetectResult {
  const ifaces = os.networkInterfaces();
  const rfc1918: string[] = [];
  const other: string[] = [];
  const weak: string[] = [];

  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    if (SKIP_NAME_RE.test(name)) continue;

    for (const addr of addrs) {
      // node <18 used the string "IPv4"; >=18 uses family === 4. Accept both.
      const isV4 = addr.family === "IPv4" || (addr.family as unknown) === 4;
      if (!isV4) continue;
      if (addr.internal) continue; // skip 127.0.0.1 / loopback

      if (isRfc1918(addr.address)) {
        rfc1918.push(addr.address);
      } else if (isWeakLan(addr.address)) {
        weak.push(addr.address);
      } else {
        other.push(addr.address);
      }
    }
  }

  // Within RFC1918, prefer the NIC the kernel actually routes through. The
  // default-route source IP (UDP-connect trick, cached) is the active Wi-Fi/
  // Ethernet adapter; pick the exact match, else a same-/24 sibling, before
  // falling back to the cheap 192.168.* home-Wi-Fi tiebreak.
  if (rfc1918.length > 1) {
    const routeIp = detectDefaultRouteIpv4();
    const routePrefix = routeIp ? slash24(routeIp) : null;
    rfc1918.sort((a, b) => rank1918(a, routeIp, routePrefix) - rank1918(b, routeIp, routePrefix));
  }

  const candidates = [...rfc1918, ...other, ...weak];

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

/** Lower rank = preferred. Default-route exact > same /24 > 192.168.* > rest. */
function rank1918(
  ip: string,
  routeIp: string | null,
  routePrefix: string | null,
): number {
  if (routeIp && ip === routeIp) return 0;
  if (routePrefix && slash24(ip) === routePrefix) return 1;
  if (ip.startsWith("192.168.")) return 2;
  return 3;
}

// ── HostCandidate[] for the gateway (Phase-3, protocol.md §2.1) ──────────────
//
// The gateway does NOT discover candidates for the host (§5) — the host gathers
// its own and advertises them. This stays consistent with the no-probing stance:
// LAN + public-ipv6 come from pure NIC enumeration; the optional public-ipv4
// lookup is a single outbound GET to an IP-echo service the host operator opts
// into; manual is operator config. UPnP/NAT-PMP is OUT (Phase-5).
//
// NOTE the gateway re-validates every url at write time by `kind` (§6.1): a
// `lan` candidate must be RFC1918/link-local/unique-local; a `public-*`
// candidate must NOT be private/loopback/reserved. We only emit candidates that
// pass that shape, so a register never 400s on invalid_candidate_url.

/** Is this a global-scope IPv6 (not loopback, link-local, unique-local, mapped)? */
function isGlobalIpv6(ip: string): boolean {
  const a = ip.toLowerCase();
  if (a === "::1" || a === "::") return false; // loopback / unspecified
  if (a.startsWith("fe80")) return false; // link-local fe80::/10
  if (a.startsWith("fc") || a.startsWith("fd")) return false; // unique-local fc00::/7
  if (a.startsWith("ff")) return false; // multicast ff00::/8
  if (a.startsWith("::ffff:")) return false; // IPv4-mapped
  if (a.startsWith("2001:db8")) return false; // documentation range
  return a.includes(":"); // a real, global v6 literal
}

/** First global-scope IPv6 across non-virtual interfaces, or null. */
export function detectGlobalIpv6(): string | null {
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    if (SKIP_NAME_RE.test(name)) continue;
    for (const addr of addrs) {
      const isV6 = addr.family === "IPv6" || (addr.family as unknown) === 6;
      if (!isV6) continue;
      if (addr.internal) continue;
      if (isGlobalIpv6(addr.address)) return addr.address;
    }
  }
  return null;
}

/**
 * Resolve the host's public IPv4 via a configurable IP-echo lookup. OPTIONAL +
 * fails gracefully: an unreachable / disabled echo never blocks hosting — it
 * just means no public-ipv4 candidate. Default URL comes from
 * RAZZOOZLE_IP_ECHO_URL; if unset, the lookup is skipped entirely.
 *
 * The echo response is treated as an opaque IPv4 string and only loosely
 * shape-checked here; the gateway does the authoritative §6.1 validation.
 */
export async function detectPublicIpv4(opts?: {
  echoUrl?: string;
  timeoutMs?: number;
}): Promise<string | null> {
  const url = opts?.echoUrl ?? process.env.RAZZOOZLE_IP_ECHO_URL ?? "";
  if (!url) return null; // no echo configured => skip, don't block
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 4000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    // Accept a bare "1.2.3.4" or a JSON body with an ip-ish field.
    const m =
      /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text) ??
      /"(?:ip|address|origin)"\s*:\s*"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})"/.exec(
        text,
      );
    return m ? m[1]! : null;
  } catch {
    return null; // unreachable / timeout / DNS fail — degrade, never throw
  } finally {
    clearTimeout(timer);
  }
}

export interface BuildCandidatesOptions {
  /** Public LAN/host port the front server binds (e.g. 7777). */
  port: number;
  /** Pre-detected LAN result (avoids re-enumerating). */
  lan?: LanDetectResult;
  /** Run the optional public-ipv4 IP-echo lookup (default true). */
  publicIpv4?: boolean;
  /** Echo URL override for the public-ipv4 lookup. */
  echoUrl?: string;
  /** A manual candidate URL (operator-supplied tunnel/DDNS). Default from env. */
  manualUrl?: string;
}

/**
 * Build the HostCandidate[] the host advertises to the gateway (§2.1, F6 url
 * shapes). Never throws on network failure — public-ipv4 echo degrades to
 * "skip". Returns at least the LAN candidate when a LAN IP exists; the caller
 * decides whether to register if the list is empty.
 */
export async function buildHostCandidates(
  opts: BuildCandidatesOptions,
): Promise<HostCandidate[]> {
  const lan = opts.lan ?? detectLanIpv4();
  const candidates: HostCandidate[] = [];

  // 1) LAN — http://<lan-ip>:<port> (priority 0, try first). Only same-subnet.
  if (lan.ip) {
    candidates.push({
      id: randomUUID(),
      kind: "lan",
      url: `http://${lan.ip}:${opts.port}`,
      priority: 0,
      observedFrom: "host",
      verified: false,
    });
  }

  // 2) public-ipv6 — from a global-scope IPv6 on the NICs, if present. Bracketed.
  const v6 = detectGlobalIpv6();
  if (v6) {
    candidates.push({
      id: randomUUID(),
      kind: "public-ipv6",
      url: `http://[${v6}]:${opts.port}`,
      priority: 5,
      observedFrom: "host",
      verified: false,
    });
  }

  // 3) public-ipv4 — OPTIONAL via IP-echo. verified:false (we never probed the
  //    forwarded port; we only learned the public address). Fails gracefully.
  if (opts.publicIpv4 !== false) {
    const echoUrl = opts.echoUrl ?? process.env.RAZZOOZLE_IP_ECHO_URL;
    if (echoUrl) {
      const pub = await detectPublicIpv4({ echoUrl });
      if (pub) {
        candidates.push({
          id: randomUUID(),
          kind: "public-ipv4",
          url: `http://${pub}:${opts.port}`,
          priority: 10,
          observedFrom: "stun",
          verified: false,
        });
      }
    }
  }

  // 4) manual — operator-supplied tunnel / DDNS hostname (env or UI). A hostname
  //    is fine for kind:manual (§6.1); we don't validate beyond a basic shape.
  const manualUrl = opts.manualUrl ?? process.env.RAZZOOZLE_MANUAL_URL;
  if (manualUrl) {
    candidates.push({
      id: randomUUID(),
      kind: "manual",
      url: manualUrl,
      priority: 15,
      observedFrom: "manual",
      verified: false,
    });
  }

  // TODO(Phase-5): UPnP / NAT-PMP — open a port mapping on the gateway router and
  // add a `kind: "upnp"` candidate (observedFrom: "upnp"). Out of scope here.

  return candidates;
}
