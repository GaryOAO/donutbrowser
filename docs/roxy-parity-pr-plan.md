# Roxy Parity Delivery Status

This document records the PR sequence used to move Donut Browser toward the requested RoxyBrowser-style workflows while keeping UI/UX aligned with native Donut patterns.

## Merged PRs

1. `#1` docs: parity assessment and phased roadmap.
2. `#2` backend: Clash-compatible proxy control scaffold and Tauri commands.
3. `#3` backend: profile proxy binding modes and health-aware proxy selection.
4. `#5` validation: proxy resilience tests, frontend state tests, and deterministic 100-profile acceptance harness.
5. `#4` frontend/backend: native Donut profile proxy binding UI wired through profile creation.
6. `#6` backend/frontend: structured operation logs and native operation log viewer.
7. `#7` backend/frontend: queued bulk profile tasks with bounded concurrency and native result UI.

## Delivered Scope

- Profile creation supports native proxy binding modes:
  - fixed proxy
  - sticky random healthy proxy
  - best healthy proxy per launch
- Browser launch uses health-aware proxy selection without regressing existing fixed proxy, launch hook, cloud proxy, VPN, Camoufox, or Wayfern behavior.
- Proxy health fields are persisted on stored proxies and used to skip cooldown nodes.
- Clash-compatible backend commands provide a control scaffold for group listing, node switching, latency checks, and subscription status.
- Operation logs capture proxy assignment, proxy startup, browser launch, and bulk task outcomes with sensitive message masking.
- Bulk profile tasks support start, stop, proxy change, and health check through one Tauri command with bounded concurrency, ordered results, explicit missing-profile failures, and retry accounting.
- The UI changes use existing Donut controls and density: select inputs, menu items with icons, buttons, badges, and table layouts.

## Validation

Final validation after merging the functional PRs:

```bash
pnpm lint:js
cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings -D clippy::all
cd src-tauri && cargo test --lib
node scripts/profile-batch-acceptance.mjs
```

Observed acceptance harness result with seed `1337`:

- Profiles: 100
- Success rate: 99.00%
- Recovery rate: 75.00%

## Remaining Gaps

These items are not claimed as delivered in this PR sequence:

- A full Meta/mihomo kernel runtime manager that owns the proxy pool process lifecycle.
- Provider URL refresh, large-list proxy table virtualization, and rich proxy metadata columns.
- Account Hub parity, profile template workflows, trash/restore, and full Roxy-style Window Sync controls.
- Complete REST/MCP parity for every new UI workflow.
- Team-space permission expansion beyond the existing sync and team lock paths.
