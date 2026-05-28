"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GoPlus } from "react-icons/go";
import { LuCheck, LuChevronsUpDown } from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { nodeNeedsGateway } from "@/lib/pool-node-utils";
import {
  isProxySourceEqual,
  NONE_PROXY_SOURCE,
  type ProxySourceId,
  proxySourceLabel,
} from "@/lib/proxy-source-id";
import { cn } from "@/lib/utils";
import type { PoolNode, StoredProxy, Subscription, VpnConfig } from "@/types";

interface ProxySourcePickerProps {
  value: ProxySourceId;
  onChange: (value: ProxySourceId) => void;
  onCreateNewProxy?: () => void;
  storedProxies: StoredProxy[];
  vpnConfigs: VpnConfig[];
  subscriptions: Subscription[];
  poolNodes: PoolNode[];
  /** Defaults to `true`. Disable to hide subscription node groups (e.g. in
   *  contexts where clash routing isn't supported). */
  allowSubscriptions?: boolean;
  /** Defaults to `true`. Disable to hide VPN bindings. */
  allowVpns?: boolean;
  /** When true the popover is rendered disabled (useful while submitting). */
  disabled?: boolean;
  /** Optional explicit width for the popover trigger; defaults to full. */
  className?: string;
}

/**
 * Single combobox that lets the user pick where a profile routes its traffic:
 * nothing, a stored proxy, a WireGuard VPN, or a node from a clash
 * subscription. This replaces the prior pattern of stuffing all of those into
 * a string field with magic prefixes.
 */
export function ProxySourcePicker({
  value,
  onChange,
  onCreateNewProxy,
  storedProxies,
  vpnConfigs,
  subscriptions,
  poolNodes,
  allowSubscriptions = true,
  allowVpns = true,
  disabled = false,
  className,
}: ProxySourcePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const lookup = useMemo(
    () => ({
      proxies: storedProxies,
      vpns: vpnConfigs,
      nodes: poolNodes,
    }),
    [storedProxies, vpnConfigs, poolNodes],
  );

  const triggerLabel = proxySourceLabel(value, t, lookup);

  const filteredProxies = useMemo(
    () =>
      storedProxies.filter((p) => !p.is_cloud_managed && !p.is_cloud_derived),
    [storedProxies],
  );

  const nodesBySubscription = useMemo(
    () =>
      subscriptions
        .map((sub) => ({
          sub,
          nodes: poolNodes.filter((n) => n.subscription_id === sub.id),
        }))
        .filter(({ nodes }) => nodes.length > 0),
    [subscriptions, poolNodes],
  );

  const selectNone = () => {
    onChange(NONE_PROXY_SOURCE);
    setOpen(false);
  };

  const selectStored = (id: string) => {
    onChange({ kind: "stored", id });
    setOpen(false);
  };

  const selectVpn = (id: string) => {
    onChange({ kind: "vpn", id });
    setOpen(false);
  };

  const selectNode = (node: PoolNode) => {
    onChange({
      kind: "subscription",
      subscriptionId: node.subscription_id,
      nodeId: node.id,
    });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className="truncate">{triggerLabel}</span>
          <LuChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        sideOffset={8}
      >
        <Command>
          <CommandInput placeholder={t("createProfile.networkSource.search")} />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>
              {t("createProfile.networkSource.notFound")}
            </CommandEmpty>

            <CommandGroup>
              <CommandItem value="__none__" onSelect={selectNone}>
                <LuCheck
                  className={cn(
                    "mr-2 h-4 w-4",
                    value.kind === "none" ? "opacity-100" : "opacity-0",
                  )}
                />
                {t("createProfile.networkSource.none")}
              </CommandItem>
            </CommandGroup>

            {filteredProxies.length > 0 && (
              <CommandGroup
                heading={t("createProfile.networkSource.storedProxies")}
              >
                {filteredProxies.map((proxy) => {
                  const isSelected = isProxySourceEqual(value, {
                    kind: "stored",
                    id: proxy.id,
                  });
                  return (
                    <CommandItem
                      key={proxy.id}
                      value={`proxy-${proxy.name}`}
                      onSelect={() => selectStored(proxy.id)}
                    >
                      <LuCheck
                        className={cn(
                          "mr-2 h-4 w-4",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="truncate">{proxy.name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {allowVpns && vpnConfigs.length > 0 && (
              <CommandGroup heading={t("createProfile.networkSource.vpns")}>
                {vpnConfigs.map((vpn) => {
                  const isSelected = isProxySourceEqual(value, {
                    kind: "vpn",
                    id: vpn.id,
                  });
                  return (
                    <CommandItem
                      key={vpn.id}
                      value={`vpn-${vpn.name}`}
                      onSelect={() => selectVpn(vpn.id)}
                    >
                      <LuCheck
                        className={cn(
                          "mr-2 h-4 w-4",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1 py-0 leading-tight mr-1"
                      >
                        WG
                      </Badge>
                      <span className="truncate">{vpn.name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {allowSubscriptions &&
              nodesBySubscription.map(({ sub, nodes }) => (
                <CommandGroup
                  key={sub.id}
                  heading={t(
                    "createProfile.networkSource.subscriptionHeading",
                    {
                      name: sub.name,
                    },
                  )}
                >
                  {nodes.map((node) => {
                    const isSelected = isProxySourceEqual(value, {
                      kind: "subscription",
                      subscriptionId: node.subscription_id,
                      nodeId: node.id,
                    });
                    const needsGateway = nodeNeedsGateway(node);
                    return (
                      <CommandItem
                        key={node.id}
                        value={`node-${sub.name}-${node.name}`}
                        onSelect={() => selectNode(node)}
                      >
                        <LuCheck
                          className={cn(
                            "mr-2 h-4 w-4 shrink-0",
                            isSelected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="flex-1 truncate">{node.name}</span>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          {needsGateway && (
                            <span className="text-[10px] bg-warning/10 text-warning-foreground px-1.5 py-0.5 rounded border border-warning/50">
                              {t("subscriptionPool.gatewayRequired")}
                            </span>
                          )}
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1 py-0 leading-tight"
                          >
                            {node.protocol}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {node.server}:{node.port}
                          </span>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}

            {onCreateNewProxy && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value="__create_new_proxy__"
                    onSelect={() => {
                      setOpen(false);
                      onCreateNewProxy();
                    }}
                    className="text-primary"
                  >
                    <GoPlus className="mr-2 h-4 w-4" />
                    {t("createProfile.networkSource.createNewProxy")}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
