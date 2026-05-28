import type { PoolNode } from "@/types";

const NATIVELY_SUPPORTED_PROTOCOLS = new Set([
  "http",
  "https",
  "socks5",
  "socks4",
  "ss",
]);

const GATEWAY_PROTOCOLS = new Set([
  "vmess",
  "vless",
  "trojan",
  "hysteria",
  "hysteria2",
  "tuic",
]);

/**
 * Whether launching with this node requires routing through the local
 * clash/donut-proxy gateway (because the protocol isn't natively spoken by
 * the browser proxy stack, or because the node uses a transport plugin).
 */
export function nodeNeedsGateway(node: PoolNode): boolean {
  if (node.protocol === "unknown") return false;
  if (NATIVELY_SUPPORTED_PROTOCOLS.has(node.protocol) && !node.extra?.plugin) {
    return false;
  }
  if (GATEWAY_PROTOCOLS.has(node.protocol)) return true;
  if (NATIVELY_SUPPORTED_PROTOCOLS.has(node.protocol) && node.extra?.plugin) {
    return true;
  }
  return false;
}
