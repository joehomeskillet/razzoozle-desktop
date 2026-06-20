# CI/CD & Update Channel — Razzoozle Desktop

> Phase-0 design doc. Defines the **build → release → update** pipeline for the
> Windows Electron client `razzoozle-desktop`: how the reused web+socket code is
> consumed, how the installer is built and released, how the app discovers and
> verifies updates, and how the backup mirror works.
>
> **Authoritative FINAL decisions** are encoded here (F1–F3 below). Where this
> doc disagrees with the earlier `repo-strategy.md` draft (git submodule,
> Linux+wine build, gateway 302-redirect of binaries), **this doc wins** — those
> were superseded. See §0.1.

## 0. TL;DR

- **Two repos, no submodule.** `razzoozle-desktop` reuses `@razzoozle/web` +
  `@razzoozle/socket` as a **pinned prebuilt artifact** (a versioned tarball /
  package published by Razzoozle CI), not a git submodule and not a
  `workspace:`/subtree (**F2**). A Renovate PR bumps the pin when a new version
  publishes.
- **Build on `windows-latest`, native.** `electron-builder` builds the NSIS
  installer on a GitHub-hosted `windows-latest` runner. This **replaces** the
  earlier Linux+wine choice (§0.1, note f).
- **The `.exe` is UNSIGNED; `latest.yml` is signed.** No code-signing cert in
  MVP. Instead the electron-updater manifest `latest.yml` is signed with
  **minisign (Ed25519)**, and the app **verifies that signature client-side
  before applying any update** (**F1**). The unsigned `.exe` triggers a one-time
  Windows **SmartScreen** warning on first run — documented, not hidden.
- **Update = gateway-as-gate, never a binary redirect.** The app asks the
  gateway update-gate `GET /api/v1/update/:channel?appVersion=X` for a
  go/hold **decision**; on `go` it uses electron-updater's **native GitHub
  provider** to fetch `latest.yml` + `.exe` **directly from the GitHub Release**,
  then verifies the minisign signature before install (**F3**). The gateway
  **never hosts, proxies, or 302-redirects binaries**.
- **Gitea = pull-mirror backup** of the GitHub repo. No extra CI on the Gitea
  side.

### 0.1 What changed vs. `repo-strategy.md` (superseded items)

| Earlier draft said | FINAL decision (this doc) |
| --- | --- |
| Reuse via **git submodule** `vendor/razzoozle` pinned to a SHA | **F2** — reuse via **pinned prebuilt artifact** (versioned tarball / package); Renovate bumps it. No submodule, no `workspace:`, no subtree. |
| electron-updater **generic** provider pointed at the gateway; gateway **302-redirects** to GitHub assets | **F3** — electron-updater **native `github`** provider fetches assets **directly**; gateway only returns a **go/hold decision**. No redirect, no `:asset` endpoints. |
| (implied) signing TBD | **F1** — `.exe` **unsigned** (SmartScreen warning documented); `latest.yml` **minisign-signed**, verified client-side before apply. |
| Build could run Linux + **wine** | **windows-latest native** build (note f). |

---

## 1. Pipeline overview

```
┌────────────────────────────────────────────────────────────────────────┐
│ (a) UPSTREAM: Razzoozle CI (github.com/joehomeskillet/Razzoozle)         │
│     on release → builds @razzoozle/web + @razzoozle/socket               │
│     → publishes VERSIONED artifacts (pnpm pack tarballs / Release asset) │
└───────────────┬──────────────────────────────────────────────────────────┘
                │  new version published
                ▼
┌────────────────────────────────────────────────────────────────────────┐
│ (c) Renovate (in razzoozle-desktop): opens a PR bumping the pinned       │
│     @razzoozle/web + @razzoozle/socket version. Tested → merged.         │
└───────────────┬──────────────────────────────────────────────────────────┘
                │  version tag pushed (vX.Y.Z)
                ▼
┌────────────────────────────────────────────────────────────────────────┐
│ (b) razzoozle-desktop CI (windows-latest), on tag:                      │
│     pnpm install (resolves the PINNED web+socket artifact)              │
│     → electron-builder NSIS build, UNSIGNED                             │
│     → minisign-sign latest.yml  (F1)                                    │
│     → publish .exe + latest.yml + latest.yml.minisig + .blockmap        │
│       as GitHub Release assets                                          │
└───────────────┬──────────────────────────────────────────────────────────┘
                │  GitHub Release published
        ┌───────┴────────────────────────────┐
        ▼                                     ▼
┌────────────────────┐          ┌────────────────────────────────────────┐
│ (e) Gitea pull-     │          │ (d) RUNTIME update on each client:      │
│     mirror backup   │          │   1. ask gateway update-gate (decision) │
│     of the GitHub   │          │   2. on "go": electron-updater NATIVE    │
│     repo. No CI.    │          │      github provider fetches directly    │
└────────────────────┘          │   3. VERIFY minisign(latest.yml) before  │
                                 │      applying  (F1 + F3)                 │
                                 └────────────────────────────────────────┘
```

