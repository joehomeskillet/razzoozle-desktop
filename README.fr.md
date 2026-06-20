<div align="center">

<img src="docs/screenshots/hero.webp" width="680" alt="Razzoozle Desktop" />

# Razzoozle Desktop

### La première application de bureau Windows pour Razzoozle — lancez le quiz en direct sur votre propre PC ; les téléphones des joueurs se connectent **directement**.

🌐 [English](README.md) · [Deutsch](README.de.md) · [Español](README.es.md) · **Français** · [Italiano](README.it.md) · [中文](README.zh.md)

[![Status: Beta](https://img.shields.io/badge/status-beta-F59E0B.svg)](#-statut)
![Windows](https://img.shields.io/badge/Windows-0078D4?logo=windows&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-5FA04E?logo=nodedotjs&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio&logoColor=white)

**[🎮 Razzoozle](https://github.com/joehomeskillet/Razzoozle)** · **[🛰️ Gateway](https://github.com/joehomeskillet/razzloo-gateway)** · **[Signaler un problème](https://github.com/joehomeskillet/razzoozle-desktop/issues)** · *exécute [Razzoozle](https://github.com/joehomeskillet/Razzoozle), forké depuis [Ralex91/Razzia](https://github.com/Ralex91/Razzia)*

</div>

---

## 🧩 Qu'est-ce que c'est ?

**Razzoozle Desktop** est la **première application de bureau Windows** pour [Razzoozle](https://github.com/joehomeskillet/Razzoozle), la plateforme de quiz en direct auto-hébergée. Elle exécute tout le jeu **sur votre propre PC** — aucun serveur à louer, aucun compte, aucun cloud. Vous démarrez l'hébergement, un code et un QR apparaissent, et les joueurs rejoignent depuis leurs téléphones. Sur le même Wi-Fi, leurs téléphones se connectent **directement à votre machine** : aucun relais, aucun intermédiaire, **aucune donnée de jeu ne quitte jamais le PC hôte**.

> 🎉 Voici la **première application Windows** du projet Razzoozle — une étape clé qui sort le quiz en direct d'un serveur hébergé pour le poser sur le bureau de l'hôte.

Elle ne forke ni ne copie Razzoozle. Elle héberge les **mêmes** `@razzoozle/web` et `@razzoozle/socket` que le produit hébergé, empaquetés dans une application Electron.

---

## ⚙️ Comment ça marche

1. **Démarrez l'hébergement.** L'application détecte l'adresse LAN de votre PC, lance localement le serveur web et socket réutilisé de Razzoozle, et affiche un **code de connexion + QR**.
2. **Les joueurs rejoignent.** Ils scannent le QR ou saisissent le code sur leurs téléphones.
3. **Connexion directe.** Sur le **même Wi-Fi**, c'est du **LAN-direct sans aucune configuration** — le téléphone navigue directement vers l'origine `http://` de votre hôte et s'y connecte sans intermédiaire. **Tout le jeu circule téléphone ↔ hôte ; rien ne passe par un serveur intermédiaire.**
4. **Découverte au-delà du LAN (en option, opt-in).** Une **passerelle de rendez-vous optionnelle** (`gw.razzoozle.xyz`, le dépôt [razzloo-gateway](https://github.com/joehomeskillet/razzloo-gateway)) aide les téléphones à **trouver** l'hôte lorsqu'ils ne sont pas sur le même réseau. Elle sert **uniquement à la découverte** — elle stocke des métadonnées de session et des points de terminaison candidats, génère un code de connexion et transmet aux téléphones l'adresse de l'hôte. **Elle ne relaie jamais le jeu, n'héberge aucun état de jeu, et aucune donnée de jeu n'y transite.**

```
COMMENT ÇA MARCHE

(A) Même Wi-Fi — le cas simple, aucune configuration

    player phone  ──── join code / QR ───►  Razzoozle Desktop
                  ◄──────── game ─────────►  (host · your PC :7777)
                                             le quiz ne quitte jamais votre LAN

(B) Téléphone sur un autre réseau — découverte optionnelle (opt-in) via la passerelle

    1) Razzoozle Desktop ──register CODE + addresses──►  Gateway (gw.razzoozle.xyz)
    2) phone   ──open  gw.razzoozle.xyz/j/CODE────────►  Gateway
    3) phone   ◄──────── host addresses ──────────────   Gateway
    4) phone   ═════════ connects DIRECT to host ═══════►  Razzoozle Desktop

    La passerelle se contente d'associer CODE -> adresse de l'hôte. Elle ne conserve aucune donnée de jeu et
    ne relaie jamais le jeu — une fois que le téléphone a l'adresse, elle s'efface.
```

### La connexion directe est honnête sur ses limites

Comme il n'y a **aucun relais** de jeu, un téléphone qui n'est **pas** sur le Wi-Fi de l'hôte ne peut l'atteindre que si un chemin direct existe :

- ✅ **Même Wi-Fi / LAN** — fonctionne sans aucune configuration (le chemin par défaut et recommandé).
- ✅ **IPv6 public** — si l'hôte et le téléphone disposent tous deux d'un IPv6 fonctionnel, une connexion directe est possible.
- ⚙️ **Redirection de port / UPnP** — un port redirigé (manuellement ou via UPnP) expose l'hôte en IPv4.
- ✍️ **Manuel** — l'hôte partage directement une adresse joignable.

Les réseaux invités et l'isolation AP/client peuvent bloquer les connexions téléphone-vers-hôte même sur le même Wi-Fi — c'est une politique réseau que l'application ne peut pas contourner. Le NAT sans IPv6 ni port redirigé signifie que les téléphones hors LAN ne peuvent pas atteindre l'hôte. **La passerelle aide seulement les téléphones à *trouver* l'hôte ; elle ne peut pas percer le NAT ni relayer le trafic.**

---

## 🚦 Statut

**Beta — travail en cours.** L'hébergement LAN de base fonctionne ; certaines pièces sont encore en cours de branchement.

- ✅ Lance le serveur web et socket réutilisé de Razzoozle, détecte l'IP LAN, affiche un vrai QR de connexion + URL.
- 🚧 Un **`.exe` signé via GitHub Releases arrive bientôt.** Pour l'instant, **compilez et lancez depuis les sources (dev)** — voir ci-dessous.
- 🚧 L'enregistrement/heartbeat de session sur la passerelle et le flux de mise à jour à l'exécution arrivent de façon incrémentale.

Lorsque l'installeur sortira, le `.exe` lui-même sera **non signé** pour les premières versions (un avertissement **SmartScreen** Windows unique, « application non reconnue » → *Informations complémentaires → Exécuter quand même*) ; l'**intégrité** des mises à jour provient d'un manifeste `latest.yml` **signé avec minisign**, vérifié avant toute mise à jour, et non d'un binaire signé.

---

## 📦 Installation et exécution (dev)

C'est le chemin pris en charge pendant la Beta. Vous avez besoin de **Node.js**, **pnpm** (pour le cœur réutilisé) et **Electron** (installé via `npm`).

**1 — Compilez le cœur réutilisé de Razzoozle** (l'app de bureau héberge le web + socket précompilé) :

```bash
cd /chemin/vers/Razzoozle
pnpm install
pnpm --filter @razzoozle/socket build   # -> packages/socket/dist
pnpm --filter @razzoozle/web build       # -> packages/web/dist
```

**2 — Compilez et vérifiez l'app de bureau :**

```bash
cd /chemin/vers/razzoozle-desktop
npm install
npm run typecheck      # tsc --noEmit
npm run build          # tsc -> dist/
npm run smoke          # lance le serveur réutilisé en headless, vérifie ping/LAN/QR
```

**3 — Lancez la fenêtre Electron** (sur un bureau Windows) :

```bash
npm run dev            # compile, puis lance electron .
```

Cliquez sur **Start hosting**. L'app détecte votre IPv4 de LAN, lance le serveur réutilisé de Razzoozle sur `0.0.0.0:7777` et affiche un QR + l'URL de LAN `http://<lan-ip>:7777/`. Un téléphone sur le même Wi-Fi le scanne, ouvre l'origine de l'hôte et se connecte directement.

> La fenêtre Electron complète nécessite un affichage, donc sur un serveur headless le serveur hôte + la détection LAN + le QR sont vérifiés par `npm run smoke` (sans Electron). Sur un bureau Windows, `npm run dev` ouvre la vraie fenêtre.

---

## 🔗 Projets liés

- **[Razzoozle](https://github.com/joehomeskillet/Razzoozle)** — la plateforme de quiz en direct auto-hébergée que cette app exécute.
- **[razzloo-gateway](https://github.com/joehomeskillet/razzloo-gateway)** — la passerelle de rendez-vous optionnelle (`gw.razzoozle.xyz`) : découverte uniquement, aucun relais de jeu.

---

## 📝 Crédits et licence

Razzoozle Desktop héberge [**Razzoozle**](https://github.com/joehomeskillet/Razzoozle), qui est un fork de [**Ralex91/Razzia**](https://github.com/Ralex91/Razzia) — un grand merci aux auteurs en amont. La lignée MIT de Razzoozle/Razzia est conservée.
