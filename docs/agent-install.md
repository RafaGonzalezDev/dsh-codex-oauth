# Agent installation and configuration

Runbook for installing and configuring **`dsh-chatgpt-plan`** (this repository, `dsh-codex-oauth`)
into a DeepSeek Harness profile from a terminal or desktop agent such as Claude Code, Codex or the
Harness's own agent.

The procedure is written so an agent can execute it end to end. Three steps are human by design and
are marked **[human]**: closing the Desktop application, triggering **restartHost**, and the browser
sign-in. Do not attempt to automate or work around them.

Companion documents: [README.md](../README.md) for what the plugin is,
[packages/plugin/README.md](../packages/plugin/README.md) for connection behavior and
[packages/plugin/docs/troubleshooting.md](../packages/plugin/docs/troubleshooting.md) for
symptom-to-action diagnostics.

## 1. Scope and agent roles

| Agent | Can do | Must not do |
| --- | --- | --- |
| Terminal agent (Claude Code, Codex CLI, `dsh headless`) | Everything except the marked human steps. | Start a replacement Web server, patch the application, edit the profile by hand. |
| Desktop agent (running inside the DeepSeek Harness Desktop host) | Clone/pull, `npm ci`, `npm run check`, `npm run pack:plugin`, compute the digest, hand off the install command. | Quit or restart its own host, so it cannot run the profile install itself. Delegate steps 4-6 to a terminal or the user. |

Installing a plugin writes into the target Harness profile. Source edits and `npm run pack:plugin`
alone never change an installed profile.

## 2. Prerequisites

- Node.js 24. The repository pins it in [.nvmrc](../.nvmrc): run `nvm use` (Windows: `nvm use 24`).
- npm, to restore and build the workspace.
- A DeepSeek Harness installation on the target machine. The Windows Desktop build is the only
  platform with recorded validation for this package.
- For the `desktop` profile, the CLI bundled with the installed application. The `desktop` profile
  is reserved for the Electron application; a generic `dsh` refuses it.
- The **Harness home** is `~/.dsh` (`%USERPROFILE%\.dsh` on Windows) unless the `DSH_HOME`
  environment variable overrides it. Everything below refers to it as `<DSH_HOME>`.

## 3. Build, test and pack

Run from the repository root:

```sh
nvm use
npm ci
npm run check          # builds Host, generated RPC and Client, then runs the suite
npm run pack:plugin    # emits dsh-chatgpt-plan-<version>.tgz in the repository root
```

`npm run check` must pass before packing. The OAuth callback tests bind localhost and need a
terminal that permits local listeners; they use fictional credentials and never touch a real account.

Derive the artifact path from the manifest instead of hardcoding a version:

**Windows (PowerShell)**

```powershell
$version = (Get-Content .\packages\plugin\package.json -Raw | ConvertFrom-Json).version
$tarball = Join-Path (Get-Location) "dsh-chatgpt-plan-$version.tgz"
$digest  = (Get-FileHash -Algorithm SHA256 $tarball).Hash
"$tarball`n$digest"
```

**macOS**

```sh
version=$(node -p "require('./packages/plugin/package.json').version")
tarball="$PWD/dsh-chatgpt-plan-$version.tgz"
shasum -a 256 "$tarball"
```

Record the absolute path and the digest. Keep the previously installed tarball: it is the rollback
artifact. If you change the sources, bump the version in `packages/plugin/package.json` before
packing; a same-version tarball at the same path can be served from the package manager's cache.

## 4. Install into the target profile

The Desktop profile must have been initialized by opening the application once, and the application
must be **fully quit** before the command runs: the profile is written under a file lock, and the
launcher's own message requires the application to be closed.

**[human]** Quit DeepSeek Harness Desktop completely.

**Windows Desktop** — use the bundled CLI, not a checkout launcher:

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add "$tarball"
```

**macOS Desktop**

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add "$tarball"
```

The command forwards its remaining arguments to the profile's package manager. On success it adds
the `file:` dependency to `<DSH_HOME>/profiles/desktop/package.json` and appends
`dsh-chatgpt-plan` to `dsh.profile.bundles`, because the package declares `dsh.bundle`.

## 5. Reactivate the host

**[human]** Run the application's **restartHost** action, then reload the existing UI at
`http://127.0.0.1:19387`.

A browser refresh alone does not activate a new Host build, and the generated Remote registry is
discovered at startup. Never start a replacement server to "apply" the change.

## 6. Verify the installation

**Windows (PowerShell)**

```powershell
$profile = Join-Path $env:USERPROFILE '.dsh\profiles\desktop\package.json'
Get-Content $profile
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop why dsh-chatgpt-plan
```

**macOS**

```sh
cat ~/.dsh/profiles/desktop/package.json
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop why dsh-chatgpt-plan
```

Expected state:

- `dependencies["dsh-chatgpt-plan"]` is `file:<absolute path to the installed tarball>`.
- `dsh.profile.bundles` contains `dsh-chatgpt-plan`.
- `why` resolves the package from the profile tree.
- `plugin --profile desktop version-exemptions` prints the profile's exemptions (empty is normal).

Then confirm in the UI: **Settings → Models → ChatGPT Plan** exists and the sidebar shows the
sign-in invitation while the profile is disconnected. A file present in the profile is not proof the
plugin loaded; only the restarted Host shows that.

