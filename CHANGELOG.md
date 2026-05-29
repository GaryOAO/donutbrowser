# Changelog


## v0.23.0 (2026-05-29)

### Features

- password-protected profiles
- add keyboard shortcuts and command palette
- support latest Camoufox via real-fingerprint presets

### Other

- release: v0.23.0 — port Camoufox presets, shortcuts/command palette, password-protected profiles


## v0.23.0 (2026-05-29)

> Fork-specific release (GaryOAO/donutbrowser). Ports three useful upstream
> capabilities into the fork without disturbing existing custom functionality,
> and fixes the auto-updater so it no longer offers (and overwrites with) the
> upstream build.

### Features

- **Latest Camoufox support via real-fingerprint presets.** Ported upstream's preset path: when no explicit fingerprint is supplied, a preset is matched against the Camoufox binary's Firefox version (bundles for FF ≤148 and FF 149+), falling back to the existing Bayesian-network synthesizer. Behavior is unchanged when an explicit fingerprint is passed.
- **Keyboard shortcuts + command palette.** New ⌘K command palette (cmdk) and ⌘/ shortcuts help. Upstream's page-based navigation actions were remapped onto the fork's dialog model (`Mod+1..9` switch groups; shortcuts open the corresponding dialogs; palette can launch/stop profiles).
- **Password-protected profiles.** Per-profile AES-256-GCM on-disk encryption (reusing the fork's existing `sync::encryption` primitives), with set/unlock/change/remove flows, progressive lockout, and atomic staging+backup so an interrupted operation never loses data. New `password_protected`/`created_at` profile fields and a `keep_decrypted_profiles_in_ram` setting are all `#[serde(default)]` for backward compatibility with existing profiles.

### Fixes

- **Auto-updater now targets the fork repository** (`GaryOAO/donutbrowser`) instead of upstream `zhom/donutbrowser`. Previously the updater offered the upstream release and, on macOS/Windows, would silently overwrite this fork build — wiping all fork-specific features. Only fork releases are offered now.

### Notes

- Cookie import/export format support (Netscape/JSON) was already present in the fork; no change was needed.
- Ports were implemented on isolated worktree branches and merged after a clean `pnpm format` + `pnpm lint` (biome + tsc + clippy `-D warnings` + typos) and `cargo test --lib` (400 passed).
- Password-protected and ephemeral are mutually exclusive; a forgotten profile password is unrecoverable by design.


## v0.22.8 (2026-05-29)

> Fork-specific release (GaryOAO/donutbrowser). Comprehensive UX, performance,
> security and correctness work across 6 review waves with 11 parallel agents.
> See release notes for the SID-algorithm one-time migration note.

### Features

- **Clash subscription pool integrated into create-profile flow.** New `ProxySourcePicker` lists subscription nodes inline alongside stored proxies and VPNs, eliminating the previous 3-modal dance.
- **Unified `ProxySourceId` tagged union** replaces the brittle `vpn-` string-prefix encoding; eliminates the proxy-id/vpn-id namespace ambiguity.
- **Hot proxy swap for running profiles.** `update_profile_proxy` and `set_profile_proxy_source` now restart the local proxy worker when the profile is running (port-reuse strategy A); browser stays connected, `profile-proxy-hot-swapped` event surfaces a confirmation toast.
- **Bulk task cancellation + progress.** `run_bulk_browser_tasks` accepts a `task_id`, emits `bulk-task-progress` per-item, and a new `cancel_bulk_browser_task` command stops the queue.
- **Sync conflict detection (manifest v2).** File-level three-way merge with per-file `mtime_ms`/`sha256`/`tombstones`; conflicting edits keep local and stage remote as `<path>.conflict-<deviceId>-<ms>`; emits `sync-conflict-detected`.
- **Background browser download visibility.** `bg-browser-download-started`/`completed` events drive a loading toast so users see why the network is busy after startup.
- **Profile auto-upgrade visibility.** New `profiles-auto-upgraded` event surfaces silent version bumps in a toast with the affected profile names.

### UX

- **Create profile decision count cut from ~6 to 2 must-set.** Single-page layout with auto-suggested name (`Profile N`), default browser, collapsed Advanced section, sensible defaults for ephemeral/DNS/binding-mode/fingerprint OS.
- **Download no longer blocks profile creation.** Create returns immediately; binary readiness is enforced at launch time instead.
- **Extension management flattened from 3 nested dialogs to a single master-detail layout.** Inline editing for groups and extensions; only delete confirmation retains a (single-layer) modal.
- **Group management uses inline create/rename** with Enter/Escape semantics; no more nested edit dialogs.
- **Unified `BulkAssignDialog`** replaces separate group / extension-group assignment dialogs; pre-selects the common current value, shows "Mixed" when selections diverge, inline "+ New" creation.
- **Wayfern terms dialog gains a Decline path** with a persistent `WAYFERN_TERMS_DECLINED_KEY` flag so users aren't trapped.
- **Cloud login URL now opens in the system browser** instead of being routed through the profile selector (closes upstream PR #389).
- **macOS permission polling is now bounded** (60 attempts cap) so a denied prompt no longer keeps the hook spinning.
- **All profile-table columns are sortable** (name / tags / note / proxy / sync), with sync ranked `error < syncing < waiting < synced < disabled`.
- **TagsCell rendered with pure CSS clipping + tooltip overlay** — removed per-row Canvas + ResizeObserver measurement.
- **Group badges drag-to-scroll replaced with native overflow + horizontal wheel scroll**, restoring accessibility.
- **Rename path consolidated** to a single onBlur exit; the conflicting global mousedown listener is removed.
- **App restart pre-flight check** rejects restart while profiles are running with a structured, actionable error.
- **DNS tier labels renamed** from billing terms (`pro`/`pro_plus`/`ultimate`) to functional descriptions (`light`/`standard`/`strict`/`maximum`); backend enum values unchanged.
- **`crossOsUnlocked` defaults to `false`** so the cross-OS warning no longer fires for every Camoufox create.

### Performance

- **Backend pushes `profile-running-changed` on every transition; removed frontend 30s/profile IPC poll.** When no profile holds a PID, the backend status checker idles at 30s; otherwise polls at 5s and only emits on transitions.
- **`active_proxies` HashMap re-keyed** by `enum ActiveProxyKey { Pending(AtomicU64), Browser(u32) }` to eliminate the temp-PID=0 collision that produced orphan donut-proxy workers under concurrent launches.
- **Subscription pool node testing capped at 32 concurrent probes** via `tokio::sync::Semaphore`; batch test path saves manifest once at completion (was per-node).
- **`BlocklistMatcher::is_blocked` zero-alloc fast path.** ASCII-lowercase hostnames (the steady state) match directly against the `HashSet<String>` via `Borrow<str>` — no per-request `to_lowercase` allocation.
- **`TrafficStats.unique_ips` switched from `Vec<String>` to `HashSet<String>`** — `record_ip` now O(1) with zero allocations after first sighting.
- **`generate_sid_for_profile` uses SHA-256 instead of `DefaultHasher`** for stable sticky-session IDs across Rust toolchain upgrades. (See migration note below.)
- **Extension installation skips unchanged `.xpi`/.crx** via `(len, mtime)` and `.unpacked-mtime` marker comparison — large extension packs no longer re-copy on every launch.
- **Wayfern token unavailability cached for 60s** — eliminates the recurring 3-second launch penalty when `api.donutbrowser.com` is unreachable.
- **Conditional dialog mounting in `page.tsx`** — major dialogs are unmounted while closed, freeing their event subscriptions and initial `invoke`s.
- **Atomic JSON writes** (`tempfile` + `persist`) for proxy/settings storage — prevents half-written configs on crash/power-loss.
- **Override-map pruning in profile-data-table** removes long-running memory growth from optimistic-update entries that backend events have already superseded.

### Security

- **Strict Content Security Policy** applied in `tauri.conf.json` (was `null`).
- **Capability scope tightened** — removed all `shell:allow-execute|spawn|kill|stdin-write|open` (frontend has no shell-plugin call sites); `fs:allow-write-text-file` scoped to user directories only. Closes the XSS→RCE chain that the prior `csp: null` + permissive shell allow-list enabled.
- **API token constant-time comparison** via `subtle::ConstantTimeEq`; CORS predicate limits origins to `tauri://localhost` and `localhost`/`127.0.0.1`.
- **MCP token in URL path deprecated**; `/mcp/{token}` returns HTTP 410 Gone, header-only auth (`Authorization: Bearer`) is enforced.
- **Pre-launch SingletonLock detection.** When `<udd>/SingletonLock` resolves to a live PID, launch fails fast with an actionable error instead of hanging 120 seconds on CDP timeout; stale locks (dead PID) are cleaned up automatically.
- **Orphan Chromium cleanup on CDP failure.** When `wait_for_cdp_ready` or `get_cdp_targets` fails, the spawned child is SIGTERM → SIGKILL'd so the next launch doesn't hit a stale `SingletonLock`.
- **Pre-launch binary existence check** — missing browser binary now produces `"Browser binary missing for {browser} {version}. Please re-download it from Settings."` instead of a raw `No such file or directory`.
- **Replaced 4 `serde_json::to_value(...).unwrap()` panic sites in `mcp_server.rs`** with `?` error propagation; user-controllable profile fields can no longer crash the MCP server thread.
- **Removed `.unwrap()` panic paths** in `proxy_manager.rs` start/stop and port parsing; failures now log + return Err.
- **`stored_proxies.get_mut(...).unwrap()` race fixed** — the brief lock-release window now returns a structured error instead of panicking.

### Refactoring

- New `src-tauri/src/atomic_write.rs` helper module.
- New `src/lib/format.ts` consolidates duplicated `formatBytes`/`formatTime` helpers across 5 components (migration TODO noted in file).
- Master-detail layout for extension management replaces a 3-deep `<Dialog>` stack.
- `proxy-assignment-dialog` reuses the new `ProxySourcePicker` and reads the current binding via the unified `ProxySourceId`.

### Maintenance

- Removed 3 zero-import frontend components (`commercial-trial-modal.tsx`, `location-proxy-dialog.tsx`, `release-type-selector.tsx`).
- Removed 5 unused Tauri commands (`acknowledge_trial_expiration`, `cloud_get_regions`/`cities`/`isps`, `resolve_profile_proxy_info`); cleaned the stale "MCP-only" exemption allowlist.
- `proxy_server.rs` startup messages downgraded from `log::error!` to `log::info!` (8 sites) — no longer trips monitoring/alert systems on normal startup.
- `BrowserProfile.deleted_at` and `StoredProxy.dynamic_proxy_url`/`dynamic_proxy_format` added to `src/types.ts` to match the Rust shapes.
- Added 21 new tests (4 `ActiveProxyKey` collision regressions, 11 sync manifest diff cases, 6 sync integration scenarios, 1 SID golden value).

### Migration notes

- **SID algorithm change is a one-time migration.** Every existing profile loses its current sticky-session IP exactly once on first launch after upgrading to 0.22.8; subsequent launches are stable. Under the previous `DefaultHasher` they were silently at risk of the same change on every Rust toolchain bump.
- **Sync manifest v2** is forward-compatible with v1 (`migrate_to_v2` is idempotent). First sync after upgrade rebuilds per-file `mtime_ms`/`sha256` from disk.
- **`update_profile_proxy` legacy command** retained but now hot-swaps for running profiles; if hot-swap fails (port still bound), returns `"Cannot hot-swap, restart the profile manually"` and the UI surfaces the error.

### Known limitations

- Fork is 1357 commits behind `zhom/donutbrowser` (upstream is at v0.24.4). Upstream rebase is a separate effort.
- Vault password is still the build-time `DONUT_BROWSER_VAULT_PASSWORD` env var; full E2E hardening requires user-supplied master password UX (not in this release).
- `tableMeta` cell re-render optimisation deferred — requires `React.memo`-per-cell + context-backed dynamic store.


## v0.22.7 (2026-05-05)

### Refactoring

- cleanup

### Maintenance

- chore: version bump
- chore: copy
- chore: update flake.nix for v0.22.6 [skip ci] (#337)


## v0.22.6 (2026-05-03)

### Features

- vpn manipulation via the api

### Refactoring

- don't block ui on clade check

### Documentation

- update CHANGELOG.md and README.md for v0.22.5 [skip ci] (#327)

### Maintenance

- chore: version bump
- chore: rand bump
- chore: pnpm bump
- ci(deps): bump the github-actions group with 3 updates (#330)
- chore: update flake.nix for v0.22.5 [skip ci] (#328)

### Other

- deps(rust)(deps): bump the rust-dependencies group (#331)


## v0.22.5 (2026-04-29)

### Bug Fixes

- declare libxdo as runtime dependency

### Maintenance

- chore: version bump
- chore: copy
- chore: update flake.nix for v0.22.4 [skip ci] (#324)


## v0.22.4 (2026-04-28)

### Maintenance

- chore: version bump
- chore: i18n
- chore: update flake.nix for v0.22.3 [skip ci] (#321)


## v0.22.3 (2026-04-27)

### Bug Fixes

- correct browser port mapping

### Maintenance

- chore: version bump
- chore: update flake.nix for v0.22.2 [skip ci] (#315)


## v0.22.2 (2026-04-27)

### Refactoring

- cookie management

### Maintenance

- chore: version bump
- chore: update flake.nix for v0.22.1 [skip ci] (#313)


## v0.22.1 (2026-04-27)

### Bug Fixes

- link proper wayfern tos

### Refactoring

- vpn refresh and remove openvpn support

### Documentation

- update CHANGELOG.md and README.md for v0.22.0 [skip ci] (#306)

### Maintenance

- chore: version bump
- chore: linting
- chore: audit
- chore: update flake.nix for v0.22.0 [skip ci] (#307)

### Other

- deps(rust)(deps): bump the rust-dependencies group across 1 directory with 34 updates (#305)


## v0.22.0 (2026-04-25)

### Refactoring

- auth and wayfern
- cdp gates cleanup

### Maintenance

- chore: tests
- chore:cargo audit
- chore: version bump
- chore: ignore .claude
- chore: update flake.nix for v0.21.2 [skip ci] (#298)


## v0.21.2 (2026-04-21)

### Bug Fixes

- properly handle headless mode

### Maintenance

- chore: version bump
- chore: update flake.nix for v0.21.1 [skip ci] (#295)


## v0.21.1 (2026-04-19)

### Features

- shadowsocks

### Refactoring

- better cleanup
- proxy cleanup

### Maintenance

- chore: version bump
- chore: linting
- ci(deps): bump the github-actions group with 3 updates
- chore: update flake.nix for v0.21.0 [skip ci] (#289)


## v0.21.0 (2026-04-16)

### Features

- shadowsocks

### Bug Fixes

- vpn config discovery

### Refactoring

- cleanup
- stricter proxy cleanup
- wayfern launch
- better error handling
- self-updates
- x64 performance

### Maintenance

- chore: version bump
- chore: proper formatting
- chore: remove pre-installed aws cli
- chore: update flake.nix for v0.20.4 [skip ci] (#283)

### Other

- deps(rust)(deps): bump rand from 0.10.0 to 0.10.1 in /src-tauri (#285)
- style: button should not become bigger on hover
- style: scrollbars


## v0.20.4 (2026-04-11)

### Refactoring

- vpn
- save port

### Maintenance

- chore: version bump
- chore: linting
- chore: overwrite aws cli
- ci(deps): bump the github-actions group with 3 updates
- chore: update flake.nix for v0.20.3 [skip ci] (#278)

### Other

- style: copy
- deps(rust)(deps): bump the rust-dependencies group
- deps(deps): bump next from 16.2.2 to 16.2.3


## v0.20.3 (2026-04-10)

### Refactoring

- debug wayfern launch

### Maintenance

- chore: version bump
- chore: serialize changelog and flake jobs
- chore: update flake.nix for v0.20.2 [skip ci] (#273)


## v0.20.2 (2026-04-08)

### Maintenance

- chore: version bump
- chore: aws integrity checks
- chore: inject NEXT_PUBLIC_TURNSTILE everywhere
- chore: update flake.nix for v0.20.1 [skip ci] (#272)


## v0.20.1 (2026-04-08)

### Maintenance

- chore: version bump
- chore: normalize r2 endpoint
- chore: pull turnstile public key in frontend at build time
- chore: update flake.nix for v0.20.0 [skip ci] (#270)


## v0.20.0 (2026-04-08)

### Bug Fixes

- cookie copying for wayfern

### Refactoring

- cleanup
- dynamic proxy

### Documentation

- update CHANGELOG.md and README.md for v0.19.0 [skip ci] (#261)

### Maintenance

- chore: version bump
- chore: linting
- chore: linting
- chore: linting
- chore: update flake.nix for v0.19.0 [skip ci] (#262)

### Other

- deps(rust)(deps): bump the rust-dependencies group
- deps(deps): bump the frontend-dependencies group with 19 updates


## v0.19.0 (2026-04-04)

### Features

- captcha on email input
- dns block lists
- portable build

### Bug Fixes

- follow latest MCP spec
- wayfern initial connection on macos doesn't timeout

### Refactoring

- linux auto updates
- more robust vpn handling
- don't allow portable build to be set as the default browser
- show app version in settings

### Documentation

- remove codacy badge
- agents
- contrib-readme-action has updated readme
- update CHANGELOG.md and README.md for v0.18.1 [skip ci]
- cleanup

### Maintenance

- test: simplify
- chore: preserve cargo
- chore: version bump
- chore: linting
- chore: update dependencies
- chore: repo publish workflow
- chore: copy and backlink
- test: serialize
- chore: copy correct file
- chore: linting
- chore: do not provide possible cause
- chore: linting
- chore: linting
- chore: linting
- chore: linting
- ci(deps): bump the github-actions group with 8 updates
- chore: commit doc changes directly and pretty discord notifications
- chore: update flake.nix for v0.18.1 [skip ci]
- chore: fix linting and formatting

### Other

- deps(deps): bump the frontend-dependencies group with 35 updates
- deps(rust)(deps): bump the rust-dependencies group

## v0.18.1 (2026-03-24)

### Refactoring

- run docker workflow on release

### Documentation

- agents.md

### Maintenance

- chore: version bump
- chore: require ai disclosure
- chore: redeploy web on new release
- chore: fix e2e in pr requests
- chore: issues get stale after 30 days
- chore: better issue validation
- chore: update flake.nix for v0.18.0 [skip ci] (#247)

