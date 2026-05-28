import type { TFunction } from "i18next";
import type {
  BrowserProfile,
  PoolNode,
  ProxySource,
  StoredProxy,
  VpnConfig,
} from "@/types";

/**
 * Tagged-union identifier for everything the create/edit-profile flows can
 * set as a profile's outbound network source.
 *
 * The backend stores two related fields on a profile:
 *  - `proxy_source` (`{ type: "StoredProxy" | "SubscriptionNode", id }`)
 *  - the legacy `proxy_id` / `vpn_id` pair
 *
 * Frontend code historically encoded VPNs with a `"vpn-"` string prefix into
 * the same field as stored-proxy IDs, which made every consumer reach for
 * `startsWith("vpn-")`. This module replaces that with a typed discriminator.
 */
export type ProxySourceId =
  | { kind: "none" }
  | { kind: "stored"; id: string }
  | { kind: "vpn"; id: string }
  | { kind: "subscription"; subscriptionId: string; nodeId: string };

export const NONE_PROXY_SOURCE: ProxySourceId = { kind: "none" };

export function isProxySourceEqual(
  a: ProxySourceId,
  b: ProxySourceId,
): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "none":
      return true;
    case "stored":
    case "vpn":
      return a.id === (b as { id: string }).id;
    case "subscription": {
      const other = b as { subscriptionId: string; nodeId: string };
      return (
        a.subscriptionId === other.subscriptionId && a.nodeId === other.nodeId
      );
    }
  }
}

/**
 * Maps a ProxySourceId to the wire-level fields expected by
 * `create_browser_profile_new` (or any tauri command that consumes the same
 * shape):
 *
 *  - `proxy_id` / `vpn_id` are kept for back-compat with the legacy
 *    binding paths (stored proxies + WireGuard VPNs).
 *  - `proxy_source` carries the tagged enum the backend wires through
 *    `set_profile_proxy_source` (`ProxySource::StoredProxy` /
 *    `ProxySource::SubscriptionNode`).
 *
 * For subscription nodes we set `proxy_source` only (no proxy_id) — the
 * binding is resolved at launch via the clash pool. For stored proxies we
 * set both for compatibility with launch paths that still read `proxy_id`.
 */
export function proxySourceToBackend(src: ProxySourceId): {
  proxyId: string | null;
  vpnId: string | null;
  proxySource: ProxySource | null;
} {
  switch (src.kind) {
    case "none":
      return { proxyId: null, vpnId: null, proxySource: null };
    case "stored":
      return {
        proxyId: src.id,
        vpnId: null,
        proxySource: { type: "StoredProxy", id: src.id },
      };
    case "vpn":
      return { proxyId: null, vpnId: src.id, proxySource: null };
    case "subscription":
      return {
        proxyId: null,
        vpnId: null,
        proxySource: { type: "SubscriptionNode", id: src.nodeId },
      };
  }
}

/**
 * Reconstructs a `ProxySourceId` from a backend `BrowserProfile`. Prefers the
 * structured `proxy_source` field; falls back to the legacy `proxy_id` /
 * `vpn_id` fields for older profiles.
 */
export function proxySourceFromProfile(
  profile: Pick<BrowserProfile, "proxy_source" | "proxy_id" | "vpn_id">,
): ProxySourceId {
  if (profile.proxy_source) {
    if (profile.proxy_source.type === "SubscriptionNode") {
      // We don't know subscription_id here without the PoolNode lookup;
      // callers can re-resolve it via `nodeId` -> subscription mapping.
      return {
        kind: "subscription",
        subscriptionId: "",
        nodeId: profile.proxy_source.id,
      };
    }
    return { kind: "stored", id: profile.proxy_source.id };
  }
  if (profile.vpn_id) return { kind: "vpn", id: profile.vpn_id };
  if (profile.proxy_id) return { kind: "stored", id: profile.proxy_id };
  return NONE_PROXY_SOURCE;
}

export interface ProxySourceLookup {
  proxies: StoredProxy[];
  vpns: VpnConfig[];
  nodes: PoolNode[];
}

/**
 * Human-readable label for a ProxySourceId. Used by the picker trigger and
 * by anywhere we need to display the current binding.
 */
export function proxySourceLabel(
  src: ProxySourceId,
  t: TFunction,
  lookup: ProxySourceLookup,
): string {
  switch (src.kind) {
    case "none":
      return t("common.labels.none");
    case "stored": {
      const p = lookup.proxies.find((proxy) => proxy.id === src.id);
      return p ? p.name : t("common.labels.none");
    }
    case "vpn": {
      const v = lookup.vpns.find((vpn) => vpn.id === src.id);
      return v ? `WG — ${v.name}` : t("common.labels.none");
    }
    case "subscription": {
      const node = lookup.nodes.find((n) => n.id === src.nodeId);
      return node ? node.name : t("common.labels.none");
    }
  }
}
