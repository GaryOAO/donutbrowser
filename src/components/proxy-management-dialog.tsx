"use client";

import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GoPlus } from "react-icons/go";
import {
  LuDownload,
  LuList,
  LuPencil,
  LuPlus,
  LuRefreshCw,
  LuSignal,
  LuTrash2,
  LuUpload,
} from "react-icons/lu";
import { toast } from "sonner";
import { DeleteConfirmationDialog } from "@/components/delete-confirmation-dialog";
import { ProxyExportDialog } from "@/components/proxy-export-dialog";
import { ProxyFormDialog } from "@/components/proxy-form-dialog";
import { ProxyImportDialog } from "@/components/proxy-import-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProxyEvents } from "@/hooks/use-proxy-events";
import { useVpnEvents } from "@/hooks/use-vpn-events";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import type {
  PoolNode,
  ProxyCheckResult,
  StoredProxy,
  Subscription,
  VpnConfig,
} from "@/types";
import { ProxyCheckButton } from "./proxy-check-button";
import { RippleButton } from "./ui/ripple";
import { VpnCheckButton } from "./vpn-check-button";
import { VpnFormDialog } from "./vpn-form-dialog";
import { VpnImportDialog } from "./vpn-import-dialog";

type SyncStatus = "disabled" | "syncing" | "synced" | "error" | "waiting";

function getSyncStatusDot(
  item: { sync_enabled?: boolean; last_sync?: number },
  liveStatus: SyncStatus | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
  errorMessage?: string,
): { color: string; tooltip: string; animate: boolean } {
  const status = liveStatus ?? (item.sync_enabled ? "synced" : "disabled");

  switch (status) {
    case "syncing":
      return {
        color: "bg-warning",
        tooltip: t("syncTooltips.syncing"),
        animate: true,
      };
    case "synced":
      return {
        color: "bg-success",
        tooltip: item.last_sync
          ? t("syncTooltips.syncedAt", {
              time: new Date(item.last_sync * 1000).toLocaleString(),
            })
          : t("syncTooltips.synced"),
        animate: false,
      };
    case "waiting":
      return {
        color: "bg-warning",
        tooltip: t("syncTooltips.waiting"),
        animate: false,
      };
    case "error":
      return {
        color: "bg-destructive",
        tooltip: errorMessage
          ? t("syncTooltips.errorWith", { error: errorMessage })
          : t("syncTooltips.error"),
        animate: false,
      };
    default:
      return {
        color: "bg-muted-foreground",
        tooltip: t("syncTooltips.notSynced"),
        animate: false,
      };
  }
}

