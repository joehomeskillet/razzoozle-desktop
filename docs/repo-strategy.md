# Repo Strategy — Razzoozle Direct-Desktop-Host + Rendezvous Gateway

> Phase-0 design doc. Defines the repository topology, the web/socket reuse
> mechanism, and the bootstrap checklist for the two new projects that make up
> the "play on the host's own machine" feature: the **Windows Electron client**
> and the **public rendezvous gateway**.
>
> **FINAL — locked decisions.** This revision supersedes all earlier drafts.
> Self-hosted house stack: Caddy + Gitea + systemd. No AWS / Cloudflare / Vault /
> CAPTCHA.

## 0. TL;DR

- **Two separate repos / projects**, each its own directory under
  `/nvmetank1/projects`. Neither lives inside the Razzoozle monorepo.
  - `razzoozle-desktop` — the Windows Electron client (this repo).
  - `razzloo-gateway` — the public rendezvous service at `gw.razzoozle.xyz`.
- **No fork, no copy, and no git submodule** of the Razzoozle web app or game
  server. The desktop client consumes `@razzoozle/web` + `@razzoozle/socket` as a
  **pinned, prebuilt, versioned artifact** that Razzoozle CI publishes (F2). The
  desktop `package.json` depends on a **pinned version**; **Renovate/Dependabot**
  opens a PR when a newer version publishes, and that PR is **tested before
  merge**. No `workspace:*` resolution, no bare-subtree pnpm workspace.
- **Updates are gateway-as-gate, never a binary redirect (F3).** The app asks the
  gateway whether to update (`go`/`hold` + `latestVersion` + `repo`); on `go` it
  uses electron-updater's **native GitHub provider** to fetch `latest.yml` + the
  `.exe` **directly from the GitHub Release**, then **verifies a minisign/Ed25519
  signature over `latest.yml`** before installing. The gateway is the update
  **decision** authority + kill-switch + staged-rollout point; it **never hosts,
  proxies, or 302-redirects binaries**.
- **The `.exe` is unsigned** for MVP (one-time Windows SmartScreen warning — see
  §3.4); integrity comes from the **signed `latest.yml` manifest** (F1), not from
  an Authenticode-signed binary.
