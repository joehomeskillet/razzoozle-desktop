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