interface ProxyManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProxyManagementDialog({
  isOpen,
  onClose,
}: ProxyManagementDialogProps) {
  const { t } = useTranslation();
  // Proxy state
  const [showProxyForm, setShowProxyForm] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [editingProxy, setEditingProxy] = useState<StoredProxy | null>(null);
  const [proxyToDelete, setProxyToDelete] = useState<StoredProxy | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [checkingProxyId, setCheckingProxyId] = useState<string | null>(null);
  const [proxyCheckResults, setProxyCheckResults] = useState<
    Record<string, ProxyCheckResult>
  >({});
  const [proxySyncStatus, setProxySyncStatus] = useState<
    Record<string, SyncStatus>
  >({});
  const [proxySyncErrors, setProxySyncErrors] = useState<
    Record<string, string>
  >({});
  const [proxyInUse, setProxyInUse] = useState<Record<string, boolean>>({});
  const [isTogglingSync, setIsTogglingSync] = useState<Record<string, boolean>>(
    {},
  );
  const [selectedProxyIds, setSelectedProxyIds] = useState<Set<string>>(
    new Set(),
  );
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);

  // VPN state
  const [showVpnForm, setShowVpnForm] = useState(false);
  const [showVpnImportDialog, setShowVpnImportDialog] = useState(false);
  const [editingVpn, setEditingVpn] = useState<VpnConfig | null>(null);
  const [vpnToDelete, setVpnToDelete] = useState<VpnConfig | null>(null);
  const [isDeletingVpn, setIsDeletingVpn] = useState(false);
  const [checkingVpnId, setCheckingVpnId] = useState<string | null>(null);
  const [vpnSyncStatus, setVpnSyncStatus] = useState<
    Record<string, SyncStatus>
  >({});
  const [vpnSyncErrors, setVpnSyncErrors] = useState<Record<string, string>>(
    {},
  );
  const [vpnInUse, setVpnInUse] = useState<Record<string, boolean>>({});
  const [isTogglingVpnSync, setIsTogglingVpnSync] = useState<
    Record<string, boolean>
  >({});

  // Subscription pool state
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [poolNodes, setPoolNodes] = useState<PoolNode[]>([]);
  const [showSubAddForm, setShowSubAddForm] = useState(false);
  const [newSubName, setNewSubName] = useState("");
  const [newSubUrl, setNewSubUrl] = useState("");
  const [isAddingSub, setIsAddingSub] = useState(false);
  const [refreshingSubId, setRefreshingSubId] = useState<string | null>(null);
  const [testingNodeId, setTestingNodeId] = useState<string | null>(null);
  const [importingNodeId, setImportingNodeId] = useState<string | null>(null);
  const [importingAllSubId, setImportingAllSubId] = useState<string | null>(
    null,
  );
  const [selectedSubFilter, setSelectedSubFilter] = useState<string | null>(
    null,
  );
  const [testingAllSubId, setTestingAllSubId] = useState<string | null>(null);

  // Gateway state
  const [gatewayInstalled, setGatewayInstalled] = useState<boolean | null>(
    null,
  );
  const [isInstallingGateway, setIsInstallingGateway] = useState(false);

  const { storedProxies: rawProxies, proxyUsage, isLoading } = useProxyEvents();
  const { vpnConfigs, vpnUsage, isLoading: isLoadingVpns } = useVpnEvents();

  // Filter out cloud-managed and cloud-derived proxies (cloud proxies are deprecated)
  const storedProxies = rawProxies
    .filter((p) => !p.is_cloud_managed && !p.is_cloud_derived)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  useEffect(() => {
    if (!isOpen) return;
    const loadGatewayStatus = async () => {
      try {
        const status = await invoke<{ installed: boolean }>(
          "get_gateway_status",
        );
        setGatewayInstalled(status.installed);
      } catch {
        setGatewayInstalled(false);
      }
    };
    void loadGatewayStatus();
  }, [isOpen]);

  const handleInstallGateway = async () => {
    setIsInstallingGateway(true);
    try {
      await invoke("install_gateway");
      setGatewayInstalled(true);
      toast.success(t("gateway.installSuccess"));
    } catch (error) {
      toast.error(t("gateway.installError"), {
        description: String(error),
      });
    } finally {
      setIsInstallingGateway(false);
    }
  };

  // Listen for proxy sync status events
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<{ id: string; status: string; error?: string }>(
        "proxy-sync-status",
        (event) => {
          const { id, status, error } = event.payload;
          setProxySyncStatus((prev) => ({
            ...prev,
            [id]: status as SyncStatus,
          }));
          if (error) {
            setProxySyncErrors((prev) => ({ ...prev, [id]: error }));
          }
        },
      );
    };

    void setupListener();
    return () => {
      unlisten?.();
    };
  }, []);

  // Listen for VPN sync status events
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<{ id: string; status: string; error?: string }>(
        "vpn-sync-status",
        (event) => {
          const { id, status, error } = event.payload;
          setVpnSyncStatus((prev) => ({
            ...prev,
            [id]: status as SyncStatus,
          }));
          if (error) {
            setVpnSyncErrors((prev) => ({ ...prev, [id]: error }));
          }
        },
      );
    };

    void setupListener();
    return () => {
      unlisten?.();
    };
  }, []);

  // Load cached check results on mount and when proxies change
  useEffect(() => {
    const loadCachedResults = async () => {
      const results: Record<string, ProxyCheckResult> = {};
      const inUse: Record<string, boolean> = {};
      for (const proxy of storedProxies) {
        try {
          const cached = await invoke<ProxyCheckResult | null>(
            "get_cached_proxy_check",
            { proxyId: proxy.id },
          );
          if (cached) {
            results[proxy.id] = cached;
          }

          const inUseBySynced = await invoke<boolean>(
            "is_proxy_in_use_by_synced_profile",
            { proxyId: proxy.id },
          );
          inUse[proxy.id] = inUseBySynced;
        } catch (_error) {
          // Ignore errors
        }
      }
      setProxyCheckResults(results);
      setProxyInUse(inUse);
    };
    if (storedProxies.length > 0) {
      void loadCachedResults();
    }
  }, [storedProxies]);

  // Load VPN in-use status
  useEffect(() => {
    const loadVpnInUse = async () => {
      const inUse: Record<string, boolean> = {};
      for (const vpn of vpnConfigs) {
        try {
          const inUseBySynced = await invoke<boolean>(
            "is_vpn_in_use_by_synced_profile",
            { vpnId: vpn.id },
          );
          inUse[vpn.id] = inUseBySynced;
        } catch (_error) {
          // Ignore errors
        }
      }
      setVpnInUse(inUse);
    };
    if (vpnConfigs.length > 0) {
      void loadVpnInUse();
    }
  }, [vpnConfigs]);

  // Subscription pool data loading
  const loadSubscriptionData = useCallback(async () => {
    try {
      const [subs, nodes] = await Promise.all([
        invoke<Subscription[]>("list_subscriptions"),
        invoke<PoolNode[]>("list_pool_nodes", { subscriptionId: null }),
      ]);
      setSubscriptions(subs);
      setPoolNodes(nodes);
    } catch {
      // Ignore load errors
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadSubscriptionData();
    }
  }, [isOpen, loadSubscriptionData]);

  useEffect(() => {
    const unlisten = listen("subscription-pool-changed", () => {
      void loadSubscriptionData();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadSubscriptionData]);

  const handleAddSubscription = useCallback(async () => {
    if (!newSubName.trim() || !newSubUrl.trim()) return;
    setIsAddingSub(true);
    try {
      const sub = await invoke<Subscription>("add_subscription", {
        name: newSubName.trim(),
        url: newSubUrl.trim(),
      });
      showSuccessToast(
        t("subscriptionPool.addSuccess", { count: sub.node_count }),
      );
      setNewSubName("");
      setNewSubUrl("");
      setShowSubAddForm(false);
      await loadSubscriptionData();
    } catch (e) {
      showErrorToast(t("subscriptionPool.addError"), {
        description: String(e),
      });
    } finally {
      setIsAddingSub(false);
    }
  }, [newSubName, newSubUrl, loadSubscriptionData, t]);

  const handleRefreshSubscription = useCallback(
    async (subId: string) => {
      setRefreshingSubId(subId);
      try {
        const sub = await invoke<Subscription>("refresh_subscription", {
          subscriptionId: subId,
        });
        showSuccessToast(
          t("subscriptionPool.refreshSuccess", { count: sub.node_count }),
        );
        await loadSubscriptionData();
      } catch (e) {
        showErrorToast(t("subscriptionPool.refreshError"), {
          description: String(e),
        });
      } finally {
        setRefreshingSubId(null);
      }
    },
    [loadSubscriptionData, t],
  );

  const handleDeleteSubscription = useCallback(
    async (subId: string) => {
      try {
        await invoke("delete_subscription", { subscriptionId: subId });
        showSuccessToast(t("subscriptionPool.deleteSuccess"));
        if (selectedSubFilter === subId) {
          setSelectedSubFilter(null);
        }
        await loadSubscriptionData();
      } catch (e) {
        showErrorToast(t("subscriptionPool.deleteError"), {
          description: String(e),
        });
      }
    },
    [loadSubscriptionData, selectedSubFilter, t],
  );

  const handleImportNode = useCallback(
    async (nodeId: string) => {
      setImportingNodeId(nodeId);
      try {
        await invoke("import_pool_node_as_proxy", { nodeId });
        showSuccessToast(t("subscriptionPool.importNodeSuccess"));
        await loadSubscriptionData();
      } catch (e) {
        showErrorToast(t("subscriptionPool.importError"), {
          description: String(e),
        });
      } finally {
        setImportingNodeId(null);
      }
    },
    [loadSubscriptionData, t],
  );

  const handleImportAllNodes = useCallback(
    async (subId: string) => {
      setImportingAllSubId(subId);
      try {
        const ids = await invoke<string[]>("import_all_supported_pool_nodes", {
          subscriptionId: subId,
        });
        showSuccessToast(
          t("subscriptionPool.importSuccess", { count: ids.length }),
        );
        await loadSubscriptionData();
      } catch (e) {
        showErrorToast(t("subscriptionPool.importError"), {
          description: String(e),
        });
      } finally {
        setImportingAllSubId(null);
      }
    },
    [loadSubscriptionData, t],
  );

  const handleTestNodeLatency = useCallback(
    async (nodeId: string) => {
      setTestingNodeId(nodeId);
      try {
        const ms = await invoke<number>("test_pool_node_latency", { nodeId });
        showSuccessToast(t("subscriptionPool.latencyMs", { ms }));
        await loadSubscriptionData();
      } catch (e) {
        showErrorToast(t("subscriptionPool.refreshError"), {
          description: String(e),
        });
      } finally {
        setTestingNodeId(null);
      }
    },
    [loadSubscriptionData, t],
  );

  const handleTestAllNodes = useCallback(
    async (subscriptionId: string) => {
      setTestingAllSubId(subscriptionId);
      try {
        const [success, fail] = await invoke<[number, number]>(
          "test_all_pool_nodes",
          { subscriptionId },
        );
        showSuccessToast(
          t("subscriptionPool.testAllResult", { success, fail }),
        );
        await loadSubscriptionData();
      } catch (e) {
        showErrorToast(t("subscriptionPool.refreshError"), {
          description: String(e),
        });
      } finally {
        setTestingAllSubId(null);
      }
    },
    [loadSubscriptionData, t],
  );

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

  const isNodeImportable = (node: PoolNode) => {
    if (!nativelySupportedProtocols.has(node.protocol)) return false;
    if (node.extra?.plugin) return false;
    return true;
  };

  const nodeNeedsGateway = (node: PoolNode) => {
    if (node.protocol === "unknown") return false;
    if (isNodeImportable(node)) return false;
    if (gatewayProtocols.has(node.protocol)) return true;
    if (nativelySupportedProtocols.has(node.protocol) && node.extra?.plugin)
      return true;
    return false;
  };

  const filteredPoolNodes = selectedSubFilter
    ? poolNodes.filter((n) => n.subscription_id === selectedSubFilter)
    : poolNodes;

  // Proxy handlers
  const handleDeleteProxy = useCallback((proxy: StoredProxy) => {
    setProxyToDelete(proxy);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!proxyToDelete) return;
    setIsDeleting(true);
    try {
      await invoke("delete_stored_proxy", { proxyId: proxyToDelete.id });
      toast.success(t("proxies.management.deleteSuccess"));
      await emit("stored-proxies-changed");
    } catch (error) {
      console.error("Failed to delete proxy:", error);
      toast.error(t("proxies.management.deleteFailed"));
    } finally {
      setIsDeleting(false);
      setProxyToDelete(null);
    }
  }, [proxyToDelete, t]);

  const handleCreateProxy = useCallback(() => {
    setEditingProxy(null);
    setShowProxyForm(true);
  }, []);

  const handleEditProxy = useCallback((proxy: StoredProxy) => {
    setEditingProxy(proxy);
    setShowProxyForm(true);
  }, []);

  const handleProxyFormClose = useCallback(() => {
    setShowProxyForm(false);
    setEditingProxy(null);
  }, []);

  const handleToggleSync = useCallback(
    async (proxy: StoredProxy) => {
      setIsTogglingSync((prev) => ({ ...prev, [proxy.id]: true }));
      try {
        await invoke("set_proxy_sync_enabled", {
          proxyId: proxy.id,
          enabled: !proxy.sync_enabled,
        });
        showSuccessToast(
          proxy.sync_enabled
            ? t("proxies.management.syncDisabled")
            : t("proxies.management.syncEnabled"),
        );
        await emit("stored-proxies-changed");
      } catch (error) {
        console.error("Failed to toggle sync:", error);
        showErrorToast(
          error instanceof Error
            ? error.message
            : t("proxies.management.updateSyncFailed"),
        );
      } finally {
        setIsTogglingSync((prev) => ({ ...prev, [proxy.id]: false }));
      }
    },
    [t],
  );

  const handleBatchDelete = useCallback(async () => {
    setIsBatchDeleting(true);
    try {
      const ids = Array.from(selectedProxyIds);
      const deleted = await invoke<number>("batch_delete_stored_proxies", {
        proxyIds: ids,
      });
      showSuccessToast(
        t("proxies.management.batchDeleteSuccess", { count: deleted }),
      );
      setSelectedProxyIds(new Set());
      await emit("stored-proxies-changed");
    } catch (error) {
      console.error("Failed to batch delete proxies:", error);
      showErrorToast(
        error instanceof Error
          ? error.message
          : t("proxies.management.deleteFailed"),
      );
    } finally {
      setIsBatchDeleting(false);
      setShowBatchDeleteConfirm(false);
    }
  }, [selectedProxyIds, t]);

  // VPN handlers
  const handleDeleteVpn = useCallback((vpn: VpnConfig) => {
    setVpnToDelete(vpn);
  }, []);

  const handleConfirmDeleteVpn = useCallback(async () => {
    if (!vpnToDelete) return;
    setIsDeletingVpn(true);
    try {
      await invoke("delete_vpn_config", { vpnId: vpnToDelete.id });
      toast.success(t("vpns.management.deleteSuccess"));
      await emit("vpn-configs-changed");
    } catch (error) {
      console.error("Failed to delete VPN:", error);
      toast.error(t("vpns.management.deleteFailed"));
    } finally {
      setIsDeletingVpn(false);
      setVpnToDelete(null);
    }
  }, [vpnToDelete, t]);

  const handleCreateVpn = useCallback(() => {
    setEditingVpn(null);
    setShowVpnForm(true);
  }, []);

  const handleEditVpn = useCallback((vpn: VpnConfig) => {
    setEditingVpn(vpn);
    setShowVpnForm(true);
  }, []);

  const handleVpnFormClose = useCallback(() => {
    setShowVpnForm(false);
    setEditingVpn(null);
  }, []);

  const handleToggleVpnSync = useCallback(
    async (vpn: VpnConfig) => {
      setIsTogglingVpnSync((prev) => ({ ...prev, [vpn.id]: true }));
      try {
        await invoke("set_vpn_sync_enabled", {
          vpnId: vpn.id,
          enabled: !vpn.sync_enabled,
        });
        showSuccessToast(
          vpn.sync_enabled
            ? t("proxies.management.syncDisabled")
            : t("proxies.management.syncEnabled"),
        );
        await emit("vpn-configs-changed");
      } catch (error) {
        console.error("Failed to toggle VPN sync:", error);
        showErrorToast(
          error instanceof Error
            ? error.message
            : t("proxies.management.updateSyncFailed"),
        );
      } finally {
        setIsTogglingVpnSync((prev) => ({ ...prev, [vpn.id]: false }));
      }
    },
    [t],
  );

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-[min(95vw,1600px)] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t("proxies.management.title")}</DialogTitle>
            <DialogDescription>
              {t("proxies.management.description")}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="overflow-y-auto flex-1">
            <Tabs defaultValue="proxies">
              <TabsList className="w-full">
                <TabsTrigger value="proxies" className="flex-1">
                  {t("proxies.management.tabProxies")}
                </TabsTrigger>
                <TabsTrigger value="vpns" className="flex-1">
                  {t("proxies.management.tabVpns")}
                </TabsTrigger>
                <TabsTrigger value="subscriptions" className="flex-1">
                  {t("proxies.management.tabSubscriptions")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="proxies" className="mt-4">
                <div className="space-y-4">
                  {gatewayInstalled === false && (
                    <div className="flex items-center justify-between rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium text-warning-foreground">
                          {t("gateway.notInstalled")}
                        </p>
                        <p className="text-muted-foreground">
                          {t("gateway.description")}
                        </p>
                      </div>
                      <RippleButton
                        size="sm"
                        variant="outline"
                        onClick={() => void handleInstallGateway()}
                        disabled={isInstallingGateway}
                        className="ml-4 shrink-0"
                      >
                        {isInstallingGateway
                          ? t("gateway.installing")
                          : t("gateway.install")}
                      </RippleButton>
                    </div>
                  )}
                  {gatewayInstalled === true && (
                    <div className="flex items-center gap-2 rounded-md border border-success/50 bg-success/10 px-3 py-2 text-sm">
                      <div className="h-2 w-2 rounded-full bg-success shrink-0" />
                      <span className="text-success-foreground">
                        {t("gateway.installed")}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <div className="flex gap-2">
                      <RippleButton
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setShowImportDialog(true);
                        }}
                        className="flex gap-2 items-center"
                      >
                        <LuUpload className="w-4 h-4" />
                        {t("common.buttons.import")}
                      </RippleButton>
                      <RippleButton
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setShowExportDialog(true);
                        }}
                        className="flex gap-2 items-center"
                        disabled={storedProxies.length === 0}
                      >
                        <LuDownload className="w-4 h-4" />
                        {t("common.buttons.export")}
                      </RippleButton>
                    </div>
                    <div className="flex gap-2">
                      <RippleButton
                        size="sm"
                        onClick={handleCreateProxy}
                        className="flex gap-2 items-center"
                      >
                        <GoPlus className="w-4 h-4" />
                        {t("proxies.management.create")}
                      </RippleButton>
                    </div>
                  </div>

                  {selectedProxyIds.size > 0 && (
                    <div className="flex items-center gap-3 px-3 py-2 bg-muted rounded-md">
                      <span className="text-sm text-muted-foreground">
                        {t("proxies.management.selectedCount", {
                          count: selectedProxyIds.size,
                        })}
                      </span>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setShowBatchDeleteConfirm(true);
                        }}
                        className="flex gap-2 items-center"
                      >
                        <LuTrash2 className="w-4 h-4" />
                        {t("proxies.management.batchDelete")}
                      </Button>
                    </div>
                  )}

                  {isLoading ? (
                    <div className="text-sm text-muted-foreground">
                      {t("proxies.management.loading")}
                    </div>
                  ) : storedProxies.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      {t("proxies.management.noneCreated")}
                    </div>
                  ) : (
                    <div className="border rounded-md max-h-[240px] overflow-auto">
                      <Table className="min-w-max">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-px">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center">
                                    <Checkbox
                                      checked={
                                        storedProxies.length > 0 &&
                                        storedProxies.every((p) =>
                                          selectedProxyIds.has(p.id),
                                        )
                                      }
                                      onCheckedChange={(checked) => {
                                        if (checked) {
                                          setSelectedProxyIds(
                                            new Set(
                                              storedProxies.map((p) => p.id),
                                            ),
                                          );
                                        } else {
                                          setSelectedProxyIds(new Set());
                                        }
                                      }}
                                    />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{t("proxies.management.selectAll")}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TableHead>
                            <TableHead>{t("common.labels.name")}</TableHead>
                            <TableHead className="whitespace-nowrap w-px">
                              {t("proxies.management.usage")}
                            </TableHead>
                            <TableHead className="whitespace-nowrap w-px">
                              {t("proxies.management.syncCol")}
                            </TableHead>
                            <TableHead className="whitespace-nowrap w-px">
                              {t("common.labels.actions")}
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {storedProxies.map((proxy) => {
                            const syncDot = getSyncStatusDot(
                              proxy,
                              proxySyncStatus[proxy.id],
                              t,
                              proxySyncErrors[proxy.id],
                            );
                            return (
                              <TableRow key={proxy.id}>
                                <TableCell className="w-px">
                                  <Checkbox
                                    checked={selectedProxyIds.has(proxy.id)}
                                    onCheckedChange={(checked) => {
                                      setSelectedProxyIds((prev) => {
                                        const next = new Set(prev);
                                        if (checked) {
                                          next.add(proxy.id);
                                        } else {
                                          next.delete(proxy.id);
                                        }
                                        return next;
                                      });
                                    }}
                                  />
                                </TableCell>
                                <TableCell className="font-medium">
                                  <div className="flex items-center gap-2">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div
                                          className={`w-2 h-2 rounded-full shrink-0 ${syncDot.color} ${
                                            syncDot.animate
                                              ? "animate-pulse"
                                              : ""
                                          }`}
                                        />
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>{syncDot.tooltip}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                    {proxy.name}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="secondary">
                                    {proxyUsage[proxy.id] ?? 0}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="flex items-center">
                                        <Checkbox
                                          checked={proxy.sync_enabled}
                                          onCheckedChange={() =>
                                            void handleToggleSync(proxy)
                                          }
                                          disabled={
                                            isTogglingSync[proxy.id] ||
                                            proxyInUse[proxy.id]
                                          }
                                        />
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {proxyInUse[proxy.id] ? (
                                        <p>
                                          {t(
                                            "proxies.management.syncCannotDisable",
                                          )}
                                        </p>
                                      ) : (
                                        <p>
                                          {proxy.sync_enabled
                                            ? t(
                                                "proxies.management.disableSync",
                                              )
                                            : t(
                                                "proxies.management.enableSync",
                                              )}
                                        </p>
                                      )}
                                    </TooltipContent>
                                  </Tooltip>
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-1">
                                    <ProxyCheckButton
                                      proxy={proxy}
                                      profileId={proxy.id}
                                      checkingProfileId={checkingProxyId}
                                      cachedResult={proxyCheckResults[proxy.id]}
                                      setCheckingProfileId={setCheckingProxyId}
                                      onCheckComplete={(result) => {
                                        setProxyCheckResults((prev) => ({
                                          ...prev,
                                          [proxy.id]: result,
                                        }));
                                      }}
                                      onCheckFailed={(result) => {
                                        setProxyCheckResults((prev) => ({
                                          ...prev,
                                          [proxy.id]: result,
                                        }));
                                      }}
                                    />
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => {
                                            handleEditProxy(proxy);
                                          }}
                                        >
                                          <LuPencil className="w-4 h-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>
                                          {t("proxies.management.editProxy")}
                                        </p>
                                      </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                              handleDeleteProxy(proxy);
                                            }}
                                            disabled={
                                              (proxyUsage[proxy.id] ?? 0) > 0
                                            }
                                          >
                                            <LuTrash2 className="w-4 h-4" />
                                          </Button>
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {(proxyUsage[proxy.id] ?? 0) > 0 ? (
                                          <p>
                                            {(proxyUsage[proxy.id] ?? 0) === 1
                                              ? t(
                                                  "proxies.management.cannotDelete_one",
                                                  {
                                                    count: proxyUsage[proxy.id],
                                                  },
                                                )
                                              : t(
                                                  "proxies.management.cannotDelete_other",
                                                  {
                                                    count: proxyUsage[proxy.id],
                                                  },
                                                )}
                                          </p>
                                        ) : (
                                          <p>
                                            {t(
                                              "proxies.management.deleteProxy",
                                            )}
                                          </p>
                                        )}
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="vpns" className="mt-4">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="flex gap-2">
                      <RippleButton
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setShowVpnImportDialog(true);
                        }}
                        className="flex gap-2 items-center"
                      >
                        <LuUpload className="w-4 h-4" />
                        {t("common.buttons.import")}
                      </RippleButton>
                    </div>
                    <RippleButton
                      size="sm"
                      onClick={handleCreateVpn}
                      className="flex gap-2 items-center"
                    >
                      <GoPlus className="w-4 h-4" />
                      {t("proxies.management.create")}
                    </RippleButton>
                  </div>

                  {isLoadingVpns ? (
                    <div className="text-sm text-muted-foreground">
                      {t("vpns.management.loading")}
                    </div>
                  ) : vpnConfigs.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      {t("vpns.management.noneCreated")}
                    </div>
                  ) : (
                    <div className="border rounded-md max-h-[240px] overflow-auto">
                      <Table className="min-w-max">
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("common.labels.name")}</TableHead>
                            <TableHead className="whitespace-nowrap w-px">
                              {t("common.labels.type")}
                            </TableHead>
                            <TableHead className="whitespace-nowrap w-px">
                              {t("proxies.management.usage")}
                            </TableHead>
                            <TableHead className="whitespace-nowrap w-px">
                              {t("proxies.management.syncCol")}
                            </TableHead>
                            <TableHead className="whitespace-nowrap w-px">
                              {t("common.labels.actions")}
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {vpnConfigs.map((vpn) => {
                            const syncDot = getSyncStatusDot(
                              vpn,
                              vpnSyncStatus[vpn.id],
                              t,
                              vpnSyncErrors[vpn.id],
                            );
                            return (
                              <TableRow key={vpn.id}>
                                <TableCell className="font-medium">
                                  <div className="flex items-center gap-2">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div
                                          className={`w-2 h-2 rounded-full shrink-0 ${syncDot.color} ${
                                            syncDot.animate
                                              ? "animate-pulse"
                                              : ""
                                          }`}
                                        />
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>{syncDot.tooltip}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                    {vpn.name}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline">WG</Badge>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="secondary">
                                    {vpnUsage[vpn.id] ?? 0}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="flex items-center">
                                        <Checkbox
                                          checked={vpn.sync_enabled}
                                          onCheckedChange={() =>
                                            void handleToggleVpnSync(vpn)
                                          }
                                          disabled={
                                            isTogglingVpnSync[vpn.id] ||
                                            vpnInUse[vpn.id]
                                          }
                                        />
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {vpnInUse[vpn.id] ? (
                                        <p>
                                          {t(
                                            "vpns.management.syncCannotDisable",
                                          )}
                                        </p>
                                      ) : (
                                        <p>
                                          {vpn.sync_enabled
                                            ? t(
                                                "proxies.management.disableSync",
                                              )
                                            : t(
                                                "proxies.management.enableSync",
                                              )}
                                        </p>
                                      )}
                                    </TooltipContent>
                                  </Tooltip>
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-1">
                                    <VpnCheckButton
                                      vpnId={vpn.id}
                                      vpnName={vpn.name}
                                      checkingVpnId={checkingVpnId}
                                      setCheckingVpnId={setCheckingVpnId}
                                    />
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => {
                                            handleEditVpn(vpn);
                                          }}
                                        >
                                          <LuPencil className="w-4 h-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>{t("vpns.management.editVpn")}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                              handleDeleteVpn(vpn);
                                            }}
                                            disabled={
                                              (vpnUsage[vpn.id] ?? 0) > 0
                                            }
                                          >
                                            <LuTrash2 className="w-4 h-4" />
                                          </Button>
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {(vpnUsage[vpn.id] ?? 0) > 0 ? (
                                          <p>
                                            {(vpnUsage[vpn.id] ?? 0) === 1
                                              ? t(
                                                  "vpns.management.cannotDelete_one",
                                                  { count: vpnUsage[vpn.id] },
                                                )
                                              : t(
                                                  "vpns.management.cannotDelete_other",
                                                  { count: vpnUsage[vpn.id] },
                                                )}
                                          </p>
                                        ) : (
                                          <p>
                                            {t("vpns.management.deleteVpn")}
                                          </p>
                                        )}
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="subscriptions" className="mt-4">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <RippleButton
                      size="sm"
                      onClick={() => setShowSubAddForm(!showSubAddForm)}
                    >
                      <LuPlus className="mr-1 h-4 w-4" />
                      {t("subscriptionPool.addSubscription")}
                    </RippleButton>
                  </div>

                  {showSubAddForm && (
                    <div className="space-y-3 rounded-lg border p-4">
                      <div className="space-y-2">
                        <Label>{t("subscriptionPool.subscriptionName")}</Label>
                        <Input
                          placeholder={t("subscriptionPool.namePlaceholder")}
                          value={newSubName}
                          onChange={(e) => setNewSubName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t("subscriptionPool.subscriptionUrl")}</Label>
                        <Input
                          placeholder={t(
                            "subscriptionPool.subscriptionUrlPlaceholder",
                          )}
                          value={newSubUrl}
                          onChange={(e) => setNewSubUrl(e.target.value)}
                        />
                      </div>
                      <div className="flex gap-2">
                        <RippleButton
                          size="sm"
                          onClick={handleAddSubscription}
                          disabled={
                            isAddingSub ||
                            !newSubName.trim() ||
                            !newSubUrl.trim()
                          }
                        >
                          {isAddingSub
                            ? t("subscriptionPool.testing")
                            : t("subscriptionPool.addSubscription")}
                        </RippleButton>
                        <RippleButton
                          size="sm"
                          variant="ghost"
                          onClick={() => setShowSubAddForm(false)}
                        >
                          {t("common.buttons.cancel")}
                        </RippleButton>
                      </div>
                    </div>
                  )}

                  {subscriptions.length > 0 && (
                    <div className="space-y-3">
                      {subscriptions.map((sub) => (
                        <div
                          key={sub.id}
                          className="flex items-center justify-between rounded-lg border p-3"
                        >
                          <div className="space-y-0.5 min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm truncate">
                                {sub.name}
                              </span>
                              <Badge variant="secondary" className="shrink-0">
                                {t("subscriptionPool.nodeCount", {
                                  count: sub.node_count,
                                })}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t("subscriptionPool.lastUpdated", {
                                time: new Date(
                                  sub.updated_at * 1000,
                                ).toLocaleString(),
                              })}
                            </div>
                            {sub.last_fetch_error && (
                              <div className="text-xs text-destructive">
                                {t("subscriptionPool.fetchError", {
                                  error: sub.last_fetch_error,
                                })}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => handleImportAllNodes(sub.id)}
                                  disabled={importingAllSubId === sub.id}
                                >
                                  <LuDownload className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t("subscriptionPool.importAll")}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => handleTestAllNodes(sub.id)}
                                  disabled={testingAllSubId === sub.id}
                                >
                                  <LuSignal
                                    className={`h-4 w-4 ${testingAllSubId === sub.id ? "animate-pulse" : ""}`}
                                  />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t("subscriptionPool.testAll")}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() =>
                                    handleRefreshSubscription(sub.id)
                                  }
                                  disabled={refreshingSubId === sub.id}
                                >
                                  <LuRefreshCw
                                    className={`h-4 w-4 ${refreshingSubId === sub.id ? "animate-spin" : ""}`}
                                  />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t("subscriptionPool.refresh")}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => {
                                    setSelectedSubFilter(
                                      selectedSubFilter === sub.id
                                        ? null
                                        : sub.id,
                                    );
                                  }}
                                >
                                  <LuList
                                    className={`h-4 w-4 ${selectedSubFilter === sub.id ? "text-primary" : ""}`}
                                  />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t("subscriptionPool.nodes")}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive"
                                  onClick={() =>
                                    handleDeleteSubscription(sub.id)
                                  }
                                >
                                  <LuTrash2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t("subscriptionPool.delete")}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {subscriptions.length === 0 && !showSubAddForm && (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      {t("subscriptionPool.noSubscriptions")}
                    </div>
                  )}

                  {filteredPoolNodes.length > 0 && (
                    <div>
                      {subscriptions.length > 1 && (
                        <div className="flex items-center gap-2 flex-wrap mb-3">
                          <Button
                            variant={
                              selectedSubFilter === null ? "default" : "outline"
                            }
                            size="sm"
                            onClick={() => setSelectedSubFilter(null)}
                          >
                            {t("subscriptionPool.allNodes")}
                          </Button>
                          {subscriptions.map((sub) => (
                            <Button
                              key={sub.id}
                              variant={
                                selectedSubFilter === sub.id
                                  ? "default"
                                  : "outline"
                              }
                              size="sm"
                              onClick={() => setSelectedSubFilter(sub.id)}
                            >
                              {sub.name}
                            </Button>
                          ))}
                        </div>
                      )}

                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>
                              {t("subscriptionPool.protocol")}
                            </TableHead>
                            <TableHead>
                              {t("subscriptionPool.server")}
                            </TableHead>
                            <TableHead>
                              {t("subscriptionPool.status")}
                            </TableHead>
                            <TableHead>
                              {t("subscriptionPool.latency")}
                            </TableHead>
                            <TableHead className="text-right">
                              {t("subscriptionPool.actions")}
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredPoolNodes.map((node) => {
                            const isImportable = isNodeImportable(node);
                            const needsGw = nodeNeedsGateway(node);
                            const isImported = !!node.stored_proxy_id;

                            return (
                              <TableRow key={node.id}>
                                <TableCell>
                                  <Badge
                                    variant={
                                      isImportable ? "default" : "secondary"
                                    }
                                  >
                                    {node.protocol.toUpperCase()}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="cursor-default text-sm">
                                        {node.name}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {node.server}:{node.port}
                                    </TooltipContent>
                                  </Tooltip>
                                </TableCell>
                                <TableCell>
                                  {isImported ? (
                                    <Badge
                                      variant="outline"
                                      className="border-success text-success"
                                    >
                                      {t("subscriptionPool.imported")}
                                    </Badge>
                                  ) : isImportable ? (
                                    <Badge variant="outline">
                                      {t("subscriptionPool.supported")}
                                    </Badge>
                                  ) : needsGw ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge
                                          variant="outline"
                                          className="bg-warning/10 text-warning-foreground border-warning/50"
                                        >
                                          {t(
                                            "subscriptionPool.gatewayRequired",
                                          )}
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {t("subscriptionPool.requiresGateway")}
                                      </TooltipContent>
                                    </Tooltip>
                                  ) : (
                                    <Badge
                                      variant="outline"
                                      className="bg-destructive/10 text-destructive-foreground border-destructive/50"
                                    >
                                      {t("subscriptionPool.unsupported")}
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {node.last_latency_ms != null
                                    ? t("subscriptionPool.latencyMs", {
                                        ms: node.last_latency_ms,
                                      })
                                    : "-"}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    {isImportable && !isImported && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                          handleImportNode(node.id)
                                        }
                                        disabled={importingNodeId === node.id}
                                      >
                                        <LuDownload className="mr-1 h-3 w-3" />
                                        {t("subscriptionPool.importNode")}
                                      </Button>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        handleTestNodeLatency(node.id)
                                      }
                                      disabled={testingNodeId === node.id}
                                    >
                                      <LuSignal className="mr-1 h-3 w-3" />
                                      {testingNodeId === node.id
                                        ? t("subscriptionPool.testing")
                                        : t("subscriptionPool.testLatency")}
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </ScrollArea>

          <DialogFooter>
            <RippleButton variant="outline" onClick={onClose}>
              {t("common.buttons.close")}
            </RippleButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProxyFormDialog
        isOpen={showProxyForm}
        onClose={handleProxyFormClose}
        editingProxy={editingProxy}
      />
      <DeleteConfirmationDialog
        isOpen={proxyToDelete !== null}
        onClose={() => {
          setProxyToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
        title={t("proxies.management.deleteTitle")}
        description={t("proxies.management.deleteDescription", {
          name: proxyToDelete?.name ?? "",
        })}
        confirmButtonText={t("common.buttons.delete")}
        isLoading={isDeleting}
      />
      <DeleteConfirmationDialog
        isOpen={showBatchDeleteConfirm}
        onClose={() => {
          setShowBatchDeleteConfirm(false);
        }}
        onConfirm={handleBatchDelete}
        title={t("proxies.management.batchDelete")}
        description={t("proxies.management.batchDeleteConfirm", {
          count: selectedProxyIds.size,
        })}
        confirmButtonText={t("common.buttons.delete")}
        isLoading={isBatchDeleting}
      />
      <ProxyImportDialog
        isOpen={showImportDialog}
        onClose={() => {
          setShowImportDialog(false);
        }}
      />
      <ProxyExportDialog
        isOpen={showExportDialog}
        onClose={() => {
          setShowExportDialog(false);
        }}
      />
      <VpnFormDialog
        isOpen={showVpnForm}
        onClose={handleVpnFormClose}
        editingVpn={editingVpn}
      />
      <DeleteConfirmationDialog
        isOpen={vpnToDelete !== null}
        onClose={() => {
          setVpnToDelete(null);
        }}
        onConfirm={handleConfirmDeleteVpn}
        title={t("vpns.management.deleteTitle")}
        description={t("vpns.management.deleteDescription", {
          name: vpnToDelete?.name ?? "",
        })}
        confirmButtonText={t("common.buttons.delete")}
        isLoading={isDeletingVpn}
      />
      <VpnImportDialog
        isOpen={showVpnImportDialog}
        onClose={() => {
          setShowVpnImportDialog(false);
        }}
      />
    </>
  );
}