---

## 2. (a) Upstream: Razzoozle publishes versioned web+socket artifacts (F2)

The desktop client must run the **same** `@razzoozle/web` and `@razzoozle/socket`
the hosted product runs — but it consumes them as a **published, versioned,
prebuilt artifact**, never as source pulled into the desktop tree.

Razzoozle CI gains a job that, **on release**, packs and publishes each package:

```yaml
# In the Razzoozle repo: .github/workflows/publish-artifacts.yml  (sketch)
name: publish web+socket artifacts
on:
  release:
    types: [published]          # fires when Razzoozle cuts a release
jobs:
  pack:
    runs-on: ubuntu-latest
    permissions:
      contents: write           # to attach Release assets
      packages: write           # if publishing to GitHub Packages instead
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 11.5.1 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, registry-url: https://npm.pkg.github.com }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @razzoozle/web build && pnpm --filter @razzoozle/socket build

      # OPTION 1 — tarball artifacts attached to the Razzoozle Release:
      - run: pnpm --filter @razzoozle/web pack   --pack-destination ./out
      - run: pnpm --filter @razzoozle/socket pack --pack-destination ./out
      - name: Attach tarballs to the Razzoozle Release
        run: gh release upload "${{ github.event.release.tag_name }}" ./out/*.tgz
        env: { GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }

      # OPTION 2 (alternative) — publish to GitHub Packages so it resolves by version:
      # - run: pnpm --filter @razzoozle/web publish --no-git-checks
      # - run: pnpm --filter @razzoozle/socket publish --no-git-checks
      #   env: { NODE_AUTH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
```

Either option yields a **versioned, immutable artifact** keyed to the Razzoozle
release version. The desktop repo depends on a **pinned version** of it. There is
exactly one source of truth (Razzoozle); the desktop repo holds a version pin,
not the code, and **not a gitlink**.

> **Explicitly NOT used:** git submodule, `pnpm` `workspace:` protocol, or a bare
> subtree. Two separate repos are retained; coupling is a version number only.

---

## 3. (c) razzoozle-desktop depends on the pinned artifact + Renovate (F2)

### 3.1 The pin

`razzoozle-desktop/package.json` depends on an **exact** version (no range):

```jsonc
{
  "dependencies": {
    // OPTION 1 — tarball pinned by URL to the Razzoozle Release asset:
    "@razzoozle/web":    "https://github.com/joehomeskillet/Razzoozle/releases/download/v2.4.0/razzoozle-web-2.4.0.tgz",
    "@razzoozle/socket": "https://github.com/joehomeskillet/Razzoozle/releases/download/v2.4.0/razzoozle-socket-2.4.0.tgz"

    // OPTION 2 — GitHub Packages registry, pinned exact version (preferred if Packages used):
    // "@razzoozle/web":    "2.4.0",
    // "@razzoozle/socket": "2.4.0"
  }
}
```

With Option 2, `.npmrc` scopes the registry:

