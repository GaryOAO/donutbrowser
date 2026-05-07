"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LuDownload,
  LuPlus,
  LuRefreshCw,
  LuSignal,
  LuTrash2,
} from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import type { PoolNode, Subscription } from "@/types";

interface SubscriptionPoolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NATIVELY_SUPPORTED = new Set(["http", "https", "socks5", "socks4", "ss"]);

export function SubscriptionPoolDialog({
  open,
  onOpenChange,
}: SubscriptionPoolDialogProps) {
  const { t } = useTranslation();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [nodes, setNodes] = useState<PoolNode[]>([]);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [testingNodeId, setTestingNodeId] = useState<string | null>(null);
  const [importingNodeId, setImportingNodeId] = useState<string | null>(null);
  const [importingAllId, setImportingAllId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [subs, allNodes] = await Promise.all([
        invoke<Subscription[]>("list_subscriptions"),
        invoke<PoolNode[]>("list_pool_nodes", { subscriptionId: null }),
      ]);
      setSubscriptions(subs);
      setNodes(allNodes);
    } catch {
      // Ignore load errors on initial mount
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open, loadData]);

  useEffect(() => {
    const unlisten = listen("subscription-pool-changed", () => {
      loadData();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadData]);

  const handleAdd = async () => {
    if (!newName.trim() || !newUrl.trim()) return;
    setAdding(true);
    try {
      const sub = await invoke<Subscription>("add_subscription", {
        name: newName.trim(),
        url: newUrl.trim(),
      });
      showSuccessToast(
        t("subscriptionPool.addSuccess", { count: sub.node_count }),
      );
      setNewName("");
      setNewUrl("");
      setShowAddForm(false);
      await loadData();
    } catch (e) {
      showErrorToast(t("subscriptionPool.addError"), {
        description: String(e),
      });
    } finally {
      setAdding(false);
    }
  };

  const handleRefresh = async (subId: string) => {
    setRefreshingId(subId);
    try {
      const sub = await invoke<Subscription>("refresh_subscription", {
        subscriptionId: subId,
      });
      showSuccessToast(
        t("subscriptionPool.refreshSuccess", { count: sub.node_count }),
      );
      await loadData();
    } catch (e) {
      showErrorToast(t("subscriptionPool.refreshError"), {
        description: String(e),
      });
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDelete = async (subId: string) => {
    try {
      await invoke("delete_subscription", { subscriptionId: subId });
      showSuccessToast(t("subscriptionPool.deleteSuccess"));
      if (selectedSubId === subId) {
        setSelectedSubId(null);
      }
      await loadData();
    } catch (e) {
      showErrorToast(t("subscriptionPool.deleteError"), {
        description: String(e),
      });
    }
  };

  const handleImportNode = async (nodeId: string) => {
    setImportingNodeId(nodeId);
    try {
      await invoke("import_pool_node_as_proxy", { nodeId });
      showSuccessToast(t("subscriptionPool.importNodeSuccess"));
      await loadData();
    } catch (e) {
      showErrorToast(t("subscriptionPool.importError"), {
        description: String(e),
      });
    } finally {
      setImportingNodeId(null);
    }
  };

  const handleImportAll = async (subId: string) => {
    setImportingAllId(subId);
    try {
      const ids = await invoke<string[]>("import_all_supported_pool_nodes", {
        subscriptionId: subId,
      });
      showSuccessToast(
        t("subscriptionPool.importSuccess", { count: ids.length }),
      );
      await loadData();
    } catch (e) {
      showErrorToast(t("subscriptionPool.importError"), {
        description: String(e),
      });
    } finally {
      setImportingAllId(null);
    }
  };

  const handleTestLatency = async (nodeId: string) => {
    setTestingNodeId(nodeId);
    try {
      const ms = await invoke<number>("test_pool_node_latency", { nodeId });
      showSuccessToast(t("subscriptionPool.latencyMs", { ms }));
      await loadData();
    } catch (e) {
      showErrorToast(t("subscriptionPool.refreshError"), {
        description: String(e),
      });
    } finally {
      setTestingNodeId(null);
    }
  };

  const filteredNodes = selectedSubId
    ? nodes.filter((n) => n.subscription_id === selectedSubId)
    : nodes;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>{t("subscriptionPool.title")}</DialogTitle>
          <DialogDescription>
            {t("subscriptionPool.description")}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="subscriptions" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="subscriptions">
              {t("subscriptionPool.subscriptions")}
            </TabsTrigger>
            <TabsTrigger value="nodes">
              {t("subscriptionPool.allNodes")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="subscriptions" className="space-y-4">
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddForm(!showAddForm)}
              >
                <LuPlus className="mr-1 h-4 w-4" />
                {t("subscriptionPool.addSubscription")}
              </Button>
            </div>

            {showAddForm && (
              <div className="space-y-3 rounded-lg border p-4">
                <div className="space-y-2">
                  <Label>{t("subscriptionPool.subscriptionName")}</Label>
                  <Input
                    placeholder={t("subscriptionPool.namePlaceholder")}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("subscriptionPool.subscriptionUrl")}</Label>
                  <Input
                    placeholder={t(
                      "subscriptionPool.subscriptionUrlPlaceholder",
                    )}
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleAdd}
                    disabled={adding || !newName.trim() || !newUrl.trim()}
                  >
                    {adding
                      ? t("subscriptionPool.testing")
                      : t("subscriptionPool.addSubscription")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowAddForm(false)}
                  >
                    {t("common.buttons.cancel")}
                  </Button>
                </div>
              </div>
            )}

            {subscriptions.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("subscriptionPool.noSubscriptions")}
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {subscriptions.map((sub) => (
                    <div
                      key={sub.id}
                      className="flex items-center justify-between rounded-lg border p-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{sub.name}</span>
                          <Badge variant="secondary">
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
                      <div className="flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleImportAll(sub.id)}
                              disabled={importingAllId === sub.id}
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
                              onClick={() => handleRefresh(sub.id)}
                              disabled={refreshingId === sub.id}
                            >
                              <LuRefreshCw
                                className={`h-4 w-4 ${refreshingId === sub.id ? "animate-spin" : ""}`}
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
                              onClick={() => {
                                setSelectedSubId(sub.id);
                                const tabsTrigger = document.querySelector(
                                  '[data-value="nodes"]',
                                ) as HTMLElement | null;
                                tabsTrigger?.click();
                              }}
                            >
                              <LuSignal className="h-4 w-4" />
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
                              className="text-destructive"
                              onClick={() => handleDelete(sub.id)}
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
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="nodes" className="space-y-4">
            {subscriptions.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant={selectedSubId === null ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedSubId(null)}
                >
                  {t("subscriptionPool.allNodes")}
                </Button>
                {subscriptions.map((sub) => (
                  <Button
                    key={sub.id}
                    variant={selectedSubId === sub.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedSubId(sub.id)}
                  >
                    {sub.name}
                  </Button>
                ))}
              </div>
            )}

            {filteredNodes.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("subscriptionPool.noNodes")}
              </div>
            ) : (
              <ScrollArea className="h-[450px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("subscriptionPool.protocol")}</TableHead>
                      <TableHead>{t("subscriptionPool.server")}</TableHead>
                      <TableHead>{t("subscriptionPool.port")}</TableHead>
                      <TableHead>{t("subscriptionPool.status")}</TableHead>
                      <TableHead>{t("subscriptionPool.latency")}</TableHead>
                      <TableHead className="text-right">
                        {t("subscriptionPool.actions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredNodes.map((node) => {
                      const isSupported = NATIVELY_SUPPORTED.has(node.protocol);
                      const isImported = !!node.stored_proxy_id;

                      return (
                        <TableRow key={node.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={isSupported ? "default" : "secondary"}
                              >
                                {node.protocol.toUpperCase()}
                              </Badge>
                            </div>
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
                          <TableCell className="text-muted-foreground text-sm">
                            {node.port}
                          </TableCell>
                          <TableCell>
                            {isImported ? (
                              <Badge
                                variant="outline"
                                className="border-success text-success"
                              >
                                {t("subscriptionPool.imported")}
                              </Badge>
                            ) : isSupported ? (
                              <Badge variant="outline">
                                {t("subscriptionPool.supported")}
                              </Badge>
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="outline"
                                    className="border-warning text-warning"
                                  >
                                    {t("subscriptionPool.unsupported")}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t("subscriptionPool.requiresGateway")}
                                </TooltipContent>
                              </Tooltip>
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
                              {isSupported && !isImported && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleImportNode(node.id)}
                                  disabled={importingNodeId === node.id}
                                >
                                  <LuDownload className="mr-1 h-3 w-3" />
                                  {t("subscriptionPool.importNode")}
                                </Button>
                              )}
                              {isSupported && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleTestLatency(node.id)}
                                  disabled={testingNodeId === node.id}
                                >
                                  <LuSignal className="mr-1 h-3 w-3" />
                                  {testingNodeId === node.id
                                    ? t("subscriptionPool.testing")
                                    : t("subscriptionPool.testLatency")}
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
