// Manager password persistence — secure per-installation credential.
//
// On first run, generates a random base64url password (18 bytes → 24 chars).
// Persists encrypted-at-rest under the app's userData dir using Electron
// safeStorage (OS-backed: DPAPI on Windows, Keychain on macOS, libsecret on
// Linux). Reuses the same password on every launch, never plaintext.
//
// If safeStorage is unavailable, falls back to plaintext (still random per
// install, never crashes).

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

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
 * Securely persist and retrieve the manager password. Encrypted via Electron
 * safeStorage; plaintext fallback if encryption unavailable.
 */
export class ManagerPasswordStore {
  private file: string;
  private safeStorage: SafeStorageLike;
  private cachedPassword: string | null = null;

  constructor() {
    const { userData, safeStorage } = loadElectron();
    this.file = path.join(userData, "manager-pass.bin");
    this.safeStorage = safeStorage;
  }

  /**
   * Get the persisted manager password, generating + storing it on first run.
   * Always returns a non-empty string (never null).
   */
  getPassword(): string {
    if (this.cachedPassword) return this.cachedPassword;

    // Try to load existing password from disk.
    if (fs.existsSync(this.file)) {
      try {
        const buf = fs.readFileSync(this.file);
        const asText = buf.toString("utf8");

        // Plaintext fallback prefix (for when encryption wasn't available on creation).
        if (asText.startsWith("plain:")) {
          this.cachedPassword = asText.slice(6);
          return this.cachedPassword;
        }

        // Try to decrypt (encryption available).
        try {
          this.cachedPassword = this.safeStorage.decryptString(buf);
          return this.cachedPassword;
        } catch {
          // Decryption failed; fall through to generate a new one.
          console.warn("Failed to decrypt manager password; generating new one");
        }
      } catch (err) {
        console.warn("Failed to read manager password file:", err);
      }
    }

    // First run or read/decrypt failed: generate a fresh password.
    const password = randomBytes(18).toString("base64url");
    this.cachedPassword = password;

    // Persist it (encrypted or plaintext).
    try {
      if (this.safeStorage.isEncryptionAvailable()) {
        fs.writeFileSync(this.file, this.safeStorage.encryptString(password));
      } else {
        // Plaintext fallback — still unique per install, never crashes.
        fs.writeFileSync(this.file, `plain:${password}`, "utf8");
      }
    } catch (err) {
      console.error("Failed to persist manager password:", err);
      // Continue anyway — we have it in memory.
    }

    return password;
  }
}