## 7. Configure the connection

1. **[human]** Open **Settings → Models → ChatGPT Plan** and choose **Continue with ChatGPT**.
2. **[human]** Complete the browser sign-in and authorize ChatGPT plan usage. The browser and the
   Harness host must be on the same machine: the OAuth callback listens on `127.0.0.1`. The first
   connection shows a one-time confirmation that eligible requests use the plan.
3. Select a model under the native **ChatGPT Plan** provider in the conversation model selector.
4. Use **Update models now** to refresh metadata without an inference request, and **View usage** in
   the sidebar to open ChatGPT's usage settings.

Operational notes:

- Catalog metadata is cached per profile at `<DSH_HOME>/profiles/<profile>/.cache/dsh-chatgpt-plan/pi-catalog-v1.json`,
  independently of the OAuth grant.
- OAuth tokens live only in the native managed credential store (normally
  `<DSH_HOME>/.credentials.yaml`). Never read, copy or commit them.
- **Disconnect** revokes the remote grant and erases local tokens. To switch accounts, disconnect and
  choose **Change account**.
- An agent must not attempt the browser sign-in or accept the plan-usage consent on a user's behalf.

## 8. Rollback

Reinstall the retained previous tarball through the same bundled CLI and profile, then repeat the
**restartHost** and UI reload:

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add "C:\path\to\previous\dsh-chatgpt-plan-<previous-version>.tgz"
```

To remove the plugin entirely, run `plugin --profile desktop remove dsh-chatgpt-plan` and restart the
host; the manager drops the now-unused `dsh.profile.bundles` entry on its own.

Do not roll back by deleting the native credential store, patching core packages or copying
dependencies between profiles. The Pi catalog cache and the OAuth grant are independent.

## 9. Secondary path: Web and custom profiles

This path is **not validated** for the current release. It uses a generic `dsh` launcher, which
requires `pnpm` on `PATH`; without it the command exits with `127` and reports that pnpm was not
found. A non-desktop profile is initialized from its template on first use.

```sh
dsh plugin --profile web add /absolute/path/dsh-chatgpt-plan-<version>.tgz
```

For a new, separate custom profile, initialize it from the shipped Web template first:

```sh
dsh --profile my-web --from-default-profile web --dump-config
dsh plugin --profile my-web add /absolute/path/dsh-chatgpt-plan-<version>.tgz
dsh --profile my-web --no-open --port 41873
```

`--from-default-profile` initializes a new profile; it does not repair an existing profile's bundle
list. A remotely hosted Web deployment is outside the supported scope because the OAuth callback is
a loopback listener.

## 10. Failure modes

| Symptom | Cause | Action |
| --- | --- | --- |
| `installation rejected: ...` and exit code 1 | The package's declared DSH range is incompatible with the running Harness and is not exempted. The manager restores `package.json` and `pnpm-lock.yaml`, reinstalls the previous tree, and reports separately if `node_modules` could not be reinstalled. | Install was rolled back on purpose. Either install a build whose range matches the running Harness, or approve the exact pair with `plugin --profile <p> allow-version dsh-chatgpt-plan@<version> --dsh-version <exact> --accept-risk`. Never widen the declared range just to bypass the check. |
| `dsh: pnpm was not found` and exit code 127 | Generic CLI used outside the Desktop bundle, with no `pnpm` on `PATH`. | Use the bundled CLI for the `desktop` profile, or install pnpm for the secondary path. |
| `dsh: Open DeepSeek Harness Desktop once to initialize its profile, then fully quit it` | The `desktop` profile does not exist yet, or the application is running. | **[human]** Open the application once, quit it completely, retry. |
| `dsh: warning: <name> declares no dsh.bundle` | The package was installed as a plain dependency and is not a profile layer. | Expected only for unrelated packages. `dsh-chatgpt-plan` does declare `dsh.bundle`; a build that lost it is broken. |
| The installed version does not change | Same version and path as a previously installed tarball, served from the package manager cache. | Bump the version, repack and reinstall. Keep artifacts digest-addressed. |
| UI unchanged after install | The Host was not restarted, or the browser was only refreshed. | **[human]** Run **restartHost** and reload the UI. |
| `subscription_sharing_usage_limit_exceeded` (429) while ChatGPT reports remaining capacity | OpenAI's app-specific limit for the *Sign in with ChatGPT* route, external and open. | Not fixable from the plugin. See [troubleshooting](../packages/plugin/docs/troubleshooting.md). Do not switch billing paths or substitute models. |

## 11. Boundaries

- Do not edit `<DSH_HOME>/profiles/*/package.json`, `pnpm-lock.yaml` or `node_modules` by hand; the
  plugin manager owns them.
- Do not patch the application ASAR/core, a Pi or WSL installation, or any installed package.
- Do not commit tarballs, credentials, deployment receipts or machine-specific paths. Deployment
  evidence belongs in a `*.local.md` file, which is git-ignored.
- Report only what was verified: a successful build and a loaded plugin are separate from a live
  authenticated request.

## Related

The sibling plugin `dsh-model-usage` reports the provider token usage this plugin generates, and is
installed the same way. Both can coexist in one profile.
