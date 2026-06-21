// R0 relay tunnel client — raw byte-pipe over WebSocket.
//
// PURE NODE — no Electron imports. Usable standalone + unit-testable.
//
// startTunnel() dials a gateway CONTROL WS endpoint, receives stream tokens
// via {t:'open',stream}, dials DATA WS for each token, and pipes local TCP
// (127.0.0.1:hostPort) <-> DATA WS bidirectionally. Reconnects on control
// close with exponential backoff (1s, 2s, 5s, 10s cap). BEST-EFFORT: all
// dial/pipe errors logged, never thrown. TunnelHandle.close() stops reconnect
// and closes everything.

import net from "node:net";
import { WebSocket } from "ws";

export interface TunnelHandle {
  close(): void;
}

interface DataPipe {
  dataWs: WebSocket;
  local: net.Socket;
}

interface TunnelClientState {
  gatewayWsBase: string;
  sessionId: string;
  hostToken: string;
  hostPort: number;
  logger?: (msg: string) => void;

  control: WebSocket | null;
  dataPipes: Set<DataPipe>;
  stopped: boolean;

  // Reconnect state
  nextReconnectMs: number;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectBackoff: number[]; // 1s, 2s, 5s, 10s, 10s, ...
}

export interface StartTunnelOptions {
  gatewayWsBase: string;
  sessionId: string;
  hostToken: string;
  hostPort: number;
  logger?: (msg: string) => void;
}

/** Convert http(s) URL to ws(s) URL. */
export function wsBaseFromHttp(url: string): string {
  return url.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
}

