// Preload — the only bridge between the sandboxed renderer and main.
// contextIsolation is on; we expose a tiny, explicit API and nothing else.

import { contextBridge, ipcRenderer } from "electron";

// Mirror of HostStartResult in main/index.ts (kept inline to avoid importing
// main code into the preload bundle).
export interface HostStartResult {
  ok: boolean;
  joinUrl?: string;
  lanIp?: string | null;
  port?: number;
  qrDataUrl?: string;
  warning?: string | null;
  error?: string;
  gatewayEnabled?: boolean;
  gatewayCode?: string;
  gatewayJoinUrl?: string;
  gatewayQrDataUrl?: string;
  gatewayError?: string;
}

const api = {
  startHosting: (opts?: { useGateway?: boolean }): Promise<HostStartResult> =>
    ipcRenderer.invoke("host:start", opts),
  stopHosting: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("host:stop"),
};

contextBridge.exposeInMainWorld("razzoozle", api);

// Renderer-side type for `window.razzoozle` (declared again in the renderer).
export type RazzoozleApi = typeof api;
