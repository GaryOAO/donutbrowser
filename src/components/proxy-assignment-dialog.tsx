"use client";

import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LoadingButton } from "@/components/loading-button";
import { ProxySourcePicker } from "@/components/proxy-source-picker";
import { Button } from "@/components/ui/button";
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
  NONE_PROXY_SOURCE,
  type ProxySourceId,
  proxySourceFromProfile,
} from "@/lib/proxy-source-id";
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
  const [value, setValue] = useState<ProxySourceId>(NONE_PROXY_SOURCE);
  const [isAssigning, setIsAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [poolNodes, setPoolNodes] = useState<PoolNode[]>([]);

  const loadSubscriptionData = useCallback(async () => {
    try {
      const [subs, nodes] = await Promise.all([
        invoke<Subscription[]>("list_subscriptions"),
        invoke<PoolNode[]>("list_pool_nodes"),
      ]);
      setSubscriptions(subs);
      setPoolNodes(nodes);
    } catch (err) {
      console.error("Failed to load subscriptions:", err);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    void loadSubscriptionData();
    // Pre-select current binding when assigning to a single profile.
    if (selectedProfiles.length === 1) {
      const profile = profiles.find((p) => p.id === selectedProfiles[0]);
      if (profile) {
        const initial = proxySourceFromProfile(profile);
        // proxySourceFromProfile may produce subscription with empty
        // subscriptionId — patch it from poolNodes once they load.
        setValue(initial);
        return;
      }
    }
    setValue(NONE_PROXY_SOURCE);
  }, [isOpen, profiles, selectedProfiles, loadSubscriptionData]);

  // Fill in subscriptionId for pre-selected subscription bindings once the
  // pool node list is available.
  useEffect(() => {
    if (value.kind !== "subscription" || value.subscriptionId !== "") return;
    const node = poolNodes.find((n) => n.id === value.nodeId);
    if (node) {
      setValue({
        kind: "subscription",
        subscriptionId: node.subscription_id,
        nodeId: node.id,
      });
    }
  }, [value, poolNodes]);

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
        switch (value.kind) {
          case "vpn":
            await invoke("update_profile_vpn", {
              profileId,
              vpnId: value.id,
            });
            break;
          case "subscription": {
            const proxySource: ProxySource = {
              type: "SubscriptionNode",
              id: value.nodeId,
            };
            await invoke("set_profile_proxy_source", {
              profileId,
              proxySource,
            });
            break;
          }
          case "stored": {
            const proxySource: ProxySource = {
              type: "StoredProxy",
              id: value.id,
            };
            await invoke("set_profile_proxy_source", {
              profileId,
              proxySource,
            });
            break;
          }
          case "none":
            await invoke("set_profile_proxy_source", {
              profileId,
              proxySource: null,
            });
            // Also clear any VPN binding.
            await invoke("update_profile_vpn", { profileId, vpnId: null });
            break;
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
  }, [selectedProfiles, value, profiles, onAssignmentComplete, onClose, t]);

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

          <div className="space-y-2">
            <Label htmlFor="proxy-source-picker">
              {t("proxyAssignment.assignProxyVpnLabel")}
            </Label>
            <ProxySourcePicker
              value={value}
              onChange={setValue}
              storedProxies={storedProxies}
              vpnConfigs={vpnConfigs}
              subscriptions={subscriptions}
              poolNodes={poolNodes}
              disabled={isAssigning}
            />
          </div>

          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setValue(NONE_PROXY_SOURCE)}
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
