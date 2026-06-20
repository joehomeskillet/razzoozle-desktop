<div align="center">

<img src="docs/screenshots/hero.webp" width="680" alt="Razzoozle Desktop" />

# Razzoozle Desktop

### The first Windows desktop app for Razzoozle — run the live quiz on your own PC; players' phones connect **directly**.

🌐 **English** · [Deutsch](README.de.md) · [Español](README.es.md) · [Français](README.fr.md) · [Italiano](README.it.md) · [中文](README.zh.md)

[![Status: Beta](https://img.shields.io/badge/status-beta-F59E0B.svg)](#-status)
![Windows](https://img.shields.io/badge/Windows-0078D4?logo=windows&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-5FA04E?logo=nodedotjs&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio&logoColor=white)

**[🎮 Razzoozle](https://github.com/joehomeskillet/Razzoozle)** · **[🛰️ Gateway](https://github.com/joehomeskillet/razzloo-gateway)** · **[Report an issue](https://github.com/joehomeskillet/razzoozle-desktop/issues)** · *runs [Razzoozle](https://github.com/joehomeskillet/Razzoozle), forked from [Ralex91/Razzia](https://github.com/Ralex91/Razzia)*

</div>

---

## 🧩 What is this?

**Razzoozle Desktop** is the **first Windows desktop app** for [Razzoozle](https://github.com/joehomeskillet/Razzoozle), the self-hosted live quiz platform. It runs the whole game **on your own PC** — no server to rent, no account, no cloud. You start hosting, a code and a QR appear, and players join from their phones. On the same Wi-Fi their phones connect **straight to your machine**: no relay, no middle-man, **no game data ever leaves the host PC**.

> 🎉 This is the **first Windows app** for the Razzoozle project — a milestone for taking the live quiz off a hosted server and onto a host's own desktop.

It does **not** fork or copy Razzoozle. It hosts the **same** `@razzoozle/web` and `@razzoozle/socket` the hosted product runs, packaged into an Electron app.

---

## ⚙️ How it works

1. **Start hosting.** The app detects your PC's LAN address, boots the reused Razzoozle web + socket server locally, and shows a **join code + QR**.
2. **Players join.** They scan the QR or type the code on their phones.
3. **Direct connect.** On the **same Wi-Fi** it is **LAN-direct with zero setup** — the phone navigates straight to your host's `http://` origin and connects directly. **All gameplay flows phone ↔ host; nothing goes through any server in between.**
4. **Discovery beyond the LAN (opt-in).** An **opt-in rendezvous gateway** (`gw.razzoozle.xyz`, the [razzloo-gateway](https://github.com/joehomeskillet/razzloo-gateway) repo) helps phones **discover** the host when they are not on the same network. It is **discovery only** — it stores session metadata and candidate endpoints, mints a join code, and hands phones the host's address. **It never relays gameplay, hosts no game state, and no game data ever passes through it.**

### Direct-connect is honest about its limits

Because there is **no gameplay relay**, a phone that is **not** on the host's Wi-Fi can only reach the host if a direct path exists:

- ✅ **Same Wi-Fi / LAN** — works with zero setup (the default, recommended path).
- ✅ **Public IPv6** — if both host and phone have working IPv6, a direct connection can be made.
- ⚙️ **Port-forward / UPnP** — a forwarded port (manual or UPnP) exposes the host over IPv4.
- ✍️ **Manual** — the host shares a reachable address directly.

Guest networks and AP/client isolation can block phone-to-host connections even on the same Wi-Fi — that is a network policy the app cannot work around. NAT without IPv6 or a forwarded port means off-LAN phones cannot reach the host. **The gateway only helps phones *find* the host; it cannot punch through NAT or relay traffic.**

---

## 🚦 Status

**Beta — work in progress.** Core LAN hosting works; some pieces are still being wired.

- ✅ Boots the reused Razzoozle web + socket server, detects the LAN IP, shows a real join QR + URL.
- 🚧 A **signed `.exe` via GitHub Releases is coming.** For now, **build and run from source (dev)** — see below.
- 🚧 Gateway session register/heartbeat and the runtime update flow are landing incrementally.

When the installer ships, the `.exe` itself will be **unsigned** for the first releases (a one-time Windows **SmartScreen** "unrecognized app" warning → *More info → Run anyway*); update **integrity** comes from a **minisign-signed `latest.yml`** manifest verified before any update, not from a signed binary.

---

## 📦 Install & run (dev)

This is the supported path during Beta. You need **Node.js**, **pnpm** (for the reused core), and **Electron** (installed via `npm`).

**1 — Build the reused Razzoozle core** (the desktop app hosts the prebuilt web + socket):

```bash
cd /path/to/Razzoozle
pnpm install
pnpm --filter @razzoozle/socket build   # -> packages/socket/dist
pnpm --filter @razzoozle/web build       # -> packages/web/dist
```

**2 — Build and verify the desktop app:**

```bash
cd /path/to/razzoozle-desktop
npm install
npm run typecheck      # tsc --noEmit
npm run build          # tsc -> dist/
npm run smoke          # boots the reused server headless, checks ping/LAN/QR
```

**3 — Run the Electron window** (on a Windows desktop):

```bash
npm run dev            # builds, then launches electron .
```

Click **Start hosting**. The app detects your LAN IPv4, boots the reused Razzoozle server on `0.0.0.0:7777`, and shows a QR + the LAN URL `http://<lan-ip>:7777/`. A phone on the same Wi-Fi scans it, opens the host origin, and connects directly.

> The full Electron window needs a display, so on a headless server the host server + LAN detect + QR are verified by `npm run smoke` (no Electron). On a Windows desktop, `npm run dev` opens the real window.

---

## 🔗 Related projects

- **[Razzoozle](https://github.com/joehomeskillet/Razzoozle)** — the self-hosted live quiz platform this app runs.
- **[razzloo-gateway](https://github.com/joehomeskillet/razzloo-gateway)** — the opt-in rendezvous gateway (`gw.razzoozle.xyz`): discovery only, no gameplay relay.

---

## 📝 Credits & license

Razzoozle Desktop hosts [**Razzoozle**](https://github.com/joehomeskillet/Razzoozle), which is a fork of [**Ralex91/Razzia**](https://github.com/Ralex91/Razzia) — huge thanks to the upstream authors. The Razzoozle/Razzia MIT lineage is retained.
