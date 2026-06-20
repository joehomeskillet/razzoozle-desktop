// Gateway rendezvous client — Phase-3.
//
// A typed client for the razzloo-gateway API (docs/protocol.md). It lets the
// desktop host REGISTER a session, HEARTBEAT + update candidates, UNREGISTER,
// and ask the UPDATE-GATE for a go/hold decision.
//
// These calls run from the Electron MAIN process (Node) — NOT a browser — so
// there is no mixed-content concern here; the gateway is reached over HTTPS and
// only ever receives rendezvous metadata. The player-browser top-level-nav-to-
// host-http flow (F4) is unchanged and lives elsewhere.
//
// Contract discipline (F5/§9): every request body carries ONLY the allowlisted
// fields. An extra field is a hard 400 on the gateway. We NEVER send game data.

import { DEFAULT_GATEWAY_URL } from "./protocol";
import type {
  HostCandidate,
  RegisterResult,
  UpdateChannel,
  UpdateGateResult,
} from "./protocol";

/** Resolve the gateway base URL: env override wins, else the prod default. */
export function gatewayBaseUrl(): string {
  const raw = (process.env.RAZZOOZLE_GATEWAY_URL || DEFAULT_GATEWAY_URL).trim();
  return raw.replace(/\/+$/, ""); // no trailing slash
}

/** A gateway request failed with a non-2xx status. Carries the parsed error. */
export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

/** Optional store the client persists the host-token through (see token-store.ts). */
export interface HostTokenStore {
  save(sessionId: string, token: string): void;
  load(sessionId: string): string | null;
  clear(sessionId: string): void;
}

export interface GatewayClientOptions {
  /** Base URL override (defaults to gatewayBaseUrl()). */
  baseUrl?: string;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Where to persist the host-token (skeleton: safeStorage in token-store.ts). */
  tokenStore?: HostTokenStore;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function errorOf(body: unknown): { code?: string; message?: string } {
  if (body && typeof body === "object") {
    const b = body as { error?: unknown; message?: unknown };
    return {
      code: typeof b.error === "string" ? b.error : undefined,
      message: typeof b.message === "string" ? b.message : undefined,
    };
  }
  return {};
}

export class GatewayClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly tokenStore?: HostTokenStore;

  constructor(opts: GatewayClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? gatewayBaseUrl()).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.tokenStore = opts.tokenStore;
  }

  private async request(
    method: string,
    path: string,
    opts: { body?: unknown; token?: string } = {},
  ): Promise<{ status: number; json: unknown }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const headers: Record<string, string> = { accept: "application/json" };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
      });
      const json = await readJson(res);
      return { status: res.status, json };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Register a session (POST /api/v1/sessions, §5). Sends ONLY the allowlisted
   * register fields. Returns the join code/url + the one-time host-token; on
   * success the token is persisted via the tokenStore (if provided) so a
   * heartbeat survives a restart.
   */
  async register(input: {
    hostId: string;
    appVersion: string;
    candidates: HostCandidate[];
  }): Promise<RegisterResult> {
    const body = {
      hostId: input.hostId,
      protocolVersion: 1,
      appVersion: input.appVersion,
      candidates: input.candidates,
    };
    const { status, json } = await this.request("POST", "/api/v1/sessions", {
      body,
    });
    if (status !== 201) {
      const e = errorOf(json);
      throw new GatewayError(status, e.code, e.message ?? `register failed (${status})`);
    }
    const result = json as RegisterResult;
    this.tokenStore?.save(result.sessionId, result.hostToken);
    return result;
  }

  /**
   * Heartbeat + optional candidate mutation (PATCH /api/v1/sessions/:id, §6).
   * - no candidates / candidateOp omitted => pure heartbeat (slides TTL).
   * - candidateOp "replace" => the supplied set becomes the full set.
   * - candidateOp "add"     => upsert by id.
   * Returns the full updated Session view (never carries hostToken, §11).
   */
  async heartbeat(
    sessionId: string,
    token: string,
    opts: { candidateOp?: "replace" | "add"; candidates?: HostCandidate[] } = {},
  ): Promise<unknown> {
    const body: { candidateOp?: "replace" | "add"; candidates?: HostCandidate[] } =
      {};
    if (opts.candidateOp) body.candidateOp = opts.candidateOp;
    if (opts.candidates) body.candidates = opts.candidates;
    const hasBody = Object.keys(body).length > 0;
    const { status, json } = await this.request(
      "PATCH",
      `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
      { token, ...(hasBody ? { body } : {}) },
    );
    if (status !== 200) {
      const e = errorOf(json);
      throw new GatewayError(status, e.code, e.message ?? `heartbeat failed (${status})`);
    }
    return json;
  }

  /**
   * Unregister a session (DELETE /api/v1/sessions/:id, §6). Idempotent: the
   * gateway returns 204 even for an already-gone session. Clears any stored token.
   */
  async unregister(sessionId: string, token: string): Promise<void> {
    const { status, json } = await this.request(
      "DELETE",
      `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
      { token },
    );
    if (status !== 204) {
      const e = errorOf(json);
      throw new GatewayError(status, e.code, e.message ?? `unregister failed (${status})`);
    }
    this.tokenStore?.clear(sessionId);
  }

  /**
   * Update-gate decision (GET /api/v1/update/:channel?appVersion=, §14.1). The
   * gateway returns a go/hold DECISION only — never a binary. On "go" the app
   * uses electron-updater's native github provider + minisign verify (F3, §14.2).
   */
  async updateGate(
    channel: UpdateChannel,
    appVersion: string,
  ): Promise<UpdateGateResult> {
    const { status, json } = await this.request(
      "GET",
      `/api/v1/update/${channel}?appVersion=${encodeURIComponent(appVersion)}`,
    );
    if (status !== 200) {
      const e = errorOf(json);
      throw new GatewayError(status, e.code, e.message ?? `update-gate failed (${status})`);
    }
    return json as UpdateGateResult;
  }
}
