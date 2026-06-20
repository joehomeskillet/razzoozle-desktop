<div align="center">

<img src="docs/screenshots/hero.webp" width="680" alt="Razzoozle Desktop" />

# Razzoozle Desktop

### La primera aplicación de escritorio para Windows de Razzoozle — ejecuta el cuestionario en vivo en tu propio PC; los teléfonos de los jugadores se conectan **directamente**.

🌐 [English](README.md) · [Deutsch](README.de.md) · **Español** · [Français](README.fr.md) · [Italiano](README.it.md) · [中文](README.zh.md)

[![Status: Beta](https://img.shields.io/badge/status-beta-F59E0B.svg)](#-estado)
![Windows](https://img.shields.io/badge/Windows-0078D4?logo=windows&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-5FA04E?logo=nodedotjs&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio&logoColor=white)

**[🎮 Razzoozle](https://github.com/joehomeskillet/Razzoozle)** · **[🛰️ Gateway](https://github.com/joehomeskillet/razzloo-gateway)** · **[Reportar un problema](https://github.com/joehomeskillet/razzoozle-desktop/issues)** · *ejecuta [Razzoozle](https://github.com/joehomeskillet/Razzoozle), bifurcado de [Ralex91/Razzia](https://github.com/Ralex91/Razzia)*

</div>

---

## 🧩 ¿Qué es esto?

**Razzoozle Desktop** es la **primera aplicación de escritorio para Windows** de [Razzoozle](https://github.com/joehomeskillet/Razzoozle), la plataforma de cuestionarios en vivo autoalojada. Ejecuta todo el juego **en tu propio PC** — sin servidor que alquilar, sin cuenta, sin nube. Inicias el alojamiento, aparecen un código y un QR, y los jugadores se unen desde sus teléfonos. En la misma red Wi-Fi, sus teléfonos se conectan **directamente a tu máquina**: sin retransmisión, sin intermediarios, **ningún dato del juego sale nunca del PC anfitrión**.

> 🎉 Esta es la **primera aplicación para Windows** del proyecto Razzoozle — un hito que lleva el cuestionario en vivo de un servidor alojado al escritorio propio de quien hace de anfitrión.

**No** bifurca ni copia Razzoozle. Aloja los **mismos** `@razzoozle/web` y `@razzoozle/socket` que ejecuta el producto alojado, empaquetados en una aplicación Electron.

---

## ⚙️ Cómo funciona

1. **Inicia el alojamiento.** La aplicación detecta la dirección LAN de tu PC, arranca localmente el servidor web y de socket reutilizado de Razzoozle, y muestra un **código de acceso + QR**.
2. **Los jugadores se unen.** Escanean el QR o escriben el código en sus teléfonos.
3. **Conexión directa.** En la **misma Wi-Fi** es **LAN-directo sin ninguna configuración** — el teléfono navega directamente al origen `http://` de tu anfitrión y se conecta sin intermediarios. **Todo el juego fluye teléfono ↔ anfitrión; nada pasa por un servidor intermedio.**
4. **Descubrimiento más allá de la LAN (opcional, opt-in).** Una **pasarela de encuentro opcional** (`gw.razzoozle.xyz`, el repositorio [razzloo-gateway](https://github.com/joehomeskillet/razzloo-gateway)) ayuda a los teléfonos a **encontrar** al anfitrión cuando no están en la misma red. Es **solo para descubrimiento** — almacena metadatos de la sesión y endpoints candidatos, genera un código de acceso y entrega a los teléfonos la dirección del anfitrión. **Nunca retransmite el juego, no aloja ningún estado del juego, y no pasa ningún dato del juego por ella.**

```
CÓMO FUNCIONA

(A) Misma Wi-Fi — el caso sencillo, sin configuración

    player phone  ──── join code / QR ───►  Razzoozle Desktop
                  ◄──────── game ─────────►  (host · your PC :7777)
                                             el cuestionario nunca sale de tu LAN

(B) Teléfono en otra red — descubrimiento opcional (opt-in) a través del gateway

    1) Razzoozle Desktop ──register CODE + addresses──►  Gateway (gw.razzoozle.xyz)
    2) phone   ──open  gw.razzoozle.xyz/j/CODE────────►  Gateway
    3) phone   ◄──────── host addresses ──────────────   Gateway
    4) phone   ═════════ connects DIRECT to host ═══════►  Razzoozle Desktop

    El gateway solo asigna CODE -> dirección del anfitrión. No guarda datos del juego y
    nunca retransmite el juego — una vez que el teléfono tiene la dirección, se aparta.
```

### La conexión directa es honesta sobre sus límites

Como **no hay retransmisión** del juego, un teléfono que **no** está en la Wi-Fi del anfitrión solo puede alcanzarlo si existe una ruta directa:

- ✅ **Misma Wi-Fi / LAN** — funciona sin ninguna configuración (la ruta predeterminada y recomendada).
- ✅ **IPv6 público** — si tanto el anfitrión como el teléfono tienen IPv6 funcional, se puede establecer una conexión directa.
- ⚙️ **Reenvío de puertos / UPnP** — un puerto reenviado (manual o por UPnP) expone al anfitrión por IPv4.
- ✍️ **Manual** — el anfitrión comparte directamente una dirección alcanzable.

Las redes de invitados y el aislamiento AP/cliente pueden bloquear las conexiones teléfono-a-anfitrión incluso en la misma Wi-Fi — es una política de red que la aplicación no puede sortear. NAT sin IPv6 ni puerto reenviado significa que los teléfonos fuera de la LAN no pueden alcanzar al anfitrión. **La pasarela solo ayuda a los teléfonos a *encontrar* al anfitrión; no puede atravesar el NAT ni retransmitir tráfico.**

---

## 🚦 Estado

**Beta — en desarrollo.** El alojamiento LAN básico funciona; algunas piezas aún se están conectando.

- ✅ Arranca el servidor web y de socket reutilizado de Razzoozle, detecta la IP LAN, muestra un QR de acceso real + URL.
- 🚧 Un **`.exe` firmado a través de GitHub Releases está por llegar.** Por ahora, **compila y ejecuta desde el código fuente (dev)** — ver abajo.
- 🚧 El registro/heartbeat de sesión en la pasarela y el flujo de actualización en tiempo de ejecución llegan de forma incremental.

Cuando llegue el instalador, el propio `.exe` estará **sin firmar** en las primeras versiones (una advertencia única de **SmartScreen** de Windows, "aplicación no reconocida" → *Más información → Ejecutar de todas formas*); la **integridad** de la actualización proviene de un manifiesto `latest.yml` **firmado con minisign**, verificado antes de cualquier actualización, no de un binario firmado.

---

## 📦 Instalación y ejecución (dev)

Esta es la ruta admitida durante la Beta. Necesitas **Node.js**, **pnpm** (para el núcleo reutilizado) y **Electron** (instalado vía `npm`).

**1 — Compila el núcleo reutilizado de Razzoozle** (la app de escritorio aloja el web + socket precompilado):

```bash
cd /ruta/a/Razzoozle
pnpm install
pnpm --filter @razzoozle/socket build   # -> packages/socket/dist
pnpm --filter @razzoozle/web build       # -> packages/web/dist
```

**2 — Compila y verifica la app de escritorio:**

```bash
cd /ruta/a/razzoozle-desktop
npm install
npm run typecheck      # tsc --noEmit
npm run build          # tsc -> dist/
npm run smoke          # arranca el servidor reutilizado en headless, comprueba ping/LAN/QR
```

**3 — Ejecuta la ventana de Electron** (en un escritorio Windows):

```bash
npm run dev            # compila y luego lanza electron .
```

Haz clic en **Start hosting**. La app detecta tu IPv4 de LAN, arranca el servidor reutilizado de Razzoozle en `0.0.0.0:7777` y muestra un QR + la URL de LAN `http://<lan-ip>:7777/`. Un teléfono en la misma Wi-Fi lo escanea, abre el origen del anfitrión y se conecta directamente.

> La ventana completa de Electron necesita una pantalla, así que en un servidor headless el servidor anfitrión + la detección de LAN + el QR se verifican con `npm run smoke` (sin Electron). En un escritorio Windows, `npm run dev` abre la ventana real.

---

## 🔗 Proyectos relacionados

- **[Razzoozle](https://github.com/joehomeskillet/Razzoozle)** — la plataforma de cuestionarios en vivo autoalojada que ejecuta esta app.
- **[razzloo-gateway](https://github.com/joehomeskillet/razzloo-gateway)** — la pasarela de encuentro opcional (`gw.razzoozle.xyz`): solo descubrimiento, sin retransmisión del juego.

---

## 📝 Créditos y licencia

Razzoozle Desktop aloja [**Razzoozle**](https://github.com/joehomeskillet/Razzoozle), que es una bifurcación de [**Ralex91/Razzia**](https://github.com/Ralex91/Razzia) — muchas gracias a los autores originales. Se conserva el linaje MIT de Razzoozle/Razzia.