/** Establish a tunnel: dial CONTROL, listen for stream tokens, create DATA pipes. */
export function startTunnel(opts: StartTunnelOptions): TunnelHandle {
  const log = opts.logger ?? console.log;
  const state: TunnelClientState = {
    gatewayWsBase: opts.gatewayWsBase,
    sessionId: opts.sessionId,
    hostToken: opts.hostToken,
    hostPort: opts.hostPort,
    logger: log,

    control: null,
    dataPipes: new Set(),
    stopped: false,

    nextReconnectMs: 0,
    reconnectTimer: null,
    reconnectBackoff: [1000, 2000, 5000, 10000],
  };

  const dialectControl = (): void => {
    if (state.stopped) return;
    try {
      const url = `${state.gatewayWsBase}/relay?sessionId=${encodeURIComponent(
        state.sessionId,
      )}`;
      const control = new WebSocket(url, {
        headers: { Authorization: `Bearer ${state.hostToken}` },
      });

      control.on("open", () => {
        if (state.stopped) {
          try {
            control.close();
          } catch {
            /* ignore */
          }
          return;
        }
        log(`[tunnel] CONTROL open`);
        state.nextReconnectMs = 0;
      });

      control.on("message", (raw: Buffer) => {
        if (state.stopped) return;
        try {
          const msg = JSON.parse(raw.toString("utf8")) as unknown;
          if (
            msg &&
            typeof msg === "object" &&
            "t" in msg &&
            msg.t === "open" &&
            "stream" in msg &&
            typeof (msg as { stream?: unknown }).stream === "string"
          ) {
            const streamToken = (msg as { stream: string }).stream;
            onStreamOpen(state, streamToken);
          }
        } catch (err) {
          log(
            `[tunnel] message parse error: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      });

      control.on("close", () => {
        if (state.stopped) return;
        log(`[tunnel] CONTROL close, scheduling reconnect`);
        state.control = null;
        scheduleReconnect(state, dialectControl);
      });

      control.on("error", (err: Error) => {
        if (state.stopped) return;
        log(`[tunnel] CONTROL error: ${err.message}`);
        state.control = null;
      });

      state.control = control;
    } catch (err) {
      log(
        `[tunnel] CONTROL dial error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      scheduleReconnect(state, dialectControl);
    }
  };

  dialectControl();

  return {
    close(): void {
      if (state.stopped) return;
      state.stopped = true;

      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }

      if (state.control) {
        try {
          state.control.close();
        } catch {
          /* ignore */
        }
        state.control = null;
      }

      for (const pipe of state.dataPipes) {
        try {
          pipe.dataWs.close();
        } catch {
          /* ignore */
        }
        try {
          pipe.local.destroy();
        } catch {
          /* ignore */
        }
      }
      state.dataPipes.clear();

      log(`[tunnel] stopped`);
    },
  };
}

function scheduleReconnect(
  state: TunnelClientState,
  reconnectFn: () => void,
): void {
  if (state.stopped) return;

  const backoffIdx = Math.min(
    Math.floor(state.nextReconnectMs / 1000) || 0,
    state.reconnectBackoff.length - 1,
  );
  const delay =
    state.reconnectBackoff[backoffIdx] ??
    state.reconnectBackoff[state.reconnectBackoff.length - 1];

  state.nextReconnectMs = delay;
  const logger = state.logger ?? console.log;
  logger(
    `[tunnel] reconnect in ${delay}ms (${Math.ceil(
      delay / 1000,
    )}s)`,
  );

  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    reconnectFn();
  }, delay);
}

function onStreamOpen(state: TunnelClientState, streamToken: string): void {
  if (state.stopped) return;

  try {
    const url = `${state.gatewayWsBase}/relay-data?stream=${encodeURIComponent(
      streamToken,
    )}&sessionId=${encodeURIComponent(state.sessionId)}`;
    const dataWs = new WebSocket(url, {
      headers: { Authorization: `Bearer ${state.hostToken}` },
    });

    dataWs.on("open", () => {
      if (state.stopped) {
        try {
          dataWs.close();
        } catch {
          /* ignore */
        }
        return;
      }

      let local: net.Socket | null = null;
      try {
        local = net.connect(state.hostPort, "127.0.0.1");
      } catch (err) {
        state.logger?.(
          `[tunnel:${streamToken}] local connect error: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        try {
          dataWs.close();
        } catch {
          /* ignore */
        }
        return;
      }

      const pipe: DataPipe = { dataWs, local };
      state.dataPipes.add(pipe);

      local.on("data", (chunk: Buffer) => {
        if (state.stopped || !state.dataPipes.has(pipe)) return;
        try {
          dataWs.send(chunk, { binary: true }, (err?: Error | null) => {
            if (err) {
              state.logger?.(
                `[tunnel:${streamToken}] dataWs.send error: ${err.message}`,
              );
            }
          });
        } catch (err) {
          state.logger?.(
            `[tunnel:${streamToken}] data->ws error: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      });

      local.on("end", () => {
        state.logger?.(
          `[tunnel:${streamToken}] local end`,
        );
        state.dataPipes.delete(pipe);
        try {
          dataWs.close();
        } catch {
          /* ignore */
        }
      });

      local.on("error", (err: Error) => {
        state.logger?.(
          `[tunnel:${streamToken}] local error: ${err.message}`,
        );
        state.dataPipes.delete(pipe);
        try {
          dataWs.close();
        } catch {
          /* ignore */
        }
      });

      dataWs.on("message", (raw: Buffer) => {
        if (state.stopped || !state.dataPipes.has(pipe)) return;
        try {
          local!.write(raw, (err?: Error | null) => {
            if (err) {
              state.logger?.(
                `[tunnel:${streamToken}] local.write error: ${err.message}`,
              );
            }
          });
        } catch (err) {
          state.logger?.(
            `[tunnel:${streamToken}] ws->local error: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      });

      dataWs.on("close", () => {
        state.logger?.(
          `[tunnel:${streamToken}] dataWs close`,
        );
        state.dataPipes.delete(pipe);
        try {
          local!.destroy();
        } catch {
          /* ignore */
        }
      });

      dataWs.on("error", (err: Error) => {
        state.logger?.(
          `[tunnel:${streamToken}] dataWs error: ${err.message}`,
        );
        state.dataPipes.delete(pipe);
        try {
          local!.destroy();
        } catch {
          /* ignore */
        }
      });
    });

    dataWs.on("error", (err: Error) => {
      state.logger?.(
        `[tunnel:${streamToken}] dataWs dial error: ${err.message}`,
      );
    });
  } catch (err) {
    state.logger?.(
      `[tunnel:${streamToken}] dial error: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