- **Mirror topology** differs per repo (see §2): the desktop repo is
  GitHub-primary (electron-updater's GitHub provider reads GitHub Releases), the
  gateway leans Gitea-primary (it deploys on house infra like Razzoozle).

---

## 1. Local layout (`/nvmetank1/projects`)

```
/nvmetank1/projects/
├── Razzoozle/                 # EXISTING monorepo (unchanged by this work)
│   ├── packages/common/
│   ├── packages/web/          # @razzoozle/web   — the quiz web app
│   ├── packages/socket/       # @razzoozle/socket — the realtime game server
│   └── …                      # (mcp excluded from this feature)
│   # CI ADDS: publishes versioned prebuilt artifacts of web+socket (F2)
│
├── razzoozle-desktop/         # NEW — Windows Electron client (this repo)
│   ├── docs/
│   │   └── repo-strategy.md   # ← this file
│   ├── package.json           # pins @razzoozle/web + @razzoozle/socket VERSIONS
│   ├── electron/              # main process, updater wiring, host server
│   ├── build/                 # electron-builder config, NSIS assets
│   ├── renovate.json          # opens bump-PRs when a new artifact publishes
│   └── .github/workflows/     # release.yml (no submodule-autobump anymore)
│
└── razzloo-gateway/           # NEW — public rendezvous service (gw.razzoozle.xyz)
    ├── src/                   # session register / join / update-gate / kill-switch
    ├── docs/
    └── deploy/                # Caddyfile snippet, systemd unit
```

**Why two top-level projects, not packages in the monorepo (D1):** the desktop
client ships an OS-specific binary on its own GitHub Release cadence, and the
gateway is an independently deployed public service with its own threat surface.
Folding either into the Razzoozle pnpm workspace would couple release cadence,
CI matrix, and (for the gateway) the public attack surface to the core product.
They are consumers of Razzoozle, not parts of it.

### Repo purposes

| Repo | Purpose | Ships |
| --- | --- | --- |
| `Razzoozle` (existing) | Source of truth for `@razzoozle/{common,web,socket}`. **CI additionally publishes versioned prebuilt artifacts** of web+socket that the desktop client pins (F2). | The hosted product **+ versioned web/socket build artifacts** |
| `razzoozle-desktop` | Packages the **same** web app + game server into an Electron app so a host can run a game on their own Windows machine; players join over LAN/public via candidate endpoints discovered through the gateway. | `razzoozle-setup-x.y.z.exe` (**unsigned**), `latest.yml` (**signed, minisign**), `.exe.blockmap` (GitHub Release) |
| `razzloo-gateway` | Stateless-ish **rendezvous + update-decision** service. Stores session metadata + host candidate endpoints, mints host tokens, serves join/redirect, and is the **update-gate** (`go`/`hold`) + kill-switch + staged-rollout point. **Stores no game state, hosts no binary, proxies/redirects no binary, probes nothing.** | A systemd service behind Caddy at `gw.razzoozle.xyz` |

---

## 2. Mirror topology (GitHub ⇄ Gitea per repo)

House stack is self-hosted Caddy + Gitea + systemd. No AWS / Cloudflare / Vault.
Razzoozle itself is dual-homed (GitHub `joehomeskillet/Razzoozle` + Gitea
`agent-claude/Razzoozle`); we follow the same dual-home convention but flip
which side is **primary** per repo based on what each repo's runtime needs.

### 2.1 `razzoozle-desktop` — GitHub-primary, Gitea backup (D5)

```
        ┌──────────────────────────────────────────┐
        │  GitHub (PRIMARY)                          │
        │  github.com/joehomeskillet/razzoozle-desktop│
        │  • Actions: native windows-latest build   │
        │  • Releases: latest.yml + .exe + blockmap  │  ← electron-updater
        └───────────────┬────────────────────────────┘  ←   NATIVE github provider
                        │  pull-mirror (Gitea pulls)       (gateway only decides go/hold)
                        ▼
        ┌──────────────────────────────────────────┐
        │  Gitea (BACKUP MIRROR)                     │
        │  git.joelduss.xyz/agent-claude/razzoozle-desktop │
        │  • read-only copy, disaster recovery       │
        └──────────────────────────────────────────┘
```

**Why GitHub-primary here (not a free choice):** electron-builder builds the
NSIS installer natively on the GitHub-hosted `windows-latest` runner (D3), and
electron-updater's **native GitHub provider** resolves `latest.yml` + binaries
from **GitHub Release assets** directly (F3 — the gateway only decides
`go`/`hold`, it never hosts or redirects to the binary). Releases must therefore
originate on GitHub. Gitea is a **pull-mirror** backup so a GitHub
outage/account loss never loses history.

**Gitea pull-mirror config (recommended):** create the repo on Gitea as a
*pull mirror* pointing at the GitHub clone URL. Via the Gitea UI:
*New Migration → GitHub → check "This repository will be a mirror"*, then set the
sync interval. Equivalent API call:

```bash
# Run on the Gitea host (or with a token that can create repos for agent-claude).
curl -sS -X POST "https://git.joelduss.xyz/api/v1/repos/migrate" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clone_addr": "https://github.com/joehomeskillet/razzoozle-desktop.git",
    "repo_owner": "agent-claude",
    "repo_name":  "razzoozle-desktop",
    "mirror":     true,
    "mirror_interval": "30m",
    "private":    false,
    "service":    "github"
  }'
```

> Pull-mirror = Gitea fetches from GitHub on a timer. No push step is needed
> from CI; the mirror is one-directional GitHub → Gitea. If GitHub later becomes
> unavailable, flip the Gitea repo out of mirror mode to make it writable.

### 2.2 `razzloo-gateway` — primary remote is the **one open choice** → lean Gitea-primary

```
   RECOMMENDED (lean Gitea-primary):

   ┌────────────────────────────────────────────┐
   │  Gitea (PRIMARY)                            │
   │  git.joelduss.xyz/agent-claude/razzloo-gateway │
   │  • deploys to house infra (Caddy+systemd)   │  → gw.razzoozle.xyz
   │  • same home as Razzoozle's Gitea           │
   └───────────────┬─────────────────────────────┘
                   │  push-mirror (Gitea pushes)
                   ▼
   ┌────────────────────────────────────────────┐
   │  GitHub (MIRROR)                            │
   │  github.com/joehomeskillet/razzloo-gateway  │
   │  • visibility / backup, optional CI         │
   └────────────────────────────────────────────┘
```

**This is the single deliberately-open decision in this doc — flagged.** The
recommendation is **Gitea-primary** because, unlike the desktop client, the
gateway has **no dependency on GitHub Releases or electron-updater**: it deploys
straight onto house infra (Caddy + systemd) exactly like Razzoozle's own
services, and keeping its source on the same Gitea instance as Razzoozle
(`git.joelduss.xyz/agent-claude/*`) keeps deploy keys, CI runners, and the
operator's mental model in one place. A **GitHub push-mirror** is added for
visibility and offsite backup.

**Trade-off (brief):** Gitea-primary keeps the gateway aligned with house
deploy tooling and avoids a second control plane, at the cost of GitHub Actions
not being the primary CI for this repo (Gitea Actions or a systemd deploy hook
runs instead). The alternative — GitHub-primary for consistency with the desktop
repo — buys uniform CI across both new repos but pulls the gateway's source of
truth off the box it actually runs on. Given the gateway is house-infra-native,
the alignment win outweighs CI uniformity. **Decision owner should confirm
before bootstrap.**

> Gitea→GitHub here is a **push-mirror** (the inverse of the desktop repo): set
> it under *Settings → Mirror Settings → Push Mirror* on the Gitea repo, target
> the GitHub clone URL with a PAT.

---

## 3. Reuse of `@razzoozle/web` + `@razzoozle/socket` (D2, F2)

**Hard rule:** no duplicate web app, no duplicate game server, no fork, no copy,
**no git submodule**. The desktop client must run the *same* `@razzoozle/web`
and `@razzoozle/socket` the hosted product runs. The chosen mechanism is a
**pinned, prebuilt, versioned artifact** published by Razzoozle CI (F2).

### 3.1 Mechanism

1. **Razzoozle CI publishes** versioned build artifacts of `@razzoozle/web` and
   `@razzoozle/socket` (and `common` as their dependency) on each release — e.g.
   `pnpm pack` tarballs published to **GitHub Packages**, or attached as a
   **GitHub Release artifact**. Each artifact carries a semver version.
2. `razzoozle-desktop`'s `package.json` **depends on a pinned version** of those
   artifacts (an exact version, not a range, not `workspace:*`, not a gitlink).
   `pnpm install` in the desktop repo resolves them like any other registry
   dependency.
3. At build time the desktop build embeds the **already-built** web bundle +
   socket server output into the Electron app (web served locally, socket server
   spawned by the Electron main process as the LAN host). The desktop build does
   **not** compile Razzoozle from source — it consumes the prebuilt artifact.
4. The `mcp` package is excluded (per D6); only `common`, `web`, `socket`
   participate.

Because the desktop repo depends on a published, versioned artifact (not a copy
and not a submodule), there is exactly **one** source of truth for the web app
and the game server — the Razzoozle repo and its CI. The desktop repo records a
**version pin**, not the code.

```
razzoozle-desktop/package.json
   ├─ "@razzoozle/web":    "X.Y.Z"   ── pinned ──▶ Razzoozle CI artifact @ X.Y.Z
   ├─ "@razzoozle/socket": "X.Y.Z"   ── pinned ──▶ Razzoozle CI artifact @ X.Y.Z
   └─ "@razzoozle/common": "X.Y.Z"   (transitive dep of the above)
```

### 3.2 Which Razzoozle version ships, and how versioning is observable

- **The version that ships is the pin recorded in `package.json` / the lockfile
  on the desktop release commit** — i.e. whatever `@razzoozle/web@X.Y.Z` and
  `@razzoozle/socket@X.Y.Z` resolve to on the tagged release commit. That is the
  single authoritative answer to "which Razzoozle is inside this installer."
- **Observability:** the release build stamps the resolved core version into the
  app's build metadata so it is visible three ways:
  1. in the desktop repo: the pin in `package.json` + `pnpm-lock.yaml` on the
     release tag,
  2. in the GitHub Release notes (CI stamps `razzoozle@X.Y.Z` into the release
     body),
  3. at runtime: an "About" line `desktop vX.Y.Z · core vX.Y.Z` so a host and
     support can read exactly which core build they are running.

This keeps the desktop version (its own semver) and the embedded core version (a
Razzoozle artifact semver) **independently observable** while being
deterministically linked by the release commit's lockfile.

### 3.3 Dev-time freshness via Renovate/Dependabot (keeps dev current per D2, F2)

During development the embedded reference must not rot. Instead of a custom
auto-bump job, dependency bots do it the standard way:

- **Renovate** (or Dependabot) watches the `@razzoozle/*` dependencies in
  `razzoozle-desktop`.
- When Razzoozle CI **publishes a newer version** of the web/socket artifact, the
  bot **opens a PR** bumping the pinned version.
- The PR **builds and is tested before merge** (the desktop build runs against
  the new core; a human/CI gate reviews it). Pinned releases stay reproducible;
  development tracks new artifacts through reviewed bump-PRs.

```jsonc
// renovate.json (sketch) — only watch the Razzoozle artifacts, grouped, tested
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "packageRules": [
    {
      "matchPackageNames": ["@razzoozle/web", "@razzoozle/socket", "@razzoozle/common"],
      "groupName": "razzoozle core",
      "commitMessageTopic": "razzoozle core",
      "rangeStrategy": "pin"
    }
  ]
}
```

> Releases pin an exact version (reproducible installers); **development tracks
> new artifacts** through reviewed Renovate/Dependabot PRs. Pinning and freshness
> are both satisfied without ever copying code or carrying a submodule.

### 3.4 Reuse mechanism comparison & recommendation

| Criterion | **Prebuilt artifact** (chosen) | Git submodule (**rejected**) | Monorepo `packages/desktop` (alternative) |
| --- | --- | --- | --- |
| Separate repo (D1 requirement) | ✅ Yes — desktop is its own repo | ✅ Yes — its own repo | ❌ No — would live inside Razzoozle |
| Reuses web+socket, no fork/copy | ✅ Pinned published artifact, one source of truth | ✅ Gitlink to one source of truth | ✅ Direct workspace deps |
| pnpm resolution actually works | ✅ Resolves like any registry dep | ❌ **`workspace:*` will NOT resolve in a bare submodule subtree** | ✅ Inside the workspace |
| Pin a reproducible core version | ✅ Exact semver in lockfile | ⚠️ Gitlink SHA, but build is fragile | ⚠️ Whatever the monorepo commit is |
| Dev-time freshness | ✅ Renovate/Dependabot bump-PR, tested before merge | ❌ **Auto-bump-to-HEAD breaks the installer build** (untested floating core) | ✅ Inherent (same tree) |
| Independent release cadence | ✅ Own tags/Releases, own CI matrix | ✅ Own tags/Releases | ❌ Tied to monorepo release flow |
| Windows installer CI isolation | ✅ Own `windows-latest` workflow | ✅ Own workflow | ⚠️ Adds OS-specific build to core CI |
| Build complexity | ✅ Consumes prebuilt output, no source build | ❌ Must `pnpm install` + build Razzoozle from source at package time | ✅ Single tree |
| Onboarding friction | ✅ Single clone, normal `pnpm install` | ⚠️ `--recurse-submodules` needed | ✅ Single clone |
| Public/attack-surface coupling | ✅ Decoupled from core | ✅ Decoupled | ❌ Couples client release to core |

**Recommendation: pinned prebuilt artifact (F2).** The submodule path is
**rejected** for two concrete reasons: (1) a Razzoozle package using `workspace:*`
protocol **will not resolve** when checked out as a bare submodule subtree — pnpm
has no workspace root to resolve against, so the desktop build cannot install it;
and (2) the dev-time **auto-bump-to-HEAD** of a submodule points the build at an
untested floating core commit, which **breaks the installer build** non-
deterministically. The prebuilt-artifact path avoids both: the desktop repo
depends on a **published, versioned** artifact that resolves like any registry
dependency, pins an **exact semver** for reproducible installers, and gets
freshness through **Renovate/Dependabot PRs that are tested before merge**. The
monorepo `packages/desktop` alternative is off the table by D1 (separate repo).
**Two separate repos are retained** throughout — `razzoozle-desktop`
(GitHub-primary + Gitea mirror) and `razzloo-gateway`.

> **Note on the unsigned `.exe`:** the installer is **not** Authenticode-signed
> for MVP, so the first run triggers a **one-time Windows SmartScreen warning**
> ("Windows protected your PC" → *More info → Run anyway*). This is expected and
> documented, not a defect. Update integrity is provided by the **signed
> `latest.yml` manifest** (minisign/Ed25519, verified client-side before any
> update is applied — F1), not by a signed binary.

---

## 4. Non-negotiables this strategy upholds

These repo decisions exist to make the security model enforceable. Restated so
the boundary is unambiguous:

- **No duplicate web app / no duplicate game server.** The desktop client embeds
  the **prebuilt** `@razzoozle/web` + `@razzoozle/socket` artifact. There is
  exactly one source of truth for each codebase (Razzoozle + its CI); the desktop
  repo holds a **version pin**.
- **No fork, no copy, no submodule.** The reuse path is a pinned published
  artifact, not a vendored snapshot and not a gitlink.
- **The gateway stores no game state.** `razzloo-gateway` holds only session
  metadata + host **candidate** endpoints and mints host tokens. It never carries
  quiz/questions/answers/players/leaderboard/results/scores/gameState or WS
  payloads. Its register schema is a **strict allowlist**
  (`additionalProperties:false` / zod `.strict()` — F5): it accepts only
  `{hostId, protocolVersion, appVersion, candidates[...]}` plus server-issued
  `{sessionId, joinCode, hostToken, timestamps}` and **rejects any other field
  with 400** — an allowlist, not a denylist of gameplay field names.
- **The gateway hosts no binary and never redirects to one (F3).** Installer +
  `latest.yml` + blockmap live on GitHub Releases; the app fetches them via
  electron-updater's **native GitHub provider**. The gateway is the **update
  decision** authority (`go`/`hold`) + kill-switch + staged-rollout point only.
  There are **no** `/api/v1/update/:channel/:asset` or `latest.yml` redirect
  endpoints — that `:asset` path-traversal surface is removed entirely.
- **The gateway probes nothing (no SSRF).** It never fetches/HEADs/pings/health-
  checks any candidate URL or host IP. `candidate.url` is **validated at write
  time** (scheme `http`/`https` only; `host:port` only; reject
  `javascript:`/`file:`/`data:`; LAN candidates must be RFC1918/link-local;
  `public-*` candidates must not be private/loopback/reserved — F6) on
  `POST`/`PATCH`. Reachability is tested **client-side** by the player's browser
  only. (Endpoints, candidate model, token-gated host mutations, join flow, and
  TTL expiry live in the gateway's own spec docs, not here.)

---

## 5. Bootstrap checklist

Order matters: Razzoozle publishes the artifact first, then GitHub (where the
desktop releases live), then mirrors, then pin + scaffold, then CI.

### 5.0 `Razzoozle` (existing repo — one additive CI change)

- [ ] **Add a CI step that publishes versioned prebuilt artifacts** of
      `@razzoozle/web` + `@razzoozle/socket` (and `common`) on release — e.g.
      `pnpm pack` tarballs to **GitHub Packages**, or attach them as **GitHub
      Release artifacts**. Each carries a semver. (This is the only change to the
      existing monorepo for this feature.)

### 5.1 `razzoozle-desktop`

- [ ] **Create local project dir** `/nvmetank1/projects/razzoozle-desktop`.
- [ ] **Create the GitHub repo** `github.com/joehomeskillet/razzoozle-desktop`
      (PRIMARY). `git init`, set `origin` to GitHub, push `main`.
- [ ] **Configure the Gitea backup pull-mirror**
      `git.joelduss.xyz/agent-claude/razzoozle-desktop` via the migrate API in
      §2.1 (`"mirror": true`, interval `30m`).
- [ ] **Pin the core artifact** in `package.json`: depend on a known-good
      **version** of `@razzoozle/web` + `@razzoozle/socket` (exact semver, not a
      range, not `workspace:*`). `pnpm install` resolves them; commit the
      lockfile. **No submodule, no `--recurse-submodules`.**
- [ ] **Configure Renovate (or Dependabot)** (`renovate.json`) to watch
      `@razzoozle/*` and open a **tested-before-merge** bump-PR when a new version
      publishes (§3.3).
- [ ] **Scaffold Electron**: main process, `pnpm@11.5.1`, a build step that
      **embeds the prebuilt** `@razzoozle/web` + `@razzoozle/socket` output into
      the Electron app (no source build of Razzoozle); electron-builder config for
      NSIS; electron-updater wired to the **native GitHub provider**, gated by the
      gateway's `go`/`hold` update decision (F3); **minisign/Ed25519 verification
      of `latest.yml` before any update is applied** (F1).
- [ ] **Wire CI** (`.github/workflows/`):
  - `release.yml` — native `windows-latest`, `electron-builder` build, **unsigned**
    NSIS for MVP (one-time SmartScreen warning, §3.4), publish `latest.yml`
    (**signed with minisign**) + `.exe` + `.exe.blockmap` as GitHub Release
    assets; stamp `razzoozle@X.Y.Z` into the release body.
  - *(No `submodule-autobump.yml` — Renovate/Dependabot replaces it.)*
- [ ] **Verify observability**: the `@razzoozle/*` pin in `package.json` /
      `pnpm-lock.yaml` on the release tag and the "About" line both show the
      shipped core version (§3.2).

### 5.2 `razzloo-gateway`

- [ ] **Confirm the open choice** (§2.2): default **Gitea-primary**
      `git.joelduss.xyz/agent-claude/razzloo-gateway`. Get decision-owner sign-off.
- [ ] **Create local project dir** `/nvmetank1/projects/razzloo-gateway`.
- [ ] **Create the Gitea repo** (PRIMARY); add a **GitHub push-mirror**
      `github.com/joehomeskillet/razzloo-gateway` for visibility/backup.
- [ ] **Deploy plumbing**: Caddy site for `gw.razzoozle.xyz`, systemd unit; no
      AWS/Cloudflare/Vault/CAPTCHA. (The update-gate `go`/`hold` logic, the strict
      register allowlist, `candidate.url` write-time validation, host-token + TTL,
      the join flow, and the no-probe/no-binary-redirect stance are specified in
      the gateway's own docs.)

---

## 6. Open decisions (flagged for sign-off)

| # | Decision | Recommendation | Status |
| --- | --- | --- | --- |
| O1 | `razzloo-gateway` primary remote | **Gitea-primary** + GitHub mirror (§2.2) | **Open — needs decision-owner confirm** |

All other items in this doc follow directly from the locked decisions (D1, D3,
D5, D6) and the **FINAL** contract (F1 signing, F2 prebuilt-artifact reuse, F3
gateway-as-gate, F4 join flow, F5 strict allowlist, F6 candidate validation, F7
host-token/join-code rules) and are not open.