```ini
# .npmrc  (razzoozle-desktop)
@razzoozle:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

`pnpm install` in the build (§4) resolves this pin and downloads the prebuilt
web bundle + socket server output, which electron-builder then embeds. **No build
of the core happens in desktop CI** — it consumes the already-built artifact.

### 3.2 Renovate bumps the pin

A Renovate config opens a PR whenever Razzoozle publishes a newer version. The PR
runs the full desktop build + tests before a human merges it.

```jsonc
// renovate.json  (razzoozle-desktop)
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "packageRules": [
    {
      "description": "Razzoozle core: group web+socket, label, no auto-merge",
      "matchPackageNames": ["@razzoozle/web", "@razzoozle/socket"],
      "groupName": "razzoozle core (web+socket)",
      "labels": ["razzoozle-core"],
      "automerge": false,
      "schedule": ["at any time"]
    }
  ],
  "github-actions": { "enabled": true }
}
```

> For Option 1 (tarball-by-URL) Renovate needs its
> [`regexManagers`](https://docs.renovatebot.com/modules/manager/regex/) to match
> the `.../releases/download/vX.Y.Z/...` URL; Option 2 (semver in a registry) is
> matched natively and is the cleaner path — recommend Option 2 if GitHub
> Packages is acceptable. Dependabot is a drop-in alternative for Option 2.

---

## 4. (b) Build + release on a version tag — `windows-latest`, NSIS, unsigned, minisign-signed manifest (F1)

The release workflow runs on **GitHub-hosted `windows-latest`** (native — this
**replaces** the earlier Linux+wine plan). It installs (resolving the pinned
web+socket artifact), builds the unsigned NSIS installer, signs **only**
`latest.yml` with minisign, and publishes the assets to the GitHub Release.

```yaml
# .github/workflows/release.yml  (razzoozle-desktop)  — sketch
name: release
on:
  push:
    tags: ["v*.*.*"]            # build/release on a version tag
permissions:
  contents: write              # create the GitHub Release + upload assets
