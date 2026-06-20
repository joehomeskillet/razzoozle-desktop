<div align="center">

<img src="docs/screenshots/hero.webp" width="680" alt="Razzoozle Desktop" />

# Razzoozle Desktop

### La prima app desktop per Windows di Razzoozle — esegui il quiz dal vivo sul tuo PC; i telefoni dei giocatori si connettono **direttamente**.

🌐 [English](README.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [Français](README.fr.md) · **Italiano** · [中文](README.zh.md)

[![Status: Beta](https://img.shields.io/badge/status-beta-F59E0B.svg)](#-stato)
![Windows](https://img.shields.io/badge/Windows-0078D4?logo=windows&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-5FA04E?logo=nodedotjs&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio&logoColor=white)

**[🎮 Razzoozle](https://github.com/joehomeskillet/Razzoozle)** · **[🛰️ Gateway](https://github.com/joehomeskillet/razzloo-gateway)** · **[Segnala un problema](https://github.com/joehomeskillet/razzoozle-desktop/issues)** · *esegue [Razzoozle](https://github.com/joehomeskillet/Razzoozle), forkato da [Ralex91/Razzia](https://github.com/Ralex91/Razzia)*

</div>

---

## 🧩 Cos'è?

**Razzoozle Desktop** è la **prima app desktop per Windows** di [Razzoozle](https://github.com/joehomeskillet/Razzoozle), la piattaforma di quiz dal vivo auto-ospitata. Esegue l'intero gioco **sul tuo PC** — nessun server da affittare, nessun account, nessun cloud. Avvii l'hosting, appaiono un codice e un QR, e i giocatori si uniscono dai loro telefoni. Sulla stessa rete Wi-Fi, i loro telefoni si connettono **direttamente alla tua macchina**: nessun relay, nessun intermediario, **nessun dato di gioco lascia mai il PC host**.

> 🎉 Questa è la **prima app per Windows** del progetto Razzoozle — un traguardo che porta il quiz dal vivo da un server ospitato al desktop di chi fa da host.

**Non** forka né copia Razzoozle. Ospita gli **stessi** `@razzoozle/web` e `@razzoozle/socket` che esegue il prodotto ospitato, impacchettati in un'app Electron.

---

## ⚙️ Come funziona

1. **Avvia l'hosting.** L'app rileva l'indirizzo LAN del tuo PC, avvia localmente il server web e socket riutilizzato di Razzoozle, e mostra un **codice di accesso + QR**.
2. **I giocatori si uniscono.** Scansionano il QR o digitano il codice sui loro telefoni.
3. **Connessione diretta.** Sulla **stessa Wi-Fi** è **LAN-diretto senza alcuna configurazione** — il telefono naviga direttamente all'origine `http://` del tuo host e si connette senza intermediari. **Tutto il gioco scorre telefono ↔ host; nulla passa attraverso un server intermedio.**
4. **Scoperta oltre la LAN (opt-in, facoltativa).** Un **gateway di rendezvous facoltativo** (`gw.razzoozle.xyz`, il repository [razzloo-gateway](https://github.com/joehomeskillet/razzloo-gateway)) aiuta i telefoni a **trovare** l'host quando non sono sulla stessa rete. Serve **solo alla scoperta** — memorizza i metadati della sessione e gli endpoint candidati, genera un codice di accesso e fornisce ai telefoni l'indirizzo dell'host. **Non inoltra mai il gioco, non ospita alcuno stato di gioco, e nessun dato di gioco vi transita.**

```
COME FUNZIONA

(A) Stessa Wi-Fi — il caso semplice, nessuna configurazione

    player phone  ──── join code / QR ───►  Razzoozle Desktop
                  ◄──────── game ─────────►  (host · your PC :7777)
                                             il quiz non lascia mai la tua LAN

(B) Telefono su un'altra rete — scoperta facoltativa (opt-in) tramite il gateway

    1) Razzoozle Desktop ──register CODE + addresses──►  Gateway (gw.razzoozle.xyz)
    2) phone   ──open  gw.razzoozle.xyz/j/CODE────────►  Gateway
    3) phone   ◄──────── host addresses ──────────────   Gateway
    4) phone   ═════════ connects DIRECT to host ═══════►  Razzoozle Desktop

    Il gateway si limita ad associare CODE -> indirizzo dell'host. Non conserva dati di gioco e
    non inoltra mai il gioco — una volta che il telefono ha l'indirizzo, si fa da parte.
```

### La connessione diretta è onesta sui suoi limiti

Poiché **non c'è relay** del gioco, un telefono che **non** è sulla Wi-Fi dell'host può raggiungerlo solo se esiste un percorso diretto:

- ✅ **Stessa Wi-Fi / LAN** — funziona senza alcuna configurazione (il percorso predefinito e consigliato).
- ✅ **IPv6 pubblico** — se sia l'host sia il telefono hanno un IPv6 funzionante, è possibile una connessione diretta.
- ⚙️ **Port forwarding / UPnP** — una porta inoltrata (manuale o tramite UPnP) espone l'host su IPv4.
- ✍️ **Manuale** — l'host condivide direttamente un indirizzo raggiungibile.

Le reti guest e l'isolamento AP/client possono bloccare le connessioni telefono-verso-host anche sulla stessa Wi-Fi — è una policy di rete che l'app non può aggirare. Il NAT senza IPv6 né porta inoltrata significa che i telefoni fuori dalla LAN non possono raggiungere l'host. **Il gateway aiuta i telefoni solo a *trovare* l'host; non può attraversare il NAT né inoltrare traffico.**

---

## 🚦 Stato

**Beta — lavori in corso.** L'hosting LAN di base funziona; alcune parti sono ancora in fase di collegamento.

- ✅ Avvia il server web e socket riutilizzato di Razzoozle, rileva l'IP LAN, mostra un vero QR di accesso + URL.
- 🚧 Un **`.exe` firmato tramite GitHub Releases è in arrivo.** Per ora, **compila ed esegui dai sorgenti (dev)** — vedi sotto.
- 🚧 La registrazione/heartbeat della sessione sul gateway e il flusso di aggiornamento a runtime arrivano in modo incrementale.

Quando arriverà l'installer, l'`.exe` stesso sarà **non firmato** nelle prime versioni (un avviso **SmartScreen** di Windows una tantum, "app non riconosciuta" → *Ulteriori informazioni → Esegui comunque*); l'**integrità** dell'aggiornamento proviene da un manifesto `latest.yml` **firmato con minisign**, verificato prima di ogni aggiornamento, non da un binario firmato.

---

## 📦 Installazione ed esecuzione (dev)

Questo è il percorso supportato durante la Beta. Servono **Node.js**, **pnpm** (per il core riutilizzato) ed **Electron** (installato tramite `npm`).

**1 — Compila il core riutilizzato di Razzoozle** (l'app desktop ospita il web + socket precompilato):

```bash
cd /percorso/a/Razzoozle
pnpm install
pnpm --filter @razzoozle/socket build   # -> packages/socket/dist
pnpm --filter @razzoozle/web build       # -> packages/web/dist
```

**2 — Compila e verifica l'app desktop:**

```bash
cd /percorso/a/razzoozle-desktop
npm install
npm run typecheck      # tsc --noEmit
npm run build          # tsc -> dist/
npm run smoke          # avvia il server riutilizzato in headless, controlla ping/LAN/QR
```

**3 — Esegui la finestra Electron** (su un desktop Windows):

```bash
npm run dev            # compila, poi avvia electron .
```

Clicca su **Start hosting**. L'app rileva il tuo IPv4 di LAN, avvia il server riutilizzato di Razzoozle su `0.0.0.0:7777` e mostra un QR + l'URL di LAN `http://<lan-ip>:7777/`. Un telefono sulla stessa Wi-Fi lo scansiona, apre l'origine dell'host e si connette direttamente.

> La finestra Electron completa richiede un display, quindi su un server headless il server host + il rilevamento LAN + il QR vengono verificati da `npm run smoke` (senza Electron). Su un desktop Windows, `npm run dev` apre la finestra reale.

---

## 🔗 Progetti correlati

- **[Razzoozle](https://github.com/joehomeskillet/Razzoozle)** — la piattaforma di quiz dal vivo auto-ospitata che questa app esegue.
- **[razzloo-gateway](https://github.com/joehomeskillet/razzloo-gateway)** — il gateway di rendezvous facoltativo (`gw.razzoozle.xyz`): solo scoperta, nessun relay di gioco.

---

## 📝 Crediti e licenza

Razzoozle Desktop ospita [**Razzoozle**](https://github.com/joehomeskillet/Razzoozle), che è un fork di [**Ralex91/Razzia**](https://github.com/Ralex91/Razzia) — un enorme grazie agli autori upstream. La discendenza MIT di Razzoozle/Razzia è mantenuta.
