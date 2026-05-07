"use client";

import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuCheck, LuChevronsUpDown } from "react-icons/lu";
import { toast } from "sonner";
import { LoadingButton } from "@/components/loading-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type {
  BrowserProfile,
  PoolNode,
  ProxySource,
  StoredProxy,
  Subscription,
  VpnConfig,
} from "@/types";
import { RippleButton } from "./ui/ripple";

interface ProxyAssignmentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedProfiles: string[];
  onAssignmentComplete: () => void;
  profiles?: BrowserProfile[];
  storedProxies?: StoredProxy[];
  vpnConfigs?: VpnConfig[];
}

export function ProxyAssignmentDialog({
  isOpen,
  onClose,
  selectedProfiles,
  onAssignmentComplete,
  profiles = [],
  storedProxies = [],
  vpnConfigs = [],
}: ProxyAssignmentDialogProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionType, setSelectionType] = useState<
    "none" | "proxy" | "vpn" | "node"
  >("none");
  const [isAssigning, setIsAssigning] = useState(false);
  const [proxyPopoverOpen, setProxyPopoverOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [poolNodes, setPoolNodes] = useState<PoolNode[]>([]);
  const [isLoadingNodes, setIsLoadingNodes] = useState(false);

  const loadSubscriptionData = useCallback(async () => {
    setIsLoadingNodes(true);
    try {
      const [subs, nodes] = await Promise.all([
        invoke<Subscription[]>("list_subscriptions"),
        invoke<PoolNode[]>("list_pool_nodes"),
      ]);
      setSubscriptions(subs);
      setPoolNodes(nodes);
    } catch (err) {
      console.error("Failed to load subscriptions:", err);
    } finally {
      setIsLoadingNodes(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setSelectedId(null);
      setSelectionType("none");
      setError(null);
      void loadSubscriptionData();
    }
  }, [isOpen, loadSubscriptionData]);

  const handleValueChange = useCallback((value: string) => {
    if (value === "none") {
      setSelectedId(null);
      setSelectionType("none");
    } else if (value.startsWith("vpn-")) {
      setSelectedId(value.slice(4));
      setSelectionType("vpn");
    } else {
      setSelectedId(value);
      setSelectionType("proxy");
    }
  }, []);

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedId(nodeId);
    setSelectionType("node");
  }, []);

  const handleAssign = useCallback(async () => {
    setIsAssigning(true);
    setError(null);
    try {
      const validProfiles = selectedProfiles.filter((profileId) =>
        profiles.find((p) => p.id === profileId),
      );

      if (validProfiles.length === 0) {
        setError(t("proxyAssignment.noValidProfiles"));
        setIsAssigning(false);
        return;
      }

      for (const profileId of validProfiles) {
        if (selectionType === "vpn") {
          await invoke("update_profile_vpn", {
            profileId,
            vpnId: selectedId,
          });
        } else if (selectionType === "node" && selectedId) {
          const proxySource: ProxySource = {
            type: "SubscriptionNode",
            id: selectedId,
          };
          await invoke("set_profile_proxy_source", { profileId, proxySource });
        } else if (selectionType === "proxy" && selectedId) {
          const proxySource: ProxySource = {
            type: "StoredProxy",
            id: selectedId,
          };
          await invoke("set_profile_proxy_source", { profileId, proxySource });
          await invoke("update_profile_proxy", {
            profileId,
            proxyId: selectedId,
          });
        } else {
          await invoke("set_profile_proxy_source", {
            profileId,
            proxySource: null,
          });
          await invoke("update_profile_proxy", {
            profileId,
            proxyId: null,
          });
        }
      }

      await emit("profile-updated");
      onAssignmentComplete();
      onClose();
    } catch (err) {
      console.error("Failed to assign proxy/VPN to profiles:", err);
      const errorMessage =
        err instanceof Error
          ? err.message
          : t("proxyAssignment.failedFallback");
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsAssigning(false);
    }
  }, [
    selectedProfiles,
    selectedId,
    selectionType,
    profiles,
    onAssignmentComplete,
    onClose,
    t,
  ]);

  const nativelySupportedProtocols = new Set([
    "http",
    "https",
    "socks5",
    "socks4",
    "ss",
  ]);

  const gatewayProtocols = new Set([
    "vmess",
    "vless",
    "trojan",
    "hysteria",
    "hysteria2",
    "tuic",
  ]);

  const nodeNeedsGateway = (node: PoolNode) => {
    if (node.protocol === "unknown") return false;
    if (nativelySupportedProtocols.has(node.protocol) && !node.extra?.plugin)
      return false;
    if (gatewayProtocols.has(node.protocol)) return true;
    if (nativelySupportedProtocols.has(node.protocol) && node.extra?.plugin)
      return true;
    return false;
  };

  const nodesBySubscription = subscriptions
    .map((sub) => ({
      sub,
      nodes: poolNodes.filter((n) => n.subscription_id === sub.id),
    }))
    .filter(({ nodes }) => nodes.length > 0);

  const currentProxySource =
    selectedProfiles.length === 1
      ? profiles.find((p) => p.id === selectedProfiles[0])?.proxy_source
      : undefined;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("proxyAssignment.title")}</DialogTitle>
          <DialogDescription>
            {selectedProfiles.length === 1
              ? t("proxyAssignment.description_one", {
                  count: selectedProfiles.length,
                })
              : t("proxyAssignment.description_other", {
                  count: selectedProfiles.length,
                })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("proxyAssignment.selectedProfilesLabel")}</Label>
            <div className="p-3 bg-muted rounded-md max-h-32 overflow-y-auto">
              <ul className="text-sm space-y-1">
                {selectedProfiles.map((profileId) => {
                  const profile = profiles.find(
                    (p: BrowserProfile) => p.id === profileId,
                  );
                  const displayName = profile ? profile.name : profileId;
                  return (
                    <li key={profileId} className="truncate">
                      &bull; {displayName}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <Tabs defaultValue="proxies">
            <TabsList className="w-full">
              <TabsTrigger value="proxies" className="flex-1">
                {t("proxies.assignment.tabStoredProxies")}
              </TabsTrigger>
              <TabsTrigger value="nodes" className="flex-1">
                {t("proxies.assignment.tabSubscriptionNodes")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="proxies" className="mt-3 space-y-2">
              <Label htmlFor="proxy-vpn-select">
                {t("proxyAssignment.assignProxyVpnLabel")}
              </Label>
              <Popover
                open={proxyPopoverOpen}
                onOpenChange={setProxyPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={proxyPopoverOpen}
                    className="w-full justify-between font-normal"
                  >
                    {(() => {
                      if (selectionType === "none")
                        return t("proxyAssignment.noneOption");
                      if (selectionType === "vpn") {
                        const vpn = vpnConfigs.find((v) => v.id === selectedId);
                        return vpn
                          ? `WG — ${vpn.name}`
                          : t("proxyAssignment.noneOption");
                      }
                      if (selectionType === "proxy") {
                        const proxy = storedProxies.find(
                          (p) => p.id === selectedId,
                        );
                        return proxy
                          ? proxy.name
                          : t("proxyAssignment.noneOption");
                      }
                      return t("proxyAssignment.noneOption");
                    })()}
                    <LuChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[240px] p-0" sideOffset={8}>
                  <Command>
                    <CommandInput
                      placeholder={t("proxyAssignment.searchPlaceholder")}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {t("proxyAssignment.notFound")}
                      </CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__none__"
                          onSelect={() => {
                            handleValueChange("none");
                            setProxyPopoverOpen(false);
                          }}
                        >
                          <LuCheck
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectionType === "none"
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                          {t("proxyAssignment.noneOption")}
                        </CommandItem>
                        {storedProxies
                          .filter(
                            (proxy) =>
                              !proxy.is_cloud_managed &&
                              !proxy.is_cloud_derived,
                          )
                          .map((proxy) => (
                            <CommandItem
                              key={proxy.id}
                              value={proxy.name}
                              onSelect={() => {
                                handleValueChange(proxy.id);
                                setProxyPopoverOpen(false);
                              }}
                            >
                              <LuCheck
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectionType === "proxy" &&
                                    selectedId === proxy.id
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
                              {proxy.name}
                            </CommandItem>
                          ))}
                      </CommandGroup>
                      {vpnConfigs.length > 0 && (
                        <CommandGroup
                          heading={t("proxyAssignment.vpnGroupHeading")}
                        >
                          {vpnConfigs.map((vpn) => (
                            <CommandItem
                              key={vpn.id}
                              value={`vpn-${vpn.name}`}
                              onSelect={() => {
                                handleValueChange(`vpn-${vpn.id}`);
                                setProxyPopoverOpen(false);
                              }}
                            >
                              <LuCheck
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectionType === "vpn" &&
                                    selectedId === vpn.id
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1 py-0 leading-tight mr-1"
                              >
                                WG
                              </Badge>
                              {vpn.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </TabsContent>

            <TabsContent value="nodes" className="mt-3">
              {isLoadingNodes ? (
                <div className="text-sm text-muted-foreground py-4 text-center">
                  {t("proxies.assignment.loadingNodes")}
                </div>
              ) : nodesBySubscription.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">
                  {t("proxies.assignment.noSubscriptions")}
                </div>
              ) : (
                <ScrollArea className="h-64">
                  <div className="space-y-4 pr-2">
                    {nodesBySubscription.map(({ sub, nodes }) => (
                      <div key={sub.id}>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                          {sub.name}
                        </p>
                        <div className="space-y-1">
                          {nodes.map((node) => {
                            const isSelected =
                              selectionType === "node" &&
                              selectedId === node.id;
                            const isCurrentlyBound =
                              currentProxySource?.type === "SubscriptionNode" &&
                              currentProxySource.id === node.id;
                            return (
                              <button
                                key={node.id}
                                type="button"
                                aria-label={t("proxies.assignment.selectNode")}
                                onClick={() => handleSelectNode(node.id)}
                                className={cn(
                                  "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors",
                                  isSelected
                                    ? "bg-primary/10 border border-primary/30"
                                    : "hover:bg-accent/50 border border-transparent",
                                )}
                              >
                                <LuCheck
                                  className={cn(
                                    "h-4 w-4 shrink-0",
                                    isSelected ? "opacity-100" : "opacity-0",
                                  )}
                                />
                                <span className="flex-1 truncate">
                                  {node.name}
                                </span>
                                <div className="flex items-center gap-1 shrink-0">
                                  {isCurrentlyBound && (
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px] px-1 py-0 leading-tight"
                                    >
                                      {t("proxies.assignment.currentlyBound")}
                                    </Badge>
                                  )}
                                  {nodeNeedsGateway(node) && (
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
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>
          </Tabs>

          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                setSelectedId(null);
                setSelectionType("none");
              }}
              className="text-muted-foreground text-xs"
            >
              {t("proxies.assignment.removeProxy")}
            </Button>
          </div>

          {error && (
            <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <RippleButton
            variant="outline"
            onClick={onClose}
            disabled={isAssigning}
          >
            {t("common.buttons.cancel")}
          </RippleButton>
          <LoadingButton
            isLoading={isAssigning}
            onClick={() => void handleAssign()}
          >
            {t("proxyAssignment.assignButton")}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
