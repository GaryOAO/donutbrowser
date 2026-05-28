"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { LoadingButton } from "@/components/loading-button";
import { ProxyFormDialog } from "@/components/proxy-form-dialog";
import { ProxySourcePicker } from "@/components/proxy-source-picker";
import { SharedCamoufoxConfigForm } from "@/components/shared-camoufox-config-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WayfernConfigForm } from "@/components/wayfern-config-form";
import { useBrowserDownload } from "@/hooks/use-browser-download";
import { useProxyEvents } from "@/hooks/use-proxy-events";
import { useVpnEvents } from "@/hooks/use-vpn-events";
import { getBrowserIcon } from "@/lib/browser-utils";
import {
  NONE_PROXY_SOURCE,
  type ProxySourceId,
  proxySourceToBackend,
} from "@/lib/proxy-source-id";
import { cn } from "@/lib/utils";
import type {
  BrowserReleaseTypes,
  CamoufoxConfig,
  CamoufoxOS,
  PoolNode,
  ProxyBindingMode,
  ProxySource,
  Subscription,
  WayfernConfig,
  WayfernOS,
} from "@/types";
import { RippleButton } from "./ui/ripple";

const getCurrentOS = (): CamoufoxOS => {
  if (typeof navigator === "undefined") return "linux";
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "macos";
  return "linux";
};

type BrowserTypeString = "camoufox" | "wayfern";

export interface CreateProfilePayload {
  name: string;
  browserStr: BrowserTypeString;
  version: string;
  releaseType: string;
  /** Legacy fields (kept for downstream callers that still expect them). */
  proxyId?: string;
  vpnId?: string;
  /** Typed binding — preferred. Replaces the magic-string vpn-/proxy- shape. */
  proxySource?: ProxySource;
  camoufoxConfig?: CamoufoxConfig;
  wayfernConfig?: WayfernConfig;
  groupId?: string;
  extensionGroupId?: string;
  ephemeral?: boolean;
  dnsBlocklist?: string;
  launchHook?: string;
  proxyBindingMode?: ProxyBindingMode;
}

interface CreateProfileDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateProfile: (profileData: CreateProfilePayload) => Promise<void>;
  selectedGroupId?: string;
  crossOsUnlocked?: boolean;
}

const BROWSER_OPTIONS: { value: BrowserTypeString; labelKey: string }[] = [
  { value: "wayfern", labelKey: "createProfile.chromiumLabel" },
  { value: "camoufox", labelKey: "createProfile.firefoxLabel" },
];

const DEFAULT_CAMOUFOX_CONFIG = (): CamoufoxConfig => ({
  geoip: true,
  os: getCurrentOS(),
});

const DEFAULT_WAYFERN_CONFIG = (): WayfernConfig => ({
  os: getCurrentOS() as WayfernOS,
});

