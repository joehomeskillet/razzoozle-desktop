// Wire constants shared with the gateway protocol (razzloo-gateway docs/protocol.md).
// Kept tiny + dependency-free so both main and the smoke script can import it.

/** Protocol version carried in payloads + the host /desktop-host/ping (§4, §15). */
export const PROTOCOL_VERSION = 1 as const;

/** Default LAN host port. Distinct from Razzoozle's internal WS port (3001). */
export const DEFAULT_HOST_PORT = 7777;

/** The host's liveness self-check path (protocol.md §15). Lives on the HOST. */
export const PING_PATH = "/desktop-host/ping";

/** Stable service tag returned by /desktop-host/ping. */
export const HOST_SERVICE = "razzoozle-desktop-host" as const;

/** Shape of the /desktop-host/ping response (protocol.md §15). NO game data. */
export interface DesktopHostPing {
  ok: true;
  service: typeof HOST_SERVICE;
  protocolVersion: typeof PROTOCOL_VERSION;
  /** Optional once a gateway session exists; absent in the LAN-only skeleton. */
  sessionId?: string;
}

// ── Gateway rendezvous contract (razzloo-gateway docs/protocol.md) ───────────
// Phase-3: the host registers with the gateway so players can find it beyond
// the LAN. These mirror the gateway's strict-allowlist wire shapes exactly —
// only the permitted fields, or the gateway 400s (F5, §9).

/** Default gateway base URL (§3). Overridable via RAZZOOZLE_GATEWAY_URL. */
export const DEFAULT_GATEWAY_URL = "https://gw.razzoozle.xyz";

/** Candidate kinds the gateway accepts (§2.1). `upnp` is Phase-5, not emitted. */
export type HostCandidateKind =
  | "lan"
  | "public-ipv4"
  | "public-ipv6"
  | "upnp"
  | "manual";

/**
 * A single endpoint the host claims to be reachable on (§2.1). This is the
 * REQUEST shape the host sends — only the allowlisted fields (§2.3). `id` is
 * optional on input (the gateway fills one), but we send a stable id so a
 * candidate survives add/replace by identity.
 */
export interface HostCandidate {
  id?: string;
  kind: HostCandidateKind;
  /** http(s)://host:port — no path/query/fragment (§6.1 write-time validation). */
  url: string;
  /** Lower = client tries first (§2.1). 0..100. */
  priority: number;
  observedFrom?: "host" | "stun" | "upnp" | "manual";
  /** CLIENT claim; the gateway never sets true (§2.1). false unless verified. */
  verified: boolean;
  lastVerifiedAt?: string;
}

/** Response of POST /api/v1/sessions (§5). `hostToken` is shown ONCE. */
export interface RegisterResult {
  sessionId: string;
  joinCode: string;
  joinUrl: string;
  expiresAt: string;
  hostToken: string;
  protocolVersion: number;
}

/** Response of GET /api/v1/update/:channel (§14.1). */
export interface UpdateGateResult {
  decision: "go" | "hold";
  latestVersion: string;
  notes?: string;
  repo: string;
}

/** Update channels the gateway allowlists (§14.1). */
export type UpdateChannel = "stable" | "beta";

/** Heartbeat cadence (§12): host PATCHes every 30 s; TTL slides +30 min. */
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;
