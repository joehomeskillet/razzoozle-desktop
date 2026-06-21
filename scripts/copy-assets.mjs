// Copy non-TS renderer assets (the HTML shell) into dist so Electron can load
// dist/renderer/index.html next to the compiled dist/renderer/index.js.
// Cross-platform (the app targets Windows); pure node, no shell cp.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)); // <root>/scripts
const root = path.dirname(here); // <root>
const srcHtml = path.join(root, "src", "renderer", "index.html");
const outDir = path.join(root, "dist", "renderer");

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(srcHtml, path.join(outDir, "index.html"));
console.log("copied renderer/index.html -> dist/renderer/index.html");

// Copy all .woff2 font files from src/renderer to dist/renderer
for (const f of fs.readdirSync(path.dirname(srcHtml))) {
  if (f.endsWith(".woff2")) {
    fs.copyFileSync(path.join(path.dirname(srcHtml), f), path.join(outDir, f));
    console.log(`copied renderer/${f} -> dist/renderer/${f}`);
  }
}

// Copy the app icon (Rahoot lightning mark) into dist so the BrowserWindow can
// load it at runtime (dist is bundled via electron-builder `files: dist/**/*`).
// createWindow() resolves it as path.join(__dirname, "../icon.ico"), i.e.
// dist/main -> dist/icon.ico. The same build/icon.ico drives the .exe/installer.
const distRoot = path.join(root, "dist");
fs.mkdirSync(distRoot, { recursive: true });
fs.copyFileSync(path.join(root, "build", "icon.ico"), path.join(distRoot, "icon.ico"));
console.log("copied build/icon.ico -> dist/icon.ico");
