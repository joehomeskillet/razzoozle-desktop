// Host-token persistence — Phase-3 skeleton.
//
// The gateway hands out a hostToken ONCE at registration (§11). The host needs
// it for every PATCH/DELETE. We persist it encrypted-at-rest under the app's
// userData dir using Electron safeStorage (OS-backed: DPAPI on Windows,
// Keychain on macOS, libsecret on Linux).
//
// TODO(threat-model): safeStorage on Linux can silently fall back to a plaintext
// "basic" backend when no keyring is available, and the userData file is still
// readable by any process running as the user. For a hardened build, move the
// token into the OS keystore proper (keytar / Windows Credential Manager) and
// scope it per-session. For the MVP a session token is short-lived (30-min TTL,
// dies with the session) so userData + safeStorage is acceptable.
//
// This module is import-safe in a plain Node context (the headless smoke): the
// Electron `app`/`safeStorage` modules are required lazily, so importing this
// file without Electron does not throw.

import fs from "node:fs";
import path from "node:path";
import type { HostTokenStore } from "./gateway-client";

// Lazy + optional Electron handles. Resolved on first use; absent under the
// headless smoke (which never constructs an ElectronTokenStore anyway).
interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
}

function loadElectron(): { userData: string; safeStorage: SafeStorageLike } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electron = require("electron") as {
    app: { getPath(name: "userData"): string };
    safeStorage: SafeStorageLike;
  };
  return {
    userData: electron.app.getPath("userData"),
    safeStorage: electron.safeStorage,
  };
}

/**
 * Electron-backed token store. Persists one encrypted token file per sessionId
 * under <userData>/gateway-tokens/. Falls back to plaintext only if the OS
 * encryption backend is unavailable (see TODO above).
 */
export class ElectronTokenStore implements HostTokenStore {
  private dir: string;
  private safeStorage: SafeStorageLike;

  constructor() {
    const { userData, safeStorage } = loadElectron();
    this.dir = path.join(userData, "gateway-tokens");
    this.safeStorage = safeStorage;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private file(sessionId: string): string {
    // sessionId is a UUID from the gateway; sanitize defensively anyway.
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(this.dir, `${safe}.tok`);
  }

  save(sessionId: string, token: string): void {
    const file = this.file(sessionId);
    if (this.safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(file, this.safeStorage.encryptString(token));
    } else {
      // TODO(threat-model): plaintext fallback — see module header.
      fs.writeFileSync(file, `plain:${token}`, "utf8");
    }
  }

  load(sessionId: string): string | null {
    const file = this.file(sessionId);
    if (!fs.existsSync(file)) return null;
    const buf = fs.readFileSync(file);
    const asText = buf.toString("utf8");
    if (asText.startsWith("plain:")) return asText.slice(6);
    try {
      return this.safeStorage.decryptString(buf);
    } catch {
      return null;
    }
  }

  clear(sessionId: string): void {
    const file = this.file(sessionId);
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* already gone */
    }
  }
}
