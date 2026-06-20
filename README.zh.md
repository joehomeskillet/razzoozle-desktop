<div align="center">

<img src="docs/screenshots/hero.webp" width="680" alt="Razzoozle Desktop" />

# Razzoozle Desktop

### Razzoozle 的首款 Windows 桌面应用 —— 在你自己的电脑上运行实时问答；玩家手机**直连**。

🌐 [English](README.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [Français](README.fr.md) · [Italiano](README.it.md) · **中文**

[![Status: Beta](https://img.shields.io/badge/status-beta-F59E0B.svg)](#-状态)
![Windows](https://img.shields.io/badge/Windows-0078D4?logo=windows&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-5FA04E?logo=nodedotjs&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio&logoColor=white)

**[🎮 Razzoozle](https://github.com/joehomeskillet/Razzoozle)** · **[🛰️ Gateway](https://github.com/joehomeskillet/razzloo-gateway)** · **[报告问题](https://github.com/joehomeskillet/razzoozle-desktop/issues)** · *运行 [Razzoozle](https://github.com/joehomeskillet/Razzoozle)，派生自 [Ralex91/Razzia](https://github.com/Ralex91/Razzia)*

</div>

---

## 🧩 这是什么？

**Razzoozle Desktop** 是 [Razzoozle](https://github.com/joehomeskillet/Razzoozle)（自托管的实时问答平台）的**首款 Windows 桌面应用**。它在**你自己的电脑上**运行整个游戏 —— 无需租用服务器、无需账号、无需云端。你启动主持，屏幕上出现一个代码和二维码，玩家从手机加入。在同一 Wi-Fi 下，他们的手机**直连到你的机器**：没有中继、没有中间人，**任何游戏数据都不会离开主机电脑**。

> 🎉 这是 Razzoozle 项目的**首款 Windows 应用** —— 一个里程碑，把实时问答从托管服务器搬到了主持人自己的桌面上。

它**不**派生或复制 Razzoozle。它托管与托管版产品**完全相同**的 `@razzoozle/web` 和 `@razzoozle/socket`，打包进一个 Electron 应用。

---

## ⚙️ 工作原理

1. **启动主持。** 应用检测你电脑的局域网地址，在本地启动复用的 Razzoozle Web 与 socket 服务器，并显示**加入代码 + 二维码**。
2. **玩家加入。** 他们在手机上扫描二维码或输入代码。
3. **直接连接。** 在**同一 Wi-Fi** 下是**局域网直连、零配置** —— 手机直接导航到你主机的 `http://` 源并直连。**所有游戏过程都在手机 ↔ 主机之间流动；不经过任何中间服务器。**
4. **跨局域网发现（可选，opt-in）。** 一个**可选的会合网关**（`gw.razzoozle.xyz`，即 [razzloo-gateway](https://github.com/joehomeskillet/razzloo-gateway) 仓库）在手机不在同一网络时帮助它们**发现**主机。它**仅用于发现** —— 存储会话元数据和候选端点、生成加入代码、把主机地址交给手机。**它从不中继游戏，不托管任何游戏状态，也没有任何游戏数据经过它。**

### 直连对自身的限制是诚实的

由于**没有游戏中继**，一台**不在**主机 Wi-Fi 上的手机，只有在存在直接路径时才能连上主机：

- ✅ **同一 Wi-Fi / 局域网** —— 零配置即可工作（默认且推荐的路径）。
- ✅ **公网 IPv6** —— 如果主机和手机都有可用的 IPv6，可以建立直接连接。
- ⚙️ **端口转发 / UPnP** —— 转发的端口（手动或通过 UPnP）将主机暴露在 IPv4 上。
- ✍️ **手动** —— 主机直接分享一个可达的地址。

访客网络以及 AP/客户端隔离，即使在同一 Wi-Fi 下也可能阻断手机到主机的连接 —— 这是网络策略，应用无法绕过。没有 IPv6、也没有转发端口的 NAT，意味着局域网外的手机无法连上主机。**网关只帮助手机*找到*主机；它无法穿透 NAT，也不会中继流量。**

---

## 🚦 状态

**Beta —— 开发进行中。** 核心局域网主持已可用；部分功能仍在接入中。

- ✅ 启动复用的 Razzoozle Web 与 socket 服务器，检测局域网 IP，显示真实的加入二维码 + URL。
- 🚧 **通过 GitHub Releases 发布的已签名 `.exe` 即将到来。** 目前请**从源码构建并运行（dev）** —— 见下文。
- 🚧 网关会话注册/心跳与运行时更新流程正逐步接入。

安装包发布后，在最初的几个版本里 `.exe` 本身将是**未签名**的（首次运行会出现一次性的 Windows **SmartScreen**「无法识别的应用」警告 → *更多信息 → 仍要运行*）；更新的**完整性**来自**用 minisign 签名的 `latest.yml`** 清单（在任何更新前先校验），而非来自签名的二进制文件。

---

## 📦 安装与运行（dev）

这是 Beta 期间受支持的路径。你需要 **Node.js**、**pnpm**（用于复用的核心）以及 **Electron**（通过 `npm` 安装）。

**1 —— 先构建复用的 Razzoozle 核心**（桌面应用托管预构建的 Web + socket）：

```bash
cd /path/to/Razzoozle
pnpm install
pnpm --filter @razzoozle/socket build   # -> packages/socket/dist
pnpm --filter @razzoozle/web build       # -> packages/web/dist
```

**2 —— 构建并验证桌面应用：**

```bash
cd /path/to/razzoozle-desktop
npm install
npm run typecheck      # tsc --noEmit
npm run build          # tsc -> dist/
npm run smoke          # 以无头方式启动复用的服务器，检查 ping/LAN/QR
```

**3 —— 运行 Electron 窗口**（在 Windows 桌面上）：

```bash
npm run dev            # 先构建，然后启动 electron .
```

点击 **Start hosting**。应用检测你的局域网 IPv4，在 `0.0.0.0:7777` 上启动复用的 Razzoozle 服务器，并显示二维码 + 局域网 URL `http://<lan-ip>:7777/`。同一 Wi-Fi 下的手机扫描它、打开主机源并直接连接。

> 完整的 Electron 窗口需要显示器，因此在无头服务器上，主机服务器 + 局域网检测 + 二维码由 `npm run smoke`（不含 Electron）来验证。在 Windows 桌面上，`npm run dev` 会打开真实窗口。

---

## 🔗 相关项目

- **[Razzoozle](https://github.com/joehomeskillet/Razzoozle)** —— 本应用所运行的自托管实时问答平台。
- **[razzloo-gateway](https://github.com/joehomeskillet/razzloo-gateway)** —— 可选的会合网关（`gw.razzoozle.xyz`）：仅发现，不中继游戏。

---

## 📝 致谢与许可

Razzoozle Desktop 托管 [**Razzoozle**](https://github.com/joehomeskillet/Razzoozle)，后者是 [**Ralex91/Razzia**](https://github.com/Ralex91/Razzia) 的一个派生 —— 衷心感谢上游作者。Razzoozle/Razzia 的 MIT 血统得以保留。
