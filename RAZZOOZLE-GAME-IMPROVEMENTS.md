# Razzoozle — Game-Side Improvements for Optimal Desktop Embedding

**Audience:** Claude Code working in the **game** repo (`razzlo` / Razzoozle, `packages/web` + `packages/socket`).
**Why:** "Razzoozle Desktop" (Electron) embeds this game by serving `web/dist` on `127.0.0.1:7777` and loading `/manager` in a frameless window with auto-login. Today the desktop needs several **workarounds** because of game-side assumptions. The changes below remove the need for those workarounds and make the game cleanly embeddable. Source refs are to the cloned game tree.

Derived from a 4-model red-team (Opus 4.8 + GPT-5.5 + Gemini 3.1 Pro + a free panel) + sub-finders. None of these are required for the desktop to work *today* (the desktop has local workarounds), but each lets the desktop drop a workaround.

---

## 1. [CRITICAL] `window.razzoozle` is mutated via `Object.assign` with no extensibility guard
**Files:** `packages/web/src/features/theme/apply.ts:101`, `packages/web/src/features/manager/plugins/host.ts:226-227`

Both do `w.razzoozle = Object.assign(w.razzoozle ?? {}, { ... })`. If any embedder (or browser extension) has already defined a **non-extensible / frozen** `window.razzoozle` — e.g. Electron `contextBridge.exposeInMainWorld` deep-freezes exposed objects — `Object.assign` **throws** in ESM strict mode: `TypeError: Cannot add property registerTab, object is not extensible`. `apply.ts` runs from `__root.tsx:68` on the **first render of every route**, so this white-screens the whole app, not just the manager.

**Change — build the namespace defensively (never mutate a possibly-frozen object):**
```ts
// shared helper
function installRazzoozleGlobal(extra: Partial<RazzoozleGlobal>) {
  const w = window as any
  const prev = w.razzoozle
  const base = prev && Object.isExtensible(prev) ? prev : { ...(prev ?? {}) }
  // assign into `base` only when it's our own/extensible; otherwise into a fresh copy
  w.razzoozle = Object.assign(base === prev ? base : {}, prev ?? {}, extra)
}
```
or simply always `Object.assign({}, prev ?? {}, extra)` into a fresh object, or own the slot once via `Object.defineProperty(window, 'razzoozle', { value: host, configurable: true, writable: true })`. This makes the game robust to ANY embedder that touches `window.razzoozle`.

---

## 2. [HIGH] No documented programmatic manager-login API → embedders must inject the DOM form
The only manager auth path is the socket `MANAGER.AUTH` password, driven by `ManagerPassword.tsx` (`features/manager/components/ManagerPassword.tsx:52-66`) + the in-memory store (`features/game/stores/manager.ts`, password never persisted). An embedded host therefore has to set the `<input type=password>` value and `requestSubmit()` — brittle (DOM timing, visible login flash, re-auth on reconnect).

**Change:** expose a tiny documented API the host can call, e.g. `window.razzoozle.login(password)` that sets the store password + emits `MANAGER.AUTH`, **or** accept a one-time auth token via query/header that the server validates (`packages/socket/src/handlers/manager.ts`), gated to same-origin/localhost. Then an embedder authenticates without simulating typing — no flash, survives reconnect natively.

---

## 3. [HIGH] Hard `process.env` coupling with dev-relative defaults that crash in prod
`packages/socket` reads ~17 env vars. Some defaults are **dev-relative** and crash when the var is absent in a packaged app (different cwd):
- `COMFYUI_WORKFLOW` / `COMFYUI_IMG2IMG_WORKFLOW` default to `./workflows/*.json` (`services/comfyui.ts:17-25`) → `fs.readFileSync` `ENOENT` (`comfyui.ts:174,237`) the moment AI image-gen runs.
- `BRANDING_PATH` unset → fallback `resolve(cwd, '../../branding')` (`services/config.ts:115,119`) → branded assets 404 in a packaged layout.

**Change:** resolve these relative to the package/install dir (`__dirname` / `import.meta.url`), bundle the default workflows + branding, and **degrade gracefully** (never crash) when an optional service is unconfigured. Document the minimal **required** env set vs optional. This lets an embedder use a strict env allowlist (which the desktop does, to keep dev-mode off) without losing features.

---

## 4. [MEDIUM] Frameless-embed layout: support Window Controls Overlay + no forced window scrollbar
- Manager top-right controls — `Logout` (`size-11` = 44px) + `LanguageSwitcher` at `ConsoleShell.tsx:156-158`, and the `/manager` `LanguageSwitcher` at `(auth)/layout.tsx:36` (`absolute top-4 right-4`) — get **occluded** by a frameless window's native min/max/close controls (top-right).
- `body { min-height: 100dvh }` (`index.css:88`) means any host chrome padding pushes content past the viewport → a **window scrollbar**.

**Change:** respect the Window Controls Overlay CSS env vars when present — pad/clear the manager header against `env(titlebar-area-x)` / `env(titlebar-area-width)` / `env(titlebar-area-height)` so interactive controls never sit under the window buttons; and make the app shell `height: 100dvh; overflow: hidden` with internal scroll regions so host chrome can't force a window-level scrollbar.

---

## 5. [MEDIUM] Error boundary + missing-config redirect assume a player context
On any uncaught error the app sends the user to the **player** home `/`:
- `ErrorBoundary.tsx:47` → `window.location.assign("/")` (hard nav)
- `AnimatedErrorPage.tsx:262` → `navigate({ to: "/" })` (default `handleBack`, used by `__root.tsx:107` errorComponent)
And `/manager/config` redirects to `/manager` when `config` is null (`pages/manager/config.tsx:85-87`).
For a **presenter/host** embed, landing on the player PIN screen is wrong — the host should return to `/manager`.

**Change:** add a "host/presenter" mode (a config flag or route context) so the error-fallback + missing-config redirect target is `/manager` instead of `/`, and make the error-boundary back-target configurable. This lets the desktop drop its main-process navigation guard.

---

## 6. [LOW] Plugin-host build order + global footprint
`apply.ts` (theme) and `host.ts` (plugin) both write `window.razzoozle` in an order-dependent merge (see comments at `apply.ts:95-99`, `host.ts:97`). A single shared, guarded install helper (per #1) removes the fragility and the duplicated merge logic, and keeps the global footprint to one well-defined namespace.

---

## Net effect
With **#1 + #2 + #4 + #5** the desktop could drop: the preload-removal workaround, the DOM form-injection auto-login, the CSS shim, and the navigation guard — i.e. the game would be cleanly embeddable by any Electron/webview host with zero per-host hacks.
