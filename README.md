# Razzoozle Desktop — Phase-1 LAN-host skeleton

Windows Electron app that hosts a Razzoozle quiz game **on your own machine** so
player phones on the **same Wi-Fi/LAN** join directly. This is **Mode A
"LAN Direct"**: the phone navigates top-level to the host's own `http://` origin
and connects straight to it — the gateway is optional on the LAN path (F4).

> Phase-1 skeleton: boots + serves + pings + shows a real QR. It does NOT yet
> register with the gateway, run the runtime update flow, or ship a signed
> installer. See "What's stubbed" below.

## Reuse, not fork (F2)

The game server (`@razzoozle/socket`) and web app (`@razzoozle/web`) are **not**
forked or copied. This skeleton **spawns the prebuilt socket server** and
**serves the prebuilt web bundle** from the local Razzoozle build, replicating
the prod single-origin layout (nginx serves `web/dist` on `/`, proxies `/ws`,
`/api`, `/healthz` to the socket on `127.0.0.1:3001`).

- **ponytail / F2 debt:** for now the web+socket are consumed from the local
  Razzoozle source tree at `/nvmetank1/projects/Razzoozle/cd-src` (override with
  `RAZZOOZLE_SRC=<path>`). This is **temporary**. Per `docs/repo-strategy.md` F2
  this becomes the **pinned, prebuilt, Renovate-bumped** `@razzoozle/{web,socket}`
  artifact resolved from `node_modules` — **no git submodule** (pnpm
  `workspace:*` will not resolve in a bare subtree). When that lands, swap
  `resolveRazzoozlePaths()` in `src/main/local-server.ts` to read `node_modules`;
  nothing else changes.

## Build the reused core first

The skeleton consumes the **built** Razzoozle web + socket:

```bash
cd /nvmetank1/projects/Razzoozle/cd-src
export PATH=/usr/lib/node_modules/corepack/shims:$PATH   # pnpm@11.5.1
pnpm install
pnpm --filter @razzoozle/socket build   # -> packages/socket/dist/index.cjs
pnpm --filter @razzoozle/web build       # -> packages/web/dist/
```

## Install + verify the desktop app

```bash
cd /nvmetank1/projects/razzoozle-desktop
npm install
npm run typecheck      # tsc --noEmit (passes)
npm run build          # tsc -> dist/ + copies renderer/index.html
npm run smoke          # boots the reused server headless, checks ping/LAN/QR
```

`npm run smoke` is the one runnable verification: it detects the LAN IPv4, boots
the reused Razzoozle server, asserts `GET /desktop-host/ping` returns
`{ok:true, service:"razzoozle-desktop-host", protocolVersion:1}`, confirms the
reused socket's frozen `/healthz` proxies through, and generates a real QR for
`http://<lan-ip>:<port>/`.

## Run the Electron window

```bash
npm run dev      # builds, then launches electron .
```

Click **Start hosting**. The app:
1. detects this machine's LAN IPv4 (skips loopback/docker/virtual; warns if only
   loopback),
2. boots the reused Razzoozle server bound to `0.0.0.0:7777` over **http**,
3. shows a **QR** + the LAN URL `http://<lan-ip>:7777/` — a **top-level URL the
   phone navigates to** (per F4: an https gateway page cannot fetch/ws an http
   LAN host; the QR points straight at the host http origin).

A phone on the same Wi-Fi scans the QR, navigates to the host origin, and
(once gateway registration lands) verifies via the same-origin
`/desktop-host/ping`, then connects directly. **All gameplay flows phone ↔ host;
nothing goes through any gateway.**

> Headless note: the full Electron window cannot launch in a headless CI/server
> shell (no display). The host server + LAN detect + QR are verified by
> `npm run smoke` (no Electron). On a Windows desktop, `npm run dev` opens the
> real window.

## Honest limits (no relay in MVP)

- Players must be on the **same Wi-Fi** as the host. **Guest networks and
  AP/client isolation can block** phone-to-host connections — nothing the app
  can do.
- The **`.exe` is unsigned** (F1). The first run triggers a one-time Windows
  **SmartScreen** "unrecognized app" warning → *More info → Run anyway*. Update
  integrity comes from the **minisign-signed `latest.yml`** (verified before any
  update), not from a signed binary. SmartScreen reputation accrues per-binary;
  an Authenticode cert is out of scope for MVP.

## What's stubbed (clearly marked TODO)

- **Gateway session register / heartbeat** (`POST /api/v1/sessions`, PATCH) —
  not wired; Mode A works LAN-only without it.
- **Connected-player count** — placeholder `—` in the UI (socket.io exposes
  `io.engine.clientsCount`; not piped to main yet).
- **F3 runtime update flow** — `electron-updater` native-github fetch + gateway
  go/hold decision + minisign verify. Wiring sketch + secrets list in
  `electron-builder.yml` (NOTE block) and `../razzloo-gateway/docs/ci-cd-update-channel.md`.
  Stubbed in `src/main/index.ts` (`app.whenReady`).
- **`.github/workflows/release.yml`**, **minisign keypair**, **`.npmrc`** for the
  `@razzoozle/*` registry pin — not added (no artifact published yet).

## File tree

```
razzoozle-desktop/
├── package.json            electron + electron-builder + electron-updater + qrcode + ts
├── tsconfig.json
├── electron-builder.yml    win/nsis, UNSIGNED (F1), publish github, F3 NOTE block
├── renovate.json           watches @razzoozle/{web,socket,common} (F2; effective once pinned)
├── README.md
├── docs/                   repo-strategy.md, ci-cd-update-channel.md (Phase-0)
├── scripts/
│   ├── smoke.mjs           the one runnable verification (no Electron)
│   └── copy-assets.mjs     copies renderer/index.html into dist/
└── src/
    ├── main/
    │   ├── index.ts         Electron main + lifecycle + IPC (host:start/stop)
    │   ├── local-server.ts  REUSE: spawn @razzoozle/socket + serve @razzoozle/web
    │   ├── reachability.ts   LAN IPv4 detection
    │   └── protocol.ts       PROTOCOL_VERSION, /desktop-host/ping shape
    ├── preload/index.ts      contextBridge window.razzoozle API
    └── renderer/
        ├── index.html        minimal host UI (CSP-locked)
        └── index.ts          Start-hosting button -> QR + URL + count + note
```