export function CreateProfileDialog({
  isOpen,
  onClose,
  onCreateProfile,
  selectedGroupId,
  crossOsUnlocked = false,
}: CreateProfileDialogProps) {
  const { t } = useTranslation();

  // -- Core (always-visible) state --
  const [profileName, setProfileName] = useState("");
  const [browser, setBrowser] = useState<BrowserTypeString>("wayfern");
  const [proxySource, setProxySource] =
    useState<ProxySourceId>(NONE_PROXY_SOURCE);

  // -- Advanced (collapsible) state --
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [ephemeral, setEphemeral] = useState(false);
  const [dnsBlocklist, setDnsBlocklist] = useState<string>("");
  const [launchHook, setLaunchHook] = useState("");
  const [proxyBindingMode, setProxyBindingMode] =
    useState<ProxyBindingMode>("fixed_node");
  const [selectedExtensionGroupId, setSelectedExtensionGroupId] =
    useState<string>();
  const [camoufoxConfig, setCamoufoxConfig] = useState<CamoufoxConfig>(
    DEFAULT_CAMOUFOX_CONFIG,
  );
  const [wayfernConfig, setWayfernConfig] = useState<WayfernConfig>(
    DEFAULT_WAYFERN_CONFIG,
  );

  // -- Inline proxy form state --
  const [showInlineProxyForm, setShowInlineProxyForm] = useState(false);

  // -- Network / proxy lookup data --
  const { storedProxies } = useProxyEvents();
  const { vpnConfigs } = useVpnEvents();
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

  // -- Browser / version state --
  const [supportedBrowsers, setSupportedBrowsers] = useState<string[]>([]);
  const [releaseTypes, setReleaseTypes] = useState<BrowserReleaseTypes>();
  const [isLoadingReleaseTypes, setIsLoadingReleaseTypes] = useState(false);
  const [releaseTypesError, setReleaseTypesError] = useState<string | null>(
    null,
  );
  const loadingBrowserRef = useRef<string | null>(null);

  const {
    isBrowserDownloading,
    downloadBrowser,
    loadDownloadedVersions,
    isVersionDownloaded,
    downloadedVersionsMap,
  } = useBrowserDownload();

  // -- Extension groups --
  const [extensionGroups, setExtensionGroups] = useState<
    { id: string; name: string; extension_ids: string[] }[]
  >([]);

  // -- Profile counter for default name --
  const [suggestedName, setSuggestedName] = useState("");
  const loadSuggestedName = useCallback(async () => {
    try {
      const profiles = await invoke<{ name: string }[]>(
        "list_browser_profiles",
      );
      let counter = profiles.length + 1;
      const taken = new Set(profiles.map((p) => p.name.toLowerCase()));
      let candidate = t("createProfile.suggestedName", { counter });
      while (taken.has(candidate.toLowerCase())) {
        counter += 1;
        candidate = t("createProfile.suggestedName", { counter });
      }
      setSuggestedName(candidate);
    } catch (err) {
      console.error("Failed to compute suggested profile name:", err);
      setSuggestedName("");
    }
  }, [t]);

  const [isCreating, setIsCreating] = useState(false);

  const loadSupportedBrowsers = useCallback(async () => {
    try {
      const browsers = await invoke<string[]>("get_supported_browsers");
      setSupportedBrowsers(browsers);
    } catch (error) {
      console.error("Failed to load supported browsers:", error);
    }
  }, []);

  const checkAndDownloadGeoIPDatabase = useCallback(async () => {
    try {
      const isAvailable = await invoke<boolean>("is_geoip_database_available");
      if (!isAvailable) {
        await invoke("download_geoip_database");
      }
    } catch (error) {
      console.error("Failed to check/download GeoIP database:", error);
    }
  }, []);

  const loadReleaseTypes = useCallback(
    async (browserStr: string) => {
      loadingBrowserRef.current = browserStr;
      setIsLoadingReleaseTypes(true);
      setReleaseTypesError(null);

      try {
        const rawReleaseTypes = await invoke<BrowserReleaseTypes>(
          "get_browser_release_types",
          { browserStr },
        );
        await loadDownloadedVersions(browserStr);
        if (loadingBrowserRef.current === browserStr) {
          const filtered: BrowserReleaseTypes = {};
          if (rawReleaseTypes.stable) filtered.stable = rawReleaseTypes.stable;
          setReleaseTypes(filtered);
          setReleaseTypesError(null);
        }
      } catch (error) {
        console.error(`Failed to load release types for ${browserStr}:`, error);
        try {
          const downloaded = await loadDownloadedVersions(browserStr);
          if (
            loadingBrowserRef.current === browserStr &&
            downloaded.length > 0
          ) {
            const latest = downloaded[0];
            const fallback: BrowserReleaseTypes = { stable: latest };
            setReleaseTypes(fallback);
            setReleaseTypesError(null);
          } else if (loadingBrowserRef.current === browserStr) {
            setReleaseTypesError(t("createProfile.version.fetchError"));
          }
        } catch (e) {
          console.error(
            `Failed to load downloaded versions for ${browserStr}:`,
            e,
          );
          if (loadingBrowserRef.current === browserStr) {
            setReleaseTypesError(t("createProfile.version.fetchError"));
          }
        }
      } finally {
        if (loadingBrowserRef.current === browserStr) {
          loadingBrowserRef.current = null;
          setIsLoadingReleaseTypes(false);
        }
      }
    },
    [loadDownloadedVersions, t],
  );

  // -- Data loading effects --
  useEffect(() => {
    if (!isOpen) return;
    void loadSupportedBrowsers();
    void loadSubscriptionData();
    void loadSuggestedName();
    void invoke<{ id: string; name: string; extension_ids: string[] }[]>(
      "list_extension_groups",
    )
      .then(setExtensionGroups)
      .catch(() => setExtensionGroups([]));
    void checkAndDownloadGeoIPDatabase();
    // Subscriptions/nodes may change mid-dialog if user opens proxy mgmt
    const unlistenPromise = Promise.all([
      listen("subscriptions-changed", () => {
        void loadSubscriptionData();
      }),
      listen("pool-nodes-changed", () => {
        void loadSubscriptionData();
      }),
    ]);
    return () => {
      void unlistenPromise.then((unlisteners) => {
        for (const u of unlisteners) u();
      });
    };
  }, [
    isOpen,
    loadSupportedBrowsers,
    loadSubscriptionData,
    loadSuggestedName,
    checkAndDownloadGeoIPDatabase,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    loadingBrowserRef.current = null;
    setReleaseTypes({});
    void loadReleaseTypes(browser);
  }, [isOpen, browser, loadReleaseTypes]);

  const getBestAvailableVersion = useCallback(() => {
    if (!releaseTypes) return null;
    if (releaseTypes.stable) {
      return { version: releaseTypes.stable, releaseType: "stable" as const };
    }
    return null;
  }, [releaseTypes]);

  const getCreatableVersion = useCallback(() => {
    const bestVersion = getBestAvailableVersion();
    if (bestVersion && isVersionDownloaded(bestVersion.version)) {
      return bestVersion;
    }
    const browserDownloaded = downloadedVersionsMap[browser] ?? [];
    if (browserDownloaded.length > 0) {
      return { version: browserDownloaded[0], releaseType: "stable" as const };
    }
    // For Step 5: don't gate creation on download. Fall back to the best
    // known version even if not yet on disk — the launcher will prepare it.
    return bestVersion;
  }, [
    browser,
    getBestAvailableVersion,
    isVersionDownloaded,
    downloadedVersionsMap,
  ]);

  const handleManualDownload = async () => {
    const bestVersion = getBestAvailableVersion();
    if (!bestVersion) return;
    try {
      await downloadBrowser(browser, bestVersion.version);
    } catch (error) {
      console.error("Failed to download browser:", error);
    }
  };

  const resetState = useCallback(() => {
    loadingBrowserRef.current = null;
    setProfileName("");
    setBrowser("wayfern");
    setProxySource(NONE_PROXY_SOURCE);
    setAdvancedOpen(false);
    setEphemeral(false);
    setDnsBlocklist("");
    setLaunchHook("");
    setProxyBindingMode("fixed_node");
    setSelectedExtensionGroupId(undefined);
    setCamoufoxConfig(DEFAULT_CAMOUFOX_CONFIG());
    setWayfernConfig(DEFAULT_WAYFERN_CONFIG());
    setShowInlineProxyForm(false);
    setReleaseTypes({});
    setIsLoadingReleaseTypes(false);
    setReleaseTypesError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const isProxySelected = proxySource.kind !== "none";
  const isVpnSelected = proxySource.kind === "vpn";
  const effectiveBindingMode: ProxyBindingMode = isVpnSelected
    ? "fixed_node"
    : proxyBindingMode;

  const effectiveName = (profileName.trim() || suggestedName).trim();
  const isCreateDisabled =
    !effectiveName || !browser || isBrowserDownloading(browser);

  const handleCreate = async () => {
    const name = effectiveName;
    if (!name) return;

    const version = getCreatableVersion();
    if (!version) {
      console.error("No version available for", browser);
      return;
    }

    setIsCreating(true);
    const {
      proxyId,
      vpnId,
      proxySource: backendSource,
    } = proxySourceToBackend(proxySource);

    try {
      const payload: CreateProfilePayload = {
        name,
        browserStr: browser,
        version: version.version,
        releaseType: version.releaseType,
        proxyId: proxyId ?? undefined,
        vpnId: vpnId ?? undefined,
        proxySource: backendSource ?? undefined,
        groupId: selectedGroupId !== "default" ? selectedGroupId : undefined,
        extensionGroupId: selectedExtensionGroupId,
        ephemeral,
        dnsBlocklist: dnsBlocklist || undefined,
        launchHook: launchHook.trim() || undefined,
        proxyBindingMode: effectiveBindingMode,
      };

      if (browser === "wayfern") {
        payload.wayfernConfig = { ...wayfernConfig };
      } else {
        payload.camoufoxConfig = { ...camoufoxConfig };
      }

      await onCreateProfile(payload);
      handleClose();
    } catch (error) {
      console.error("Failed to create profile:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const updateCamoufoxConfig = (key: keyof CamoufoxConfig, value: unknown) => {
    setCamoufoxConfig((prev) => ({ ...prev, [key]: value }));
  };

  const updateWayfernConfig = (key: keyof WayfernConfig, value: unknown) => {
    setWayfernConfig((prev) => ({ ...prev, [key]: value }));
  };

  const supportedBrowserOptions = useMemo(
    () => BROWSER_OPTIONS.filter((b) => supportedBrowsers.includes(b.value)),
    [supportedBrowsers],
  );

  const bestVersion = getBestAvailableVersion();
  const downloadedNow = bestVersion && isVersionDownloaded(bestVersion.version);
  const isDownloading = isBrowserDownloading(browser);

  const showDownloadHint =
    !isLoadingReleaseTypes &&
    !releaseTypesError &&
    !isDownloading &&
    !downloadedNow &&
    bestVersion !== null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{t("createProfile.title")}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-y-auto">
          <div className="py-4 space-y-5">
            {/* 1. Name + Browser */}
            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <div className="space-y-2">
                <Label htmlFor="profile-name">
                  {t("createProfile.profileName")}
                </Label>
                <Input
                  id="profile-name"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isCreateDisabled && !isCreating) {
                      void handleCreate();
                    }
                  }}
                  placeholder={suggestedName}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-browser">
                  {t("createProfile.browserLabel")}
                </Label>
                <Select
                  value={browser}
                  onValueChange={(v) => setBrowser(v as BrowserTypeString)}
                >
                  <SelectTrigger id="profile-browser" className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {supportedBrowserOptions.map((opt) => {
                      const Icon = getBrowserIcon(opt.value);
                      return (
                        <SelectItem key={opt.value} value={opt.value}>
                          <span className="flex items-center gap-2">
                            {Icon && <Icon className="w-4 h-4" />}
                            {t(opt.labelKey)}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Browser version hints (download/preparing) */}
            {isLoadingReleaseTypes && (
              <div className="flex gap-3 items-center p-3 rounded-md border">
                <div className="w-4 h-4 rounded-full border-2 animate-spin border-muted/40 border-t-primary" />
                <p className="text-sm text-muted-foreground">
                  {t("createProfile.version.fetching")}
                </p>
              </div>
            )}
            {!isLoadingReleaseTypes && releaseTypesError && (
              <div className="flex gap-3 items-center p-3 rounded-md border border-destructive/50 bg-destructive/10">
                <p className="flex-1 text-sm text-destructive">
                  {releaseTypesError}
                </p>
                <RippleButton
                  onClick={() => loadReleaseTypes(browser)}
                  size="sm"
                  variant="outline"
                >
                  {t("common.buttons.retry")}
                </RippleButton>
              </div>
            )}
            {showDownloadHint && bestVersion && (
              <div className="flex gap-3 items-center p-3 rounded-md border">
                <p className="flex-1 text-sm text-muted-foreground">
                  {t("createProfile.version.preparing", {
                    version: bestVersion.version,
                  })}
                </p>
                <LoadingButton
                  onClick={() => void handleManualDownload()}
                  isLoading={isDownloading}
                  size="sm"
                  disabled={isDownloading}
                >
                  {t("common.buttons.download")}
                </LoadingButton>
              </div>
            )}
            {isDownloading && (
              <div className="p-3 text-sm rounded-md border text-muted-foreground">
                {t("createProfile.version.downloading", {
                  browser: t(
                    browser === "wayfern"
                      ? "createProfile.chromiumLabel"
                      : "createProfile.firefoxLabel",
                  ),
                  version: bestVersion?.version ?? "",
                })}
              </div>
            )}

            {/* 2. Proxy / network source */}
            <div className="space-y-2">
              <Label>{t("createProfile.networkSource.title")}</Label>
              <ProxySourcePicker
                value={proxySource}
                onChange={setProxySource}
                storedProxies={storedProxies}
                vpnConfigs={vpnConfigs}
                subscriptions={subscriptions}
                poolNodes={poolNodes}
                disabled={isCreating}
                onCreateNewProxy={() => setShowInlineProxyForm(true)}
              />
              <p className="text-xs text-muted-foreground">
                {t("createProfile.networkSource.description")}
              </p>
            </div>

            {/* 3. Advanced disclosure */}
            <div className="border rounded-md">
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-accent/50 transition-colors"
              >
                <span className="flex items-center gap-2">
                  {advancedOpen ? (
                    <LuChevronDown className="w-4 h-4" />
                  ) : (
                    <LuChevronRight className="w-4 h-4" />
                  )}
                  {advancedOpen
                    ? t("createProfile.advanced.hide")
                    : t("createProfile.advanced.show")}
                </span>
              </button>
              {advancedOpen && (
                <div
                  className={cn("px-3 py-3 border-t space-y-4", "bg-muted/20")}
                >
                  {/* Ephemeral */}
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="adv-ephemeral"
                        checked={ephemeral}
                        onCheckedChange={(checked) =>
                          setEphemeral(checked === true)
                        }
                      />
                      <Label htmlFor="adv-ephemeral" className="font-medium">
                        {t("profiles.ephemeral")}
                      </Label>
                      <span className="px-1 py-0.5 text-[10px] leading-none rounded bg-muted text-muted-foreground font-medium">
                        {t("profiles.ephemeralAlpha")}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground ml-6">
                      {t("profiles.ephemeralDescription")}
                    </p>
                  </div>

                  {/* Proxy binding mode (only when a proxy/sub-node is bound) */}
                  {isProxySelected && !isVpnSelected && (
                    <div className="space-y-2">
                      <Label htmlFor="adv-binding">
                        {t("createProfile.proxy.binding.label")}
                      </Label>
                      <Select
                        value={proxyBindingMode}
                        onValueChange={(v) =>
                          setProxyBindingMode(v as ProxyBindingMode)
                        }
                        disabled={isCreating}
                      >
                        <SelectTrigger id="adv-binding">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fixed_node">
                            {t("createProfile.proxy.binding.fixedNode")}
                          </SelectItem>
                          <SelectItem value="session_random">
                            {t("createProfile.proxy.binding.sessionRandom")}
                          </SelectItem>
                          <SelectItem value="rotate_per_launch">
                            {t("createProfile.proxy.binding.rotatePerLaunch")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* DNS Blocklist */}
                  <div className="space-y-2">
                    <Label>{t("dnsBlocklist.title")}</Label>
                    <Select
                      value={dnsBlocklist || "none"}
                      onValueChange={(val) =>
                        setDnsBlocklist(val === "none" ? "" : val)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("dnsBlocklist.none")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">
                          {t("dnsBlocklist.none")}
                        </SelectItem>
                        <SelectItem value="light">
                          {t("dnsBlocklist.light")}
                        </SelectItem>
                        <SelectItem value="normal">
                          {t("dnsBlocklist.normal")}
                        </SelectItem>
                        <SelectItem value="pro">
                          {t("dnsBlocklist.pro")}
                        </SelectItem>
                        <SelectItem value="pro_plus">
                          {t("dnsBlocklist.proPlus")}
                        </SelectItem>
                        <SelectItem value="ultimate">
                          {t("dnsBlocklist.ultimate")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Extension group */}
                  {extensionGroups.length > 0 && (
                    <div className="space-y-2">
                      <Label>{t("extensions.extensionGroup")}</Label>
                      <Select
                        value={selectedExtensionGroupId ?? "none"}
                        onValueChange={(val) =>
                          setSelectedExtensionGroupId(
                            val === "none" ? undefined : val,
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t("profileInfo.values.none")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            {t("profileInfo.values.none")}
                          </SelectItem>
                          {extensionGroups.map((g) => (
                            <SelectItem key={g.id} value={g.id}>
                              {g.name} ({g.extension_ids.length})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Launch hook */}
                  <div className="space-y-2">
                    <Label htmlFor="adv-launch-hook">
                      {t("createProfile.launchHook.label")}
                    </Label>
                    <Input
                      id="adv-launch-hook"
                      value={launchHook}
                      onChange={(e) => setLaunchHook(e.target.value)}
                      placeholder={t("createProfile.launchHook.placeholder")}
                      disabled={isCreating}
                    />
                  </div>

                  {/* Fingerprint OS / fingerprint config (inline, no tabs) */}
                  <div className="space-y-2">
                    <Label>{t("createProfile.advanced.fingerprint")}</Label>
                    {crossOsUnlocked &&
                      ((browser === "camoufox" &&
                        camoufoxConfig.os !== getCurrentOS()) ||
                        (browser === "wayfern" &&
                          (wayfernConfig.os as CamoufoxOS) !==
                            getCurrentOS())) && (
                        <Alert className="border-warning/50 bg-warning/10">
                          <AlertDescription className="text-sm">
                            {t("createProfile.camoufoxWarning")}
                          </AlertDescription>
                        </Alert>
                      )}
                    {browser === "wayfern" ? (
                      <WayfernConfigForm
                        config={wayfernConfig}
                        onConfigChange={updateWayfernConfig}
                        isCreating
                        crossOsUnlocked={crossOsUnlocked}
                        limitedMode={!crossOsUnlocked}
                        profileVersion={bestVersion?.version}
                        profileBrowser="wayfern"
                      />
                    ) : (
                      <SharedCamoufoxConfigForm
                        config={camoufoxConfig}
                        onConfigChange={updateCamoufoxConfig}
                        isCreating
                        browserType="camoufox"
                        crossOsUnlocked={crossOsUnlocked}
                        limitedMode={!crossOsUnlocked}
                        profileVersion={bestVersion?.version}
                        profileBrowser="camoufox"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="flex-shrink-0 pt-4 border-t">
          <RippleButton variant="outline" onClick={handleClose}>
            {t("common.buttons.cancel")}
          </RippleButton>
          <LoadingButton
            onClick={handleCreate}
            isLoading={isCreating}
            disabled={isCreateDisabled}
          >
            {t("common.buttons.create")}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>

      {/* Inline-but-modal proxy form: opens on top of the create dialog when
          the user picks "Create new proxy..." from the picker. After save we
          auto-select the new proxy. */}
      <ProxyFormDialog
        isOpen={showInlineProxyForm}
        onClose={() => setShowInlineProxyForm(false)}
        onProxyCreated={(p) => {
          setProxySource({ kind: "stored", id: p.id });
        }}
      />
    </Dialog>
  );
}
