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
