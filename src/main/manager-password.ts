// Manager password persistence — per-installation credential stored in Windows Registry.
//
// On Windows:
//   - For machine installs (under Program Files): stored in HKLM\Software\Razzoozle
//   - For per-user installs (e.g. LocalAppData): stored in HKCU\Software\Razzoozle
//   - Uses reg.exe to read/write the registry value (REG_SZ)
//   - If registry write fails (e.g. HKLM without admin), falls back to plaintext file
//
// On Linux/macOS:
//   - Uses plaintext file in userData (for dev/testing)
//   - Generates a random base64url password (18 bytes → 24 chars) on first run
//
// Always returns the same cached password on subsequent calls within the process.

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

function loadElectron(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electron = require("electron") as {
    app: { getPath(name: "userData"): string };
  };
  return electron.app.getPath("userData");
}

/**
 * Determine the registry hive based on install scope.
 * If the executable is under Program Files, use HKLM (machine); otherwise HKCU (per-user).
 */
function getRegistryHive(): "HKCU" | "HKLM" {
  const execPath = process.execPath.toLowerCase();
  const programFiles = process.env["ProgramFiles"]?.toLowerCase() ?? "";
  const programFilesX86 = process.env["ProgramFiles(x86)"]?.toLowerCase() ?? "";

  if (
    (programFiles && execPath.includes(programFiles)) ||
    (programFilesX86 && execPath.includes(programFilesX86)) ||
    execPath.includes("\\program files")
  ) {
    return "HKLM";
  }
  return "HKCU";
}

/**
 * Read password from Windows Registry (HKCU or HKLM).
 * Returns the password string if found, null if not present or read fails.
 */
function readPasswordFromRegistry(): string | null {
  if (process.platform !== "win32") return null;

  try {
    const hive = getRegistryHive();
    const output = execFileSync(
      "reg",
      ["query", `${hive}\\Software\\Razzoozle`, "/v", "ManagerPassword"],
      { windowsHide: true, encoding: "utf8" },
    );

    // Parse the reg query output: find the line with ManagerPassword and extract the value
    // Format: "    ManagerPassword    REG_SZ    <value>"
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      if (line.includes("ManagerPassword")) {
        const parts = line.split(/REG_SZ/i);
        if (parts.length >= 2) {
          const value = parts[1].trim();
          if (value) return value;
        }
      }
    }

    return null;
  } catch {
    // Registry key doesn't exist or read failed
    return null;
  }
}

/**
 * Write password to Windows Registry (HKCU or HKLM).
 * If registry write fails, falls back to writing to a plaintext file.
 * Always returns the password (either from registry or fallback file).
 */
function writePasswordToRegistry(password: string, userData: string): string {
  if (process.platform !== "win32") {
    // Non-Windows: fall back to plaintext file
    return writePasswordToFile(password, userData);
  }

  try {
    const hive = getRegistryHive();
    execFileSync(
      "reg",
      [
        "add",
        `${hive}\\Software\\Razzoozle`,
        "/v",
        "ManagerPassword",
        "/t",
        "REG_SZ",
        "/d",
        password,
        "/f",
      ],
      { windowsHide: true },
    );
    return password;
  } catch (err) {
    // Registry write failed (e.g. HKLM without admin permissions)
    // Fall back to plaintext file
    console.warn("Failed to write manager password to registry:", err);
    return writePasswordToFile(password, userData);
  }
}

/**
 * Read password from plaintext fallback file in userData.
 */
function readPasswordFromFile(userData: string): string | null {
  const file = path.join(userData, "manager-pass.txt");
  try {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, "utf8").trim();
      if (content) return content;
    }
  } catch (err) {
    console.warn("Failed to read manager password from file:", err);
  }
  return null;
}

/**
 * Write password to plaintext fallback file in userData.
 */
function writePasswordToFile(password: string, userData: string): string {
  const file = path.join(userData, "manager-pass.txt");
  try {
    fs.writeFileSync(file, password, "utf8");
  } catch (err) {
    console.error("Failed to write manager password to fallback file:", err);
    // Continue anyway — we have it in memory.
  }
  return password;
}

/**
 * Securely persist and retrieve the manager password.
 * Windows: Registry (HKCU or HKLM) with plaintext fallback.
 * Linux/macOS: Plaintext file in userData.
 */
export class ManagerPasswordStore {
  private cachedPassword: string | null = null;

  /**
   * Get the persisted manager password, generating + storing it on first run.
   * Always returns a non-empty string (never null).
   */
  getPassword(): string {
    if (this.cachedPassword) return this.cachedPassword;

    const userData = loadElectron();

    // Try to read from Windows Registry (if on Windows)
    if (process.platform === "win32") {
      const regPassword = readPasswordFromRegistry();
      if (regPassword) {
        this.cachedPassword = regPassword;
        return this.cachedPassword;
      }
    }

    // Try to read from plaintext fallback file
    const filePassword = readPasswordFromFile(userData);
    if (filePassword) {
      this.cachedPassword = filePassword;
      return this.cachedPassword;
    }

    // First run or both reads failed: generate a fresh password
    const password = randomBytes(18).toString("base64url");
    this.cachedPassword = password;

    // Persist it (registry on Windows with file fallback, or just file on other platforms)
    if (process.platform === "win32") {
      writePasswordToRegistry(password, userData);
    } else {
      writePasswordToFile(password, userData);
    }

    return password;
  }
}