jobs:
  release:
    runs-on: windows-latest    # native Windows build — replaces Linux+wine
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with: { version: 11.5.1 }
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://npm.pkg.github.com   # Option 2 pin resolution
      # Resolves the PINNED @razzoozle/web + @razzoozle/socket artifact (F2):
      - run: pnpm install --frozen-lockfile
        env: { NODE_AUTH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }

      # Build the UNSIGNED NSIS installer. We do NOT let electron-builder publish
      # yet, because we must sign latest.yml first, THEN upload everything.
      - name: electron-builder (build only, unsigned)
        run: pnpm exec electron-builder --win nsis --publish never
        env: { GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }

      # Sign ONLY latest.yml with minisign (Ed25519). The .exe stays unsigned (F1).
      - name: minisign-sign latest.yml
        shell: bash
        run: |
          echo "$MINISIGN_SECKEY" > minisign.key
          # -S sign, -s secret key, -m message; produces dist/latest.yml.minisig
          minisign -S -s minisign.key -m dist/latest.yml
          rm -f minisign.key
        env: { MINISIGN_SECKEY: "${{ secrets.MINISIGN_SECRET_KEY }}" }

      # Publish .exe + latest.yml + latest.yml.minisig + .blockmap to the Release.
      - name: create GitHub Release with assets
        shell: bash
        run: |
          gh release create "${GITHUB_REF_NAME}" \
            dist/*.exe \
            dist/*.exe.blockmap \
            dist/latest.yml \
            dist/latest.yml.minisig \
            --title "${GITHUB_REF_NAME}" \
            --notes "razzoozle-desktop ${GITHUB_REF_NAME}"
        env: { GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
```

### 4.1 Key `electron-builder` config keys

`electron-builder.yml` (or the `build` block in `package.json`). The
`publish.provider: github` block is what lets electron-updater later resolve the
Release **natively** (F3) — and what stamps the GitHub provider into the
generated `latest.yml`.

```yaml
# electron-builder.yml  (razzoozle-desktop)
appId: xyz.razzoozle.desktop
productName: Razzoozle
win:
  target: nsis
  # NO certificateFile / certificateSubjectName / signtoolOptions:
  # the .exe is intentionally UNSIGNED for MVP (F1) → SmartScreen warning (§6).
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
# This block makes electron-updater use the NATIVE github provider and is written
# into latest.yml. The gateway is NOT referenced here — it is a decision gate
# only (F3), not a download source.
publish:
  provider: github
  owner: joehomeskillet
  repo: razzoozle-desktop
  releaseType: release
```

The build emits, in `dist/`: `Razzoozle-Setup-X.Y.Z.exe`,
`Razzoozle-Setup-X.Y.Z.exe.blockmap`, and `latest.yml`. CI then adds
`latest.yml.minisig`.

---

## 5. (d) Runtime update: gateway-as-gate, then native fetch, then minisign-verify (F3 + F1)

The update flow has **three** steps, in order. The gateway is the **decision
authority + kill-switch + staged-rollout point** and nothing else — it never
hosts, proxies, or redirects a binary.

### 5.1 Step 1 — ask the gateway update-gate (decision only)

```
GET https://gw.razzoozle.xyz/api/v1/update/:channel?appVersion=X.Y.Z
→ 200 {
    "decision": "go" | "hold",
    "latestVersion": "X.Y.Z",
    "notes": "optional release notes / staged-rollout message",
    "repo": "joehomeskillet/razzoozle-desktop"
  }
```

- `decision: "hold"` → the app does nothing (kill-switch / not-yet-staged-to-you).
- `decision: "go"` → proceed to step 2. The returned `repo` confirms the GitHub
  owner/repo the native provider will read from.
- There are **NO** `/api/v1/update/:channel/:asset` endpoints and **NO**
  `latest.yml` redirect endpoint. The `:asset` path-traversal surface is removed
  entirely (F3).

### 5.2 Step 2 — electron-updater native GitHub provider fetches directly

On `go`, the app drives `electron-updater` configured with the **native
`github`** provider (owner `joehomeskillet`, repo `razzoozle-desktop`). It reads
`latest.yml` + the `.exe` + `.blockmap` **straight from the GitHub Release** — no
gateway in the data path.

### 5.3 Step 3 — verify minisign(latest.yml) BEFORE applying (F1)

electron-updater downloads `latest.yml` to its cache; we hook **between download
and install** to verify the detached minisign signature over `latest.yml`. If
verification fails, the update is aborted and never staged.

```ts
// electron/updater.ts  (sketch — main process)
import { autoUpdater } from "electron-updater";
import { execFileSync } from "node:child_process";
import path from "node:path";
import https from "node:https";
import fs from "node:fs";

// 1) Decision gate (F3). NO binary URL here — only a go/hold answer.
async function gateDecision(channel: string, appVersion: string) {
  const url = `https://gw.razzoozle.xyz/api/v1/update/${channel}?appVersion=${appVersion}`;
  const res = await fetch(url);
  return res.json() as Promise<{ decision: "go" | "hold"; latestVersion: string; repo: string }>;
}

// 2) Native GitHub provider — fetches latest.yml + .exe directly from the Release.
autoUpdater.setFeedURL({
  provider: "github",
  owner: "joehomeskillet",
  repo: "razzoozle-desktop",
});
autoUpdater.autoDownload = false; // we gate + verify first

// 3) Minisign verification hook: BETWEEN download and apply.
//    `update-downloaded` fires after latest.yml + the installer are cached.
//    We verify latest.yml.minisig before allowing quitAndInstall().
autoUpdater.on("update-downloaded", async (info) => {
  const cacheDir = path.dirname((info as any).downloadedFile ?? "");
  const manifest = path.join(cacheDir, "latest.yml");
  const sig      = path.join(cacheDir, "latest.yml.minisig");

  // Pull the detached signature from the same Release (electron-updater doesn't).
  await downloadReleaseAsset("latest.yml.minisig", sig, info.version);

  try {
    // -V verify, -p public key, -m message, -x signature. Throws on bad sig.
    execFileSync("minisign", [
      "-V",
      "-P", MINISIGN_PUBLIC_KEY,     // pinned in the app, NOT fetched at runtime
      "-m", manifest,
      "-x", sig,
    ], { stdio: "pipe" });
  } catch {
    autoUpdater.removeAllListeners("update-downloaded");
    return; // signature invalid → abort, never install
  }
  autoUpdater.quitAndInstall(); // verified → apply
});

export async function checkForUpdate(channel: string, appVersion: string) {
  const d = await gateDecision(channel, appVersion);
  if (d.decision !== "go") return;        // hold / kill-switch
  await autoUpdater.checkForUpdates();     // native github provider
  await autoUpdater.downloadUpdate();      // → fires update-downloaded → verify
}
```

> The **minisign public key is embedded in the shipped app** (pinned), so a
> compromised Release cannot swap in a different key. Verification is over
> `latest.yml`, which carries the SHA-512 of the `.exe`; electron-updater already
> checks that hash before install, so a verified `latest.yml` transitively
> authenticates the installer.

### 5.4 minisign sign/verify reference

```bash
# One-time key generation (operator's machine; keep the secret key offline):
minisign -G -p razzoozle-update.pub -s razzoozle-update.key
#   → razzoozle-update.pub  : embed in the app + commit to the repo
#   → razzoozle-update.key  : store as the MINISIGN_SECRET_KEY CI secret (only)

# CI signs the manifest (produces latest.yml.minisig):
minisign -S -s razzoozle-update.key -m dist/latest.yml

# Client verifies before applying:
minisign -V -P "<pubkey-string>" -m latest.yml -x latest.yml.minisig
#   (or -p razzoozle-update.pub instead of -P "<pubkey-string>")
```

---

## 6. SmartScreen reality (F1 — document, do not hide)

The `.exe` is **unsigned** (no Authenticode certificate in MVP). On first
download/run, Windows **SmartScreen** shows a **one-time** "Windows protected
your PC" / unknown-publisher warning. The host must click **More info →
Run anyway** once.

- This is expected and **must be documented** in the README / first-run docs.
- **Do not claim the binary is signed.** What is signed is the **update
  manifest** (`latest.yml` via minisign), which protects the *update channel*,
  not the SmartScreen publisher reputation.
- SmartScreen reputation accrues per-binary over downloads; it does **not** carry
  across versions. Each new unsigned `.exe` may re-warn until it accrues
  reputation. Buying an Authenticode (ideally EV) cert is the only thing that
  removes the warning — explicitly **out of scope for MVP**.

---

## 7. (e) Gitea backup = pull-mirror, no extra CI

The GitHub repo `joehomeskillet/razzoozle-desktop` is **primary** (releases must
originate where electron-updater reads them — GitHub Releases). Gitea is a
**pull-mirror backup only**: it fetches from GitHub on a timer for disaster
recovery. **No CI runs on the Gitea side**; the mirror never builds or releases.

```bash
# Create the Gitea pull-mirror (run once, on the Gitea host or with a repo-create token):
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

> Pull-mirror = Gitea fetches from GitHub on a timer (one-directional
> GitHub → Gitea). If GitHub is ever lost, flip the Gitea repo out of mirror mode
> to make it writable. No push step from CI, no Gitea Actions for this repo.

---

## 8. Release / version flow (end to end)

```
1. Razzoozle cuts release vN  → publish-artifacts.yml packs & publishes
                                 @razzoozle/web@N + @razzoozle/socket@N  (F2, §2)

2. Renovate (razzoozle-desktop) opens a PR bumping the pin to @N         (§3.2)
   → desktop CI runs the full build + tests on the PR
   → human reviews & merges                                             (tested before merge)

3. Maintainer bumps razzoozle-desktop's own semver, tags vX.Y.Z, pushes the tag

4. release.yml (windows-latest) runs:                                    (§4)
   pnpm install (resolves pinned web+socket @N)
   → electron-builder NSIS, UNSIGNED                                     (F1)
   → minisign -S latest.yml → latest.yml.minisig                        (F1)
   → gh release create vX.Y.Z with:
        Razzoozle-Setup-X.Y.Z.exe
        Razzoozle-Setup-X.Y.Z.exe.blockmap
        latest.yml
        latest.yml.minisig

5. Gitea pull-mirror picks up the new commits/tags within ~30m          (§7, no CI)

6. Operator flips the gateway update-gate for :channel to decision="go"
   (staged rollout / kill-switch lives here)                            (F3, §5.1)

7. Clients on that channel:
   gate says "go" → electron-updater NATIVE github provider fetches      (F3, §5.2)
   latest.yml + .exe directly from the GitHub Release
   → app verifies minisign(latest.yml) BEFORE applying                  (F1, §5.3)
   → quitAndInstall  (first run shows one-time SmartScreen warning)     (§6)
```

### Version independence

- **Desktop semver** (`vX.Y.Z`) and the **embedded core version**
  (`@razzoozle/web`/`socket@N`) are independent but deterministically linked by
  the pinned dependency version recorded in the release commit's lockfile.
- Observability: `pnpm why @razzoozle/web` on the release tag, the pin in
  `package.json`, and an "About" line (`desktop vX.Y.Z · core @N`) all report the
  shipped core version.

---

## 9. Secrets & inventory

| Secret / asset | Where | Used by |
| --- | --- | --- |
| `MINISIGN_SECRET_KEY` | razzoozle-desktop GitHub Actions secret | §4 sign step |
| `razzoozle-update.pub` (minisign public key) | embedded in the app + committed to repo | §5.3 verify |
| `NODE_AUTH_TOKEN` / `GITHUB_TOKEN` | Actions (Option 2 registry pin) | §3, §4 install |
| `GITEA_TOKEN` | Gitea host / operator | §7 mirror create (one-time) |
| (no Authenticode cert) | — | intentionally absent in MVP (F1, §6) |

**Files added by this design:**
`razzoozle-desktop/.github/workflows/release.yml`, `renovate.json`,
`electron-builder.yml`, `electron/updater.ts`, `.npmrc` (Option 2),
`razzoozle-update.pub`; and in the Razzoozle repo,
`.github/workflows/publish-artifacts.yml`.
