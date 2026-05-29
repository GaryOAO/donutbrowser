"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrent } from "@tauri-apps/plugin-deep-link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuActivity, LuPlay, LuSquare } from "react-icons/lu";
import { CamoufoxConfigDialog } from "@/components/camoufox-config-dialog";
import { CloneProfileDialog } from "@/components/clone-profile-dialog";
import { CommandPalette } from "@/components/command-palette";
import { CookieCopyDialog } from "@/components/cookie-copy-dialog";
import { CookieManagementDialog } from "@/components/cookie-management-dialog";
import { CreateProfileDialog } from "@/components/create-profile-dialog";
import { DeleteConfirmationDialog } from "@/components/delete-confirmation-dialog";
import { DeviceCodeVerifyDialog } from "@/components/device-code-verify-dialog";
import { ExtensionGroupAssignmentDialog } from "@/components/extension-group-assignment-dialog";
import { ExtensionManagementDialog } from "@/components/extension-management-dialog";
import { GroupAssignmentDialog } from "@/components/group-assignment-dialog";
import { GroupBadges } from "@/components/group-badges";
import { GroupManagementDialog } from "@/components/group-management-dialog";
import HomeHeader from "@/components/home-header";
import { ImportProfileDialog } from "@/components/import-profile-dialog";
import { IntegrationsDialog } from "@/components/integrations-dialog";
import { LaunchOnLoginDialog } from "@/components/launch-on-login-dialog";
import { OperationLogsDialog } from "@/components/operation-logs-dialog";
import { PermissionDialog } from "@/components/permission-dialog";
import { ProfilesDataTable } from "@/components/profile-data-table";
import { ProfileSelectorDialog } from "@/components/profile-selector-dialog";
import { ProfileSyncDialog } from "@/components/profile-sync-dialog";
import { ProxyAssignmentDialog } from "@/components/proxy-assignment-dialog";
import { ProxyManagementDialog } from "@/components/proxy-management-dialog";
import { SettingsDialog } from "@/components/settings-dialog";
import { ShortcutsDialog } from "@/components/shortcuts-dialog";
import { SyncAllDialog } from "@/components/sync-all-dialog";
import { SyncConfigDialog } from "@/components/sync-config-dialog";
import { SyncFollowerDialog } from "@/components/sync-follower-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  WAYFERN_TERMS_DECLINED_KEY,
  WayfernTermsDialog,
} from "@/components/wayfern-terms-dialog";
import { WindowResizeWarningDialog } from "@/components/window-resize-warning-dialog";
import { useAppUpdateNotifications } from "@/hooks/use-app-update-notifications";
import { useCloudAuth } from "@/hooks/use-cloud-auth";
import { useGroupEvents } from "@/hooks/use-group-events";
import type { PermissionType } from "@/hooks/use-permissions";
import { usePermissions } from "@/hooks/use-permissions";
import { useProfileEvents } from "@/hooks/use-profile-events";
import { useProxyEvents } from "@/hooks/use-proxy-events";
import { useSyncSessions } from "@/hooks/use-sync-session";
import { useUpdateNotifications } from "@/hooks/use-update-notifications";
import { useVersionUpdater } from "@/hooks/use-version-updater";
import { useVpnEvents } from "@/hooks/use-vpn-events";
import { useWayfernTerms } from "@/hooks/use-wayfern-terms";
import {
  matchesGroupDigit,
  matchesShortcut,
  SHORTCUTS,
  type ShortcutId,
} from "@/lib/shortcuts";
import {
  dismissToast,
  showErrorToast,
  showSuccessToast,
  showSyncProgressToast,
  showToast,
} from "@/lib/toast-utils";
import type {
  BrowserProfile,
  CamoufoxConfig,
  ProxyBindingMode,
  ProxySource,
  SyncSettings,
  WayfernConfig,
} from "@/types";

type BrowserTypeString = "camoufox" | "wayfern";

interface PendingUrl {
  id: string;
  url: string;
}

type BulkTaskAction = "start" | "stop" | "changeProxy" | "healthCheck";

interface BulkTaskItemResult {
  profileId: string;
  success: boolean;
  retries: number;
  errorCode?: string;
  errorMessage?: string;
  timestamp: number;
  proxyNode?: string;
  log: string;
}

export default function Home() {
  const { t } = useTranslation();
  // Mount global version update listener/toasts
  useVersionUpdater();

  // Use the new profile events hook for centralized profile management
  const {
    profiles,
    runningProfiles,
    isLoading: profilesLoading,
    error: profilesError,
  } = useProfileEvents();

  const {
    groups: groupsData,
    isLoading: groupsLoading,
    error: groupsError,
  } = useGroupEvents();

  const {
    storedProxies,
    isLoading: proxiesLoading,
    error: proxiesError,
  } = useProxyEvents();

  const { vpnConfigs } = useVpnEvents();

  // Synchronizer sessions
  const { getProfileSyncInfo } = useSyncSessions();
  const [syncLeaderProfile, setSyncLeaderProfile] =
    useState<BrowserProfile | null>(null);

  // Wayfern terms and commercial trial hooks
  const {
    termsAccepted,
    isLoading: termsLoading,
    checkTerms,
  } = useWayfernTerms();
  const { user: cloudUser } = useCloudAuth();
  const crossOsUnlocked = true;

  const [selfHostedSyncConfigured, setSelfHostedSyncConfigured] =
    useState(false);

  const checkSelfHostedSync = useCallback(async () => {
    try {
      const settings = await invoke<SyncSettings>("get_sync_settings");
      const hasConfig = Boolean(
        settings.sync_server_url && settings.sync_token,
      );
      setSelfHostedSyncConfigured(hasConfig && !cloudUser);
    } catch {
      setSelfHostedSyncConfigured(false);
    }
  }, [cloudUser]);

  const syncUnlocked = crossOsUnlocked || selfHostedSyncConfigured;

  const [createProfileDialogOpen, setCreateProfileDialogOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [operationLogsOpen, setOperationLogsOpen] = useState(false);
  const [integrationsDialogOpen, setIntegrationsDialogOpen] = useState(false);
  const [importProfileDialogOpen, setImportProfileDialogOpen] = useState(false);
  const [proxyManagementDialogOpen, setProxyManagementDialogOpen] =
    useState(false);
  const [camoufoxConfigDialogOpen, setCamoufoxConfigDialogOpen] =
    useState(false);
  const [groupManagementDialogOpen, setGroupManagementDialogOpen] =
    useState(false);
  const [extensionManagementDialogOpen, setExtensionManagementDialogOpen] =
    useState(false);
  const [groupAssignmentDialogOpen, setGroupAssignmentDialogOpen] =
    useState(false);
  const [
    extensionGroupAssignmentDialogOpen,
    setExtensionGroupAssignmentDialogOpen,
  ] = useState(false);
  const [
    selectedProfilesForExtensionGroup,
    setSelectedProfilesForExtensionGroup,
  ] = useState<string[]>([]);
  const [proxyAssignmentDialogOpen, setProxyAssignmentDialogOpen] =
    useState(false);
  const [cookieCopyDialogOpen, setCookieCopyDialogOpen] = useState(false);
  const [cookieManagementDialogOpen, setCookieManagementDialogOpen] =
    useState(false);
  const [
    currentProfileForCookieManagement,
    setCurrentProfileForCookieManagement,
  ] = useState<BrowserProfile | null>(null);
  const [selectedProfilesForCookies, setSelectedProfilesForCookies] = useState<
    string[]
  >([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("default");
  const [selectedProfilesForGroup, setSelectedProfilesForGroup] = useState<
    string[]
  >([]);
  const [selectedProfilesForProxy, setSelectedProfilesForProxy] = useState<
    string[]
  >([]);
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [pendingUrls, setPendingUrls] = useState<PendingUrl[]>([]);
  const [currentProfileForCamoufoxConfig, setCurrentProfileForCamoufoxConfig] =
    useState<BrowserProfile | null>(null);
  const [cloneProfile, setCloneProfile] = useState<BrowserProfile | null>(null);
  const [hasCheckedStartupPrompt, setHasCheckedStartupPrompt] = useState(false);
  const [launchOnLoginDialogOpen, setLaunchOnLoginDialogOpen] = useState(false);
  const [windowResizeWarningOpen, setWindowResizeWarningOpen] = useState(false);
  const [windowResizeWarningBrowserType, setWindowResizeWarningBrowserType] =
    useState<string | undefined>(undefined);
  const windowResizeWarningResolver = useRef<
    ((proceed: boolean) => void) | null
  >(null);
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);
  const [currentPermissionType, setCurrentPermissionType] =
    useState<PermissionType>("microphone");
  const [showBulkDeleteConfirmation, setShowBulkDeleteConfirmation] =
    useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [syncConfigDialogOpen, setSyncConfigDialogOpen] = useState(false);
  const [bulkTaskResults, setBulkTaskResults] = useState<BulkTaskItemResult[]>(
    [],
  );
  const [isBulkTaskRunning, setIsBulkTaskRunning] = useState(false);
  const [bulkTaskProgress, setBulkTaskProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const bulkTaskIdRef = useRef<string | null>(null);
  const [deviceCodeDialogOpen, setDeviceCodeDialogOpen] = useState(false);
  const [syncAllDialogOpen, setSyncAllDialogOpen] = useState(false);
  const [profileSyncDialogOpen, setProfileSyncDialogOpen] = useState(false);
  const [currentProfileForSync, setCurrentProfileForSync] =
    useState<BrowserProfile | null>(null);
  const { isMicrophoneAccessGranted, isCameraAccessGranted, isInitialized } =
    usePermissions();

  const handleSelectGroup = useCallback((groupId: string) => {
    setSelectedGroupId(groupId);
    setSelectedProfiles([]);
  }, []);

  // Ordered group targets consumed by the command palette and shortcuts dialog
  // for Mod+1..9 jump-to-group bindings. "default" is the catch-all view.
  const groupTargets = useMemo(
    () => [
      { id: "default", name: t("groups.defaultGroup") },
      ...groupsData.map((g) => ({ id: g.id, name: g.name })),
    ],
    [groupsData, t],
  );

  // Map a declarative shortcut id onto the fork's dialog-based navigation.
  const runShortcut = useCallback((id: ShortcutId) => {
    switch (id) {
      case "openPalette":
        setCommandPaletteOpen((prev) => !prev);
        break;
      case "openShortcuts":
        setShortcutsDialogOpen((prev) => !prev);
        break;
      case "importProfile":
        setImportProfileDialogOpen(true);
        break;
      case "goProfiles":
        setSelectedGroupId("default");
        setSelectedProfiles([]);
        break;
      case "goProxies":
        setProxyManagementDialogOpen(true);
        break;
      case "goExtensions":
        setExtensionManagementDialogOpen(true);
        break;
      case "goGroups":
        setGroupManagementDialogOpen(true);
        break;
      case "goIntegrations":
        setIntegrationsDialogOpen(true);
        break;
      case "goSettings":
        setSettingsDialogOpen(true);
        break;
    }
  }, []);

  // Check for missing binaries and offer to download them
  const checkMissingBinaries = useCallback(async () => {
    try {
      const missingBinaries = await invoke<[string, string, string][]>(
        "check_missing_binaries",
      );

      // Also check for missing GeoIP database
      const missingGeoIP = await invoke<boolean>(
        "check_missing_geoip_database",
      );

      if (missingBinaries.length > 0 || missingGeoIP) {
        if (missingBinaries.length > 0) {
          console.log("Found missing binaries:", missingBinaries);
        }
        if (missingGeoIP) {
          console.log("Found missing GeoIP database for Camoufox");
        }

        // Group missing binaries by browser type to avoid concurrent downloads
        const browserMap = new Map<string, string[]>();
        for (const [profileName, browser, version] of missingBinaries) {
          if (!browserMap.has(browser)) {
            browserMap.set(browser, []);
          }
          const versions = browserMap.get(browser);
          if (versions) {
            versions.push(`${version} (for ${profileName})`);
          }
        }

        // Show a toast notification about missing binaries and auto-download them
        let missingList = Array.from(browserMap.entries())
          .map(([browser, versions]) => `${browser}: ${versions.join(", ")}`)
          .join(", ");

        if (missingGeoIP) {
          if (missingList) {
            missingList += ", GeoIP database for Camoufox";
          } else {
            missingList = "GeoIP database for Camoufox";
          }
        }

        console.log(`Downloading missing components: ${missingList}`);

        try {
          // Download missing binaries and GeoIP database sequentially to prevent conflicts
          const downloaded = await invoke<string[]>(
            "ensure_all_binaries_exist",
          );
          if (downloaded.length > 0) {
            console.log(
              "Successfully downloaded missing components:",
              downloaded,
            );
          }
        } catch (downloadError) {
          console.error(
            "Failed to download missing components:",
            downloadError,
          );
        }
      }
    } catch (err: unknown) {
      console.error("Failed to check missing components:", err);
    }
  }, []);

  const processingUrlsRef = useRef<Set<string>>(new Set());

  const handleUrlOpen = useCallback((url: string) => {
    // Prevent duplicate processing of the same URL
    if (processingUrlsRef.current.has(url)) {
      console.log("URL already being processed:", url);
      return;
    }

    processingUrlsRef.current.add(url);

    try {
      console.log("URL received for opening:", url);

      // Always show profile selector for manual selection - never auto-open
      // Replace any existing pending URL with the new one
      setPendingUrls([{ id: Date.now().toString(), url }]);
    } finally {
      // Remove URL from processing set after a short delay to prevent rapid duplicates
      setTimeout(() => {
        processingUrlsRef.current.delete(url);
      }, 1000);
    }
  }, []);

  // Auto-update functionality - use the existing hook for compatibility
  const updateNotifications = useUpdateNotifications();
  const { checkForUpdates, isUpdating } = updateNotifications;

  useAppUpdateNotifications();

  // Check for startup URLs but only process them once
  const [hasCheckedStartupUrl, setHasCheckedStartupUrl] = useState(false);
  const checkCurrentUrl = useCallback(async () => {
    if (hasCheckedStartupUrl) return;

    try {
      const currentUrl = await getCurrent();
      if (currentUrl && currentUrl.length > 0) {
        console.log("Startup URL detected:", currentUrl[0]);
        handleUrlOpen(currentUrl[0]);
      }
    } catch (error) {
      console.error("Failed to check current URL:", error);
    } finally {
      setHasCheckedStartupUrl(true);
    }
  }, [handleUrlOpen, hasCheckedStartupUrl]);

  const checkStartupPrompt = useCallback(async () => {
    // Only check once during app startup to prevent reopening after dismissing notifications
    if (hasCheckedStartupPrompt) return;

    try {
      const shouldShow = await invoke<boolean>(
        "should_show_launch_on_login_prompt",
      );
      if (shouldShow) {
        setLaunchOnLoginDialogOpen(true);
      }
    } catch (error) {
      console.error("Failed to check startup prompt:", error);
    } finally {
      setHasCheckedStartupPrompt(true);
    }
  }, [hasCheckedStartupPrompt]);

  // Handle profile errors from useProfileEvents hook
  useEffect(() => {
    if (profilesError) {
      showErrorToast(profilesError);
    }
  }, [profilesError]);

  // Handle group errors from useGroupEvents hook
  useEffect(() => {
    if (groupsError) {
      showErrorToast(groupsError);
    }
  }, [groupsError]);

  // Handle proxy errors from useProxyEvents hook
  useEffect(() => {
    if (proxiesError) {
      showErrorToast(proxiesError);
    }
  }, [proxiesError]);

  const checkAllPermissions = useCallback(() => {
    try {
      // Wait for permissions to be initialized before checking
      if (!isInitialized) {
        return;
      }

      // Check if any permissions are not granted - prioritize missing permissions
      if (!isMicrophoneAccessGranted) {
        setCurrentPermissionType("microphone");
        setPermissionDialogOpen(true);
      } else if (!isCameraAccessGranted) {
        setCurrentPermissionType("camera");
        setPermissionDialogOpen(true);
      }
    } catch (error) {
      console.error("Failed to check permissions:", error);
    }
  }, [isMicrophoneAccessGranted, isCameraAccessGranted, isInitialized]);

  const checkNextPermission = useCallback(
    (justGranted?: PermissionType) => {
      try {
        // Treat the just-granted permission as already granted even if our
        // own usePermissions instance hasn't observed it yet — it polls on a
        // 5 s cadence and would otherwise leave the dialog stuck on the
        // permission the user just successfully granted.
        const micGranted =
          isMicrophoneAccessGranted || justGranted === "microphone";
        const camGranted = isCameraAccessGranted || justGranted === "camera";

        if (!micGranted) {
          setCurrentPermissionType("microphone");
          setPermissionDialogOpen(true);
        } else if (!camGranted) {
          setCurrentPermissionType("camera");
          setPermissionDialogOpen(true);
        } else {
          setPermissionDialogOpen(false);
        }
      } catch (error) {
        console.error("Failed to check next permission:", error);
      }
    },
    [isMicrophoneAccessGranted, isCameraAccessGranted],
  );

  const listenForUrlEvents = useCallback(async () => {
    const cleanups: Array<() => void> = [];
    try {
      // Listen for URL open events from the deep link handler (when app is already running)
      const unlistenUrl = await listen<string>("url-open-request", (event) => {
        console.log("Received URL open request:", event.payload);
        handleUrlOpen(event.payload);
      });
      cleanups.push(unlistenUrl);

      // Listen for show profile selector events
      const unlistenSelector = await listen<string>(
        "show-profile-selector",
        (event) => {
          console.log("Received show profile selector request:", event.payload);
          handleUrlOpen(event.payload);
        },
      );
      cleanups.push(unlistenSelector);

      // Listen for show create profile dialog events
      const unlistenCreate = await listen<string>(
        "show-create-profile-dialog",
        (event) => {
          console.log(
            "Received show create profile dialog request:",
            event.payload,
          );
          showErrorToast(t("errors.noProfilesForUrl"));
          setCreateProfileDialogOpen(true);
        },
      );
      cleanups.push(unlistenCreate);

      // Listen for custom logo click events
      const handleLogoUrlEvent = (event: CustomEvent) => {
        console.log("Received logo URL event:", event.detail);
        handleUrlOpen(event.detail);
      };

      window.addEventListener(
        "url-open-request",
        handleLogoUrlEvent as EventListener,
      );
      cleanups.push(() => {
        window.removeEventListener(
          "url-open-request",
          handleLogoUrlEvent as EventListener,
        );
      });
    } catch (error) {
      console.error("Failed to setup URL listener:", error);
    }
    return () => {
      for (const fn of cleanups) {
        try {
          fn();
        } catch (err) {
          console.error("Failed to cleanup URL listener:", err);
        }
      }
    };
  }, [handleUrlOpen, t]);

  const handleConfigureCamoufox = useCallback((profile: BrowserProfile) => {
    setCurrentProfileForCamoufoxConfig(profile);
    setCamoufoxConfigDialogOpen(true);
  }, []);

  const handleSaveCamoufoxConfig = useCallback(
    async (profile: BrowserProfile, config: CamoufoxConfig) => {
      try {
        await invoke("update_camoufox_config", {
          profileId: profile.id,
          config,
        });
        // No need to manually reload - useProfileEvents will handle the update
        setCamoufoxConfigDialogOpen(false);
      } catch (err: unknown) {
        console.error("Failed to update camoufox config:", err);
        showErrorToast(
          t("errors.updateCamoufoxConfigFailed", {
            error: JSON.stringify(err),
          }),
        );
        throw err;
      }
    },
    [t],
  );

  const handleSaveWayfernConfig = useCallback(
    async (profile: BrowserProfile, config: WayfernConfig) => {
      try {
        await invoke("update_wayfern_config", {
          profileId: profile.id,
          config,
        });
        // No need to manually reload - useProfileEvents will handle the update
        setCamoufoxConfigDialogOpen(false);
      } catch (err: unknown) {
        console.error("Failed to update wayfern config:", err);
        showErrorToast(
          t("errors.updateWayfernConfigFailed", { error: JSON.stringify(err) }),
        );
        throw err;
      }
    },
    [t],
  );

  const handleCreateProfile = useCallback(
    async (profileData: {
      name: string;
      browserStr: BrowserTypeString;
      version: string;
      releaseType: string;
      proxyId?: string;
      vpnId?: string;
      proxySource?: ProxySource;
      camoufoxConfig?: CamoufoxConfig;
      wayfernConfig?: WayfernConfig;
      groupId?: string;
      extensionGroupId?: string;
      ephemeral?: boolean;
      dnsBlocklist?: string;
      launchHook?: string;
      proxyBindingMode?: ProxyBindingMode;
    }) => {
      try {
        const profile = await invoke<BrowserProfile>(
          "create_browser_profile_new",
          {
            name: profileData.name,
            browserStr: profileData.browserStr,
            version: profileData.version,
            releaseType: profileData.releaseType,
            proxyId: profileData.proxyId,
            vpnId: profileData.vpnId,
            proxySource: profileData.proxySource,
            camoufoxConfig: profileData.camoufoxConfig,
            wayfernConfig: profileData.wayfernConfig,
            groupId:
              profileData.groupId ??
              (selectedGroupId !== "default" ? selectedGroupId : undefined),
            ephemeral: profileData.ephemeral,
            dnsBlocklist: profileData.dnsBlocklist,
            launchHook: profileData.launchHook,
            proxyBindingMode: profileData.proxyBindingMode,
          },
        );

        if (profileData.extensionGroupId) {
          try {
            await invoke("assign_extension_group_to_profile", {
              profileId: profile.id,
              extensionGroupId: profileData.extensionGroupId,
            });
          } catch (err) {
            console.error("Failed to assign extension group:", err);
          }
        }

        // No need to manually reload - useProfileEvents will handle the update
      } catch (error) {
        showErrorToast(
          t("errors.createProfileFailed", {
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },
    [selectedGroupId, t],
  );

  const launchProfile = useCallback(
    async (profile: BrowserProfile) => {
      console.log("Starting launch for profile:", profile.name);

      // Show one-time warning about window resizing for fingerprinted browsers
      if (profile.browser === "camoufox" || profile.browser === "wayfern") {
        try {
          const dismissed = await invoke<boolean>(
            "get_window_resize_warning_dismissed",
          );
          if (!dismissed) {
            const proceed = await new Promise<boolean>((resolve) => {
              windowResizeWarningResolver.current = resolve;
              setWindowResizeWarningBrowserType(profile.browser);
              setWindowResizeWarningOpen(true);
            });
            if (!proceed) {
              return;
            }
          }
        } catch (error) {
          console.error("Failed to check window resize warning:", error);
        }
      }

      try {
        const result = await invoke<BrowserProfile>("launch_browser_profile", {
          profile,
        });
        console.log("Successfully launched profile:", result.name);
      } catch (err: unknown) {
        console.error("Failed to launch browser:", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        showErrorToast(
          t("errors.launchBrowserFailed", { error: errorMessage }),
        );
        throw err;
      }
    },
    [t],
  );

  const handleCloneProfile = useCallback((profile: BrowserProfile) => {
    setCloneProfile(profile);
  }, []);

  const handleDeleteProfile = useCallback(
    async (profile: BrowserProfile) => {
      console.log("Attempting to delete profile:", profile.name);

      try {
        // First check if the browser is running for this profile
        const isRunning = await invoke<boolean>("check_browser_status", {
          profile,
        });

        if (isRunning) {
          showErrorToast(t("errors.cannotDeleteRunningProfile"));
          return;
        }

        // Attempt to delete the profile
        await invoke("delete_profile", { profileId: profile.id });
        console.log("Profile deletion command completed successfully");

        // No need to manually reload - useProfileEvents will handle the update
        console.log("Profile deleted successfully");
      } catch (err: unknown) {
        console.error("Failed to delete profile:", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        showErrorToast(
          t("errors.deleteProfileFailed", { error: errorMessage }),
        );
      }
    },
    [t],
  );

  const handleRenameProfile = useCallback(
    async (profileId: string, newName: string) => {
      try {
        await invoke("rename_profile", { profileId, newName });
        // No need to manually reload - useProfileEvents will handle the update
      } catch (err: unknown) {
        console.error("Failed to rename profile:", err);
        showErrorToast(
          t("errors.renameProfileFailed", { error: JSON.stringify(err) }),
        );
        throw err;
      }
    },
    [t],
  );

  const handleKillProfile = useCallback(
    async (profile: BrowserProfile) => {
      console.log("Starting kill for profile:", profile.name);

      try {
        await invoke("kill_browser_profile", { profile });
        console.log("Successfully killed profile:", profile.name);
        // No need to manually reload - useProfileEvents will handle the update
      } catch (err: unknown) {
        console.error("Failed to kill browser:", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        showErrorToast(t("errors.killBrowserFailed", { error: errorMessage }));
        // Re-throw the error so the table component can handle loading state cleanup
        throw err;
      }
    },
    [t],
  );

  const handleDeleteSelectedProfiles = useCallback(
    async (profileIds: string[]) => {
      try {
        await invoke("delete_selected_profiles", { profileIds });
        // No need to manually reload - useProfileEvents will handle the update
      } catch (err: unknown) {
        console.error("Failed to delete selected profiles:", err);
        showErrorToast(
          t("errors.deleteSelectedProfilesFailed", {
            error: JSON.stringify(err),
          }),
        );
      }
    },
    [t],
  );

  const handleAssignProfilesToGroup = useCallback((profileIds: string[]) => {
    setSelectedProfilesForGroup(profileIds);
    setGroupAssignmentDialogOpen(true);
  }, []);

  const handleBulkDelete = useCallback(() => {
    if (selectedProfiles.length === 0) return;
    setShowBulkDeleteConfirmation(true);
  }, [selectedProfiles]);

  const confirmBulkDelete = useCallback(async () => {
    if (selectedProfiles.length === 0) return;

    setIsBulkDeleting(true);
    try {
      await invoke("delete_selected_profiles", {
        profileIds: selectedProfiles,
      });
      // No need to manually reload - useProfileEvents will handle the update
      setSelectedProfiles([]);
      setShowBulkDeleteConfirmation(false);
    } catch (error) {
      console.error("Failed to delete selected profiles:", error);
      showErrorToast(
        t("errors.deleteSelectedProfilesFailed", {
          error: JSON.stringify(error),
        }),
      );
    } finally {
      setIsBulkDeleting(false);
    }
  }, [selectedProfiles, t]);

  const handleBulkGroupAssignment = useCallback(() => {
    if (selectedProfiles.length === 0) return;
    handleAssignProfilesToGroup(selectedProfiles);
    setSelectedProfiles([]);
  }, [selectedProfiles, handleAssignProfilesToGroup]);

  const handleAssignExtensionGroup = useCallback((profileIds: string[]) => {
    setSelectedProfilesForExtensionGroup(profileIds);
    setExtensionGroupAssignmentDialogOpen(true);
  }, []);

  const handleBulkExtensionGroupAssignment = useCallback(() => {
    if (selectedProfiles.length === 0) return;
    handleAssignExtensionGroup(selectedProfiles);
    setSelectedProfiles([]);
  }, [selectedProfiles, handleAssignExtensionGroup]);

  const handleExtensionGroupAssignmentComplete = useCallback(() => {
    setExtensionGroupAssignmentDialogOpen(false);
    setSelectedProfilesForExtensionGroup([]);
  }, []);

  const handleAssignProfilesToProxy = useCallback((profileIds: string[]) => {
    setSelectedProfilesForProxy(profileIds);
    setProxyAssignmentDialogOpen(true);
  }, []);

  const handleBulkProxyAssignment = useCallback(() => {
    if (selectedProfiles.length === 0) return;
    handleAssignProfilesToProxy(selectedProfiles);
    setSelectedProfiles([]);
  }, [selectedProfiles, handleAssignProfilesToProxy]);

  const handleBulkCopyCookies = useCallback(() => {
    if (selectedProfiles.length === 0) return;
    const eligibleProfiles = profiles.filter(
      (p) =>
        selectedProfiles.includes(p.id) &&
        (p.browser === "wayfern" || p.browser === "camoufox"),
    );
    if (eligibleProfiles.length === 0) {
      showErrorToast(t("errors.cookieCopyUnsupportedBrowser"));
      return;
    }
    setSelectedProfilesForCookies(eligibleProfiles.map((p) => p.id));
    setCookieCopyDialogOpen(true);
  }, [selectedProfiles, profiles, t]);

  const handleCopyCookiesToProfile = useCallback((profile: BrowserProfile) => {
    setSelectedProfilesForCookies([profile.id]);
    setCookieCopyDialogOpen(true);
  }, []);

  const handleOpenCookieManagement = useCallback((profile: BrowserProfile) => {
    setCurrentProfileForCookieManagement(profile);
    setCookieManagementDialogOpen(true);
  }, []);

  const handleGroupAssignmentComplete = useCallback(() => {
    // No need to manually reload - useProfileEvents will handle the update
    setGroupAssignmentDialogOpen(false);
    setSelectedProfilesForGroup([]);
  }, []);

  const handleProxyAssignmentComplete = useCallback(() => {
    // No need to manually reload - useProfileEvents will handle the update
    setProxyAssignmentDialogOpen(false);
    setSelectedProfilesForProxy([]);
  }, []);

  const handleGroupManagementComplete = useCallback(async () => {
    // No need to manually reload - useProfileEvents will handle the update
  }, []);

  const handleOpenProfileSyncDialog = useCallback((profile: BrowserProfile) => {
    setCurrentProfileForSync(profile);
    setProfileSyncDialogOpen(true);
  }, []);

  const handleToggleProfileSync = useCallback(
    async (profile: BrowserProfile) => {
      try {
        const enabling = !profile.sync_mode || profile.sync_mode === "Disabled";
        await invoke("set_profile_sync_mode", {
          profileId: profile.id,
          syncMode: enabling ? "Regular" : "Disabled",
        });
        showSuccessToast(
          enabling ? t("sync.mode.enabledToast") : t("sync.mode.disabledToast"),
        );
      } catch (error) {
        console.error("Failed to toggle sync:", error);
        showErrorToast(t("errors.updateSyncSettingsFailed"));
      }
    },
    [t],
  );

  const profilesRef = useRef(profiles);
  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);
  const profilesWithTransferRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let unlistenStatus: UnlistenFn | undefined;
    let unlistenProgress: UnlistenFn | undefined;
    void (async () => {
      try {
        unlistenStatus = await listen<{
          profile_id: string;
          status: string;
          error?: string;
          profile_name?: string;
        }>("profile-sync-status", (event) => {
          const { profile_id, status, error, profile_name } = event.payload;
          const toastId = `sync-${profile_id}`;
          const profile = profilesRef.current.find((p) => p.id === profile_id);
          const name =
            profile_name || profile?.name || t("common.labels.unknownProfile");

          if (status === "synced") {
            dismissToast(toastId);
            if (profilesWithTransferRef.current.has(profile_id)) {
              profilesWithTransferRef.current.delete(profile_id);
              showSuccessToast(t("sync.toast.profileSynced", { name }));
            }
          } else if (status === "error") {
            dismissToast(toastId);
            profilesWithTransferRef.current.delete(profile_id);
            showErrorToast(
              error
                ? t("sync.toast.profileSyncFailedWithError", { name, error })
                : t("sync.toast.profileSyncFailed", { name }),
            );
          }
        });

        unlistenProgress = await listen<{
          profile_id: string;
          phase: string;
          total_files?: number;
          total_bytes?: number;
          completed_files?: number;
          completed_bytes?: number;
          speed_bytes_per_sec?: number;
          eta_seconds?: number;
          failed_count?: number;
          profile_name?: string;
        }>("profile-sync-progress", (event) => {
          const payload = event.payload;
          const toastId = `sync-${payload.profile_id}`;
          const profile = profilesRef.current.find(
            (p) => p.id === payload.profile_id,
          );
          const name =
            payload.profile_name ||
            profile?.name ||
            t("common.labels.unknownProfile");

          if (
            payload.phase === "started" ||
            payload.phase === "uploading" ||
            payload.phase === "downloading"
          ) {
            profilesWithTransferRef.current.add(payload.profile_id);
            showSyncProgressToast(
              t("sync.toast.syncingProfile", { name }),
              {
                completed_files: payload.completed_files ?? 0,
                total_files: payload.total_files ?? 0,
                completed_bytes: payload.completed_bytes ?? 0,
                total_bytes: payload.total_bytes ?? 0,
                speed_bytes_per_sec: payload.speed_bytes_per_sec ?? 0,
                eta_seconds: payload.eta_seconds ?? 0,
                failed_count: payload.failed_count ?? 0,
                phase: payload.phase,
              },
              { id: toastId },
            );
          }
        });
      } catch (error) {
        console.error("Failed to listen for sync events:", error);
      }
    })();
    return () => {
      if (unlistenStatus) unlistenStatus();
      if (unlistenProgress) unlistenProgress();
    };
  }, [t]);

  useEffect(() => {
    // Check for startup default browser prompt
    void checkStartupPrompt();

    // Listen for URL open events and get cleanup function
    const setupListeners = async () => {
      const cleanup = await listenForUrlEvents();
      return cleanup;
    };

    let cleanup: (() => void) | undefined;
    void setupListeners().then((cleanupFn) => {
      cleanup = cleanupFn;
    });

    // Check for startup URLs (when app was launched as default browser)
    void checkCurrentUrl();

    // Set up periodic update checks (every 30 minutes)
    const updateInterval = setInterval(
      () => {
        void checkForUpdates();
      },
      30 * 60 * 1000,
    );

    // Check for missing binaries after initial profile load
    if (!profilesLoading && profiles.length > 0) {
      void checkMissingBinaries();
    }

    // Proactively download Wayfern and Camoufox if not already available
    if (!profilesLoading) {
      void invoke("ensure_active_browsers_downloaded").catch((err: unknown) => {
        console.error("Failed to auto-download browsers:", err);
      });
    }

    return () => {
      clearInterval(updateInterval);
      if (cleanup) {
        cleanup();
      }
    };
  }, [
    checkForUpdates,
    checkStartupPrompt,
    listenForUrlEvents,
    checkCurrentUrl,
    checkMissingBinaries,
    profilesLoading,
    profiles.length,
  ]);

  // Show warning for non-wayfern/camoufox profiles (support ending March 15, 2026)
  useEffect(() => {
    if (profiles.length === 0) return;

    const unsupportedProfiles = profiles.filter(
      (p) => p.browser !== "wayfern" && p.browser !== "camoufox",
    );

    if (unsupportedProfiles.length > 0) {
      const unsupportedNames = unsupportedProfiles
        .map((p) => p.name)
        .join(", ");

      showToast({
        id: "browser-support-ending-warning",
        type: "error",
        title: t("home.deprecation.title"),
        description: t("home.deprecation.description", {
          date: "March 15, 2026",
          profiles: unsupportedNames,
        }),
        duration: 15000,
        action: {
          label: t("home.deprecation.learnMore"),
          onClick: () => {
            const event = new CustomEvent("url-open-request", {
              detail: "https://github.com/zhom/donutbrowser/discussions",
            });
            window.dispatchEvent(event);
          },
        },
      });
    }
  }, [profiles, t]);

  // Re-check Wayfern terms when a browser download completes
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      unlisten = await listen<{ stage: string }>(
        "download-progress",
        (event) => {
          if (event.payload.stage === "completed") {
            void checkTerms();
          }
        },
      );
    };
    void setup();
    return () => {
      if (unlisten) unlisten();
    };
  }, [checkTerms]);

  // Surface silent backend events so the user knows what's happening:
  //  1. Profile versions auto-upgraded on startup or post-download.
  //  2. Background browser binary downloads triggered by ensure_active_*.
  useEffect(() => {
    let unlistenAutoUpgrade: UnlistenFn | undefined;
    let unlistenBgStart: UnlistenFn | undefined;
    let unlistenBgDone: UnlistenFn | undefined;
    void (async () => {
      unlistenAutoUpgrade = await listen<string[]>(
        "profiles-auto-upgraded",
        (event) => {
          const names = event.payload ?? [];
          if (names.length === 0) return;
          showSuccessToast(
            t("toasts.success.profilesAutoUpgraded", {
              count: names.length,
              names: names.join(", "),
            }),
          );
        },
      );

      unlistenBgStart = await listen<{ browser: string; version: string }>(
        "bg-browser-download-started",
        (event) => {
          const { browser, version } = event.payload;
          showToast({
            type: "loading",
            id: `bg-download-${browser}-${version}`,
            title: t("toasts.loading.bgBrowserDownload", { browser, version }),
          });
        },
      );

      unlistenBgDone = await listen<{
        browser: string;
        version: string;
        success: boolean;
      }>("bg-browser-download-completed", (event) => {
        const { browser, version, success } = event.payload;
        const id = `bg-download-${browser}-${version}`;
        dismissToast(id);
        if (success) {
          showSuccessToast(
            t("toasts.success.bgBrowserDownloadCompleted", {
              browser,
              version,
            }),
          );
        }
      });
    })();
    return () => {
      unlistenAutoUpgrade?.();
      unlistenBgStart?.();
      unlistenBgDone?.();
    };
  }, [t]);

  // Check permissions when they are initialized
  useEffect(() => {
    if (isInitialized) {
      checkAllPermissions();
    }
  }, [isInitialized, checkAllPermissions]);

  // Check self-hosted sync config on mount and when cloud user changes
  useEffect(() => {
    void checkSelfHostedSync();
  }, [checkSelfHostedSync]);

  // Global keyboard shortcuts. ⌘K / ⌘/ always fire (even from inputs) so the
  // palette and help are always reachable; every other binding is skipped
  // while a text field is focused so typing doesn't trigger navigation.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inEditable =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      const palette = SHORTCUTS.find((s) => s.id === "openPalette");
      const help = SHORTCUTS.find((s) => s.id === "openShortcuts");

      if (palette && matchesShortcut(palette, e)) {
        e.preventDefault();
        runShortcut("openPalette");
        return;
      }
      if (help && matchesShortcut(help, e)) {
        e.preventDefault();
        runShortcut("openShortcuts");
        return;
      }

      if (inEditable) return;

      const digit = matchesGroupDigit(e);
      if (digit !== null) {
        const target_ = groupTargets[digit - 1];
        if (target_) {
          e.preventDefault();
          handleSelectGroup(target_.id);
        }
        return;
      }

      for (const s of SHORTCUTS) {
        if (s.id === "openPalette" || s.id === "openShortcuts") continue;
        if (matchesShortcut(s, e)) {
          e.preventDefault();
          runShortcut(s.id);
          return;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [runShortcut, groupTargets, handleSelectGroup]);

  // Filter data by selected group and search query
  const filteredProfiles = useMemo(() => {
    let filtered = profiles;

    // Filter by group
    if (!selectedGroupId || selectedGroupId === "default") {
      filtered = profiles.filter((profile) => !profile.group_id);
    } else {
      filtered = profiles.filter(
        (profile) => profile.group_id === selectedGroupId,
      );
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((profile) => {
        // Search in profile name
        if (profile.name.toLowerCase().includes(query)) return true;

        // Search in note
        if (profile.note?.toLowerCase().includes(query)) return true;

        // Search in tags
        if (profile.tags?.some((tag) => tag.toLowerCase().includes(query)))
          return true;

        return false;
      });
    }

    return filtered;
  }, [profiles, selectedGroupId, searchQuery]);

  const runBulkTask = useCallback(
    async (action: BulkTaskAction) => {
      if (selectedProfiles.length === 0) return;
      const taskId = crypto.randomUUID();
      bulkTaskIdRef.current = taskId;
      try {
        setIsBulkTaskRunning(true);
        setBulkTaskResults([]);
        setBulkTaskProgress({ completed: 0, total: selectedProfiles.length });
        const results = await invoke<BulkTaskItemResult[]>(
          "run_bulk_browser_tasks",
          {
            request: {
              profileIds: selectedProfiles,
              action,
              maxConcurrency: 3,
              taskId,
            },
          },
        );
        setBulkTaskResults(results);
      } catch (error) {
        showErrorToast(t("profiles.bulkTasks.runFailed"));
        console.error("bulk task failed", error);
      } finally {
        setIsBulkTaskRunning(false);
        setBulkTaskProgress(null);
        bulkTaskIdRef.current = null;
      }
    },
    [selectedProfiles, t],
  );

  const cancelBulkTask = useCallback(() => {
    const taskId = bulkTaskIdRef.current;
    if (!taskId) return;
    void invoke("cancel_bulk_browser_task", { taskId }).catch((error) => {
      console.error("Failed to cancel bulk task", error);
    });
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void (async () => {
      unlisten = await listen<{
        taskId: string;
        completedCount: number;
        totalCount: number;
        lastResult: BulkTaskItemResult;
        cancelled: boolean;
      }>("bulk-task-progress", (event) => {
        const payload = event.payload;
        if (payload.taskId !== bulkTaskIdRef.current) return;
        setBulkTaskProgress({
          completed: payload.completedCount,
          total: payload.totalCount,
        });
        setBulkTaskResults((prev) => {
          // Replace if a result for the same profile already exists.
          const existingIdx = prev.findIndex(
            (r) => r.profileId === payload.lastResult.profileId,
          );
          if (existingIdx >= 0) {
            const next = prev.slice();
            next[existingIdx] = payload.lastResult;
            return next;
          }
          return [...prev, payload.lastResult];
        });
      });
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  // Update loading states
  const isLoading = profilesLoading || groupsLoading || proxiesLoading;

  return (
    <div className="grid items-center justify-items-center min-h-screen gap-8 font-(family-name:--font-geist-sans) bg-background">
      <main className="flex flex-col items-center w-full max-w-4xl px-3">
        <div className="w-full">
          <HomeHeader
            onCreateProfileDialogOpen={setCreateProfileDialogOpen}
            onGroupManagementDialogOpen={setGroupManagementDialogOpen}
            onImportProfileDialogOpen={setImportProfileDialogOpen}
            onProxyManagementDialogOpen={setProxyManagementDialogOpen}
            onSettingsDialogOpen={setSettingsDialogOpen}
            onSyncConfigDialogOpen={setSyncConfigDialogOpen}
            onIntegrationsDialogOpen={setIntegrationsDialogOpen}
            onExtensionManagementDialogOpen={setExtensionManagementDialogOpen}
            onOperationLogsDialogOpen={setOperationLogsOpen}
            onCommandPaletteOpen={() => {
              setCommandPaletteOpen(true);
            }}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
          />
        </div>
        <div className="w-full mt-2.5">
          <GroupBadges
            selectedGroupId={selectedGroupId}
            onGroupSelect={handleSelectGroup}
            groups={groupsData}
            isLoading={isLoading}
          />
          {selectedProfiles.length > 0 ? (
            <div className="mt-3 rounded-md border bg-background p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm font-medium">
                  {t("profiles.bulkTasks.title", {
                    count: selectedProfiles.length,
                  })}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={isBulkTaskRunning}
                    onClick={() => void runBulkTask("start")}
                  >
                    <LuPlay className="mr-2 h-4 w-4" />
                    {t("profiles.bulkTasks.start")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isBulkTaskRunning}
                    onClick={() => void runBulkTask("stop")}
                  >
                    <LuSquare className="mr-2 h-4 w-4" />
                    {t("profiles.bulkTasks.stop")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isBulkTaskRunning}
                    onClick={() => void runBulkTask("healthCheck")}
                  >
                    <LuActivity className="mr-2 h-4 w-4" />
                    {t("profiles.bulkTasks.healthCheck")}
                  </Button>
                  {isBulkTaskRunning ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={cancelBulkTask}
                    >
                      {t("profiles.bulkTasks.cancel")}
                    </Button>
                  ) : null}
                </div>
              </div>
              {bulkTaskProgress ? (
                <div className="mt-3 flex flex-col gap-1">
                  <div className="text-xs text-muted-foreground">
                    {t("profiles.bulkTasks.progress", {
                      completed: bulkTaskProgress.completed,
                      total: bulkTaskProgress.total,
                    })}
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{
                        width: `${
                          bulkTaskProgress.total === 0
                            ? 0
                            : Math.min(
                                100,
                                Math.round(
                                  (bulkTaskProgress.completed /
                                    bulkTaskProgress.total) *
                                    100,
                                ),
                              )
                        }%`,
                      }}
                    />
                  </div>
                </div>
              ) : null}
              {bulkTaskResults.length > 0 ? (
                <div className="mt-3 max-h-56 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("profiles.bulkTasks.profile")}</TableHead>
                        <TableHead>{t("profiles.bulkTasks.result")}</TableHead>
                        <TableHead>
                          {t("profiles.bulkTasks.retriesLabel")}
                        </TableHead>
                        <TableHead>{t("profiles.bulkTasks.time")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bulkTaskResults.map((item) => {
                        const profileName =
                          profiles.find(
                            (profile) => profile.id === item.profileId,
                          )?.name ?? item.profileId;
                        return (
                          <TableRow key={item.profileId}>
                            <TableCell className="max-w-[220px] truncate">
                              {profileName}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  item.success ? "outline" : "destructive"
                                }
                              >
                                {item.success
                                  ? t("profiles.bulkTasks.success")
                                  : t("profiles.bulkTasks.failed")}
                              </Badge>
                            </TableCell>
                            <TableCell>{item.retries}</TableCell>
                            <TableCell>
                              {new Date(
                                item.timestamp * 1000,
                              ).toLocaleTimeString()}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </div>
          ) : null}
          <ProfilesDataTable
            profiles={filteredProfiles}
            onLaunchProfile={launchProfile}
            onKillProfile={handleKillProfile}
            onCloneProfile={handleCloneProfile}
            onDeleteProfile={handleDeleteProfile}
            onRenameProfile={handleRenameProfile}
            onConfigureCamoufox={handleConfigureCamoufox}
            onCopyCookiesToProfile={handleCopyCookiesToProfile}
            onOpenCookieManagement={handleOpenCookieManagement}
            runningProfiles={runningProfiles}
            isUpdating={isUpdating}
            onDeleteSelectedProfiles={handleDeleteSelectedProfiles}
            onAssignProfilesToGroup={handleAssignProfilesToGroup}
            selectedGroupId={selectedGroupId}
            selectedProfiles={selectedProfiles}
            onSelectedProfilesChange={setSelectedProfiles}
            onBulkDelete={handleBulkDelete}
            onBulkGroupAssignment={handleBulkGroupAssignment}
            onBulkProxyAssignment={handleBulkProxyAssignment}
            onBulkCopyCookies={handleBulkCopyCookies}
            onBulkExtensionGroupAssignment={handleBulkExtensionGroupAssignment}
            onAssignExtensionGroup={handleAssignExtensionGroup}
            onOpenProfileSyncDialog={handleOpenProfileSyncDialog}
            onToggleProfileSync={handleToggleProfileSync}
            crossOsUnlocked={crossOsUnlocked}
            syncUnlocked={syncUnlocked}
            getProfileSyncInfo={getProfileSyncInfo}
            onLaunchWithSync={(profile) => {
              setSyncLeaderProfile(profile);
            }}
          />
        </div>
      </main>

      <CreateProfileDialog
        isOpen={createProfileDialogOpen}
        onClose={() => {
          setCreateProfileDialogOpen(false);
        }}
        onCreateProfile={handleCreateProfile}
        selectedGroupId={selectedGroupId}
        crossOsUnlocked={crossOsUnlocked}
      />

      {operationLogsOpen && (
        <OperationLogsDialog
          open={operationLogsOpen}
          onOpenChange={setOperationLogsOpen}
          profiles={profiles}
        />
      )}
      {settingsDialogOpen && (
        <SettingsDialog
          isOpen={settingsDialogOpen}
          onClose={() => {
            setSettingsDialogOpen(false);
          }}
          onIntegrationsOpen={() => {
            setSettingsDialogOpen(false);
            setIntegrationsDialogOpen(true);
          }}
        />
      )}

      {integrationsDialogOpen && (
        <IntegrationsDialog
          isOpen={integrationsDialogOpen}
          onClose={() => {
            setIntegrationsDialogOpen(false);
          }}
        />
      )}

      <ImportProfileDialog
        isOpen={importProfileDialogOpen}
        onClose={() => {
          setImportProfileDialogOpen(false);
        }}
        crossOsUnlocked={crossOsUnlocked}
      />

      {proxyManagementDialogOpen && (
        <ProxyManagementDialog
          isOpen={proxyManagementDialogOpen}
          onClose={() => {
            setProxyManagementDialogOpen(false);
          }}
        />
      )}

      {pendingUrls.map((pendingUrl) => (
        <ProfileSelectorDialog
          key={pendingUrl.id}
          isOpen={true}
          onClose={() => {
            setPendingUrls((prev) =>
              prev.filter((u) => u.id !== pendingUrl.id),
            );
          }}
          url={pendingUrl.url}
          isUpdating={isUpdating}
          runningProfiles={runningProfiles}
        />
      ))}

      <PermissionDialog
        isOpen={permissionDialogOpen}
        onClose={() => {
          setPermissionDialogOpen(false);
        }}
        permissionType={currentPermissionType}
        onPermissionGranted={checkNextPermission}
      />

      <CloneProfileDialog
        isOpen={!!cloneProfile}
        onClose={() => {
          setCloneProfile(null);
        }}
        profile={cloneProfile}
      />

      <CamoufoxConfigDialog
        isOpen={camoufoxConfigDialogOpen}
        onClose={() => {
          setCamoufoxConfigDialogOpen(false);
        }}
        profile={currentProfileForCamoufoxConfig}
        onSave={handleSaveCamoufoxConfig}
        onSaveWayfern={handleSaveWayfernConfig}
        isRunning={
          currentProfileForCamoufoxConfig
            ? runningProfiles.has(currentProfileForCamoufoxConfig.id)
            : false
        }
        crossOsUnlocked={crossOsUnlocked}
      />

      {groupManagementDialogOpen && (
        <GroupManagementDialog
          isOpen={groupManagementDialogOpen}
          onClose={() => {
            setGroupManagementDialogOpen(false);
          }}
          onGroupManagementComplete={handleGroupManagementComplete}
        />
      )}

      {extensionManagementDialogOpen && (
        <ExtensionManagementDialog
          isOpen={extensionManagementDialogOpen}
          onClose={() => {
            setExtensionManagementDialogOpen(false);
          }}
          limitedMode={false}
        />
      )}

      {groupAssignmentDialogOpen && (
        <GroupAssignmentDialog
          isOpen={groupAssignmentDialogOpen}
          onClose={() => {
            setGroupAssignmentDialogOpen(false);
          }}
          selectedProfiles={selectedProfilesForGroup}
          onAssignmentComplete={handleGroupAssignmentComplete}
          profiles={profiles}
        />
      )}

      {extensionGroupAssignmentDialogOpen && (
        <ExtensionGroupAssignmentDialog
          isOpen={extensionGroupAssignmentDialogOpen}
          onClose={() => {
            setExtensionGroupAssignmentDialogOpen(false);
          }}
          selectedProfiles={selectedProfilesForExtensionGroup}
          onAssignmentComplete={handleExtensionGroupAssignmentComplete}
          profiles={profiles}
        />
      )}

      {proxyAssignmentDialogOpen && (
        <ProxyAssignmentDialog
          isOpen={proxyAssignmentDialogOpen}
          onClose={() => {
            setProxyAssignmentDialogOpen(false);
          }}
          selectedProfiles={selectedProfilesForProxy}
          onAssignmentComplete={handleProxyAssignmentComplete}
          profiles={profiles}
          storedProxies={storedProxies}
          vpnConfigs={vpnConfigs}
        />
      )}

      <CookieCopyDialog
        isOpen={cookieCopyDialogOpen}
        onClose={() => {
          setCookieCopyDialogOpen(false);
          setSelectedProfilesForCookies([]);
        }}
        selectedProfiles={selectedProfilesForCookies}
        profiles={profiles}
        runningProfiles={runningProfiles}
        onCopyComplete={() => {
          setSelectedProfilesForCookies([]);
        }}
      />

      <CookieManagementDialog
        isOpen={cookieManagementDialogOpen}
        onClose={() => {
          setCookieManagementDialogOpen(false);
          setCurrentProfileForCookieManagement(null);
        }}
        profile={currentProfileForCookieManagement}
      />

      <DeleteConfirmationDialog
        isOpen={showBulkDeleteConfirmation}
        onClose={() => {
          setShowBulkDeleteConfirmation(false);
        }}
        onConfirm={confirmBulkDelete}
        title={t("profiles.bulkDelete.title")}
        description={t("profiles.bulkDelete.description", {
          count: selectedProfiles.length,
        })}
        confirmButtonText={t("profiles.bulkDelete.confirmButton", {
          count: selectedProfiles.length,
        })}
        isLoading={isBulkDeleting}
        profileIds={selectedProfiles}
        profiles={profiles.map((p) => ({ id: p.id, name: p.name }))}
      />

      {syncConfigDialogOpen && (
        <SyncConfigDialog
          isOpen={syncConfigDialogOpen}
          onClose={(loginOccurred) => {
            setSyncConfigDialogOpen(false);
            void checkSelfHostedSync();
            if (loginOccurred) {
              setSyncAllDialogOpen(true);
            }
          }}
          onLoginStarted={() => {
            // Hand the verify step off to its own dialog. We close this one
            // first so the verify dialog isn't stacked on top of it (and
            // can't end up stacked on top of the profile selector either).
            setSyncConfigDialogOpen(false);
            setDeviceCodeDialogOpen(true);
          }}
        />
      )}

      {/* Only render while no profile-selector flow is in progress, so the
          verify dialog never lands on top of a deep-link-triggered selector. */}
      {pendingUrls.length === 0 && (
        <DeviceCodeVerifyDialog
          isOpen={deviceCodeDialogOpen}
          onClose={(loginOccurred) => {
            setDeviceCodeDialogOpen(false);
            if (loginOccurred) {
              setSyncAllDialogOpen(true);
            }
          }}
        />
      )}

      {syncAllDialogOpen && (
        <SyncAllDialog
          isOpen={syncAllDialogOpen}
          onClose={() => {
            setSyncAllDialogOpen(false);
          }}
        />
      )}

      {profileSyncDialogOpen && (
        <ProfileSyncDialog
          isOpen={profileSyncDialogOpen}
          onClose={() => {
            setProfileSyncDialogOpen(false);
            setCurrentProfileForSync(null);
          }}
          profile={currentProfileForSync}
          onSyncConfigOpen={() => {
            setSyncConfigDialogOpen(true);
          }}
        />
      )}

      {/* Wayfern Terms and Conditions Dialog - shown if terms not accepted */}
      <WayfernTermsDialog
        isOpen={
          !termsLoading &&
          termsAccepted === false &&
          typeof window !== "undefined" &&
          window.localStorage.getItem(WAYFERN_TERMS_DECLINED_KEY) !== "true"
        }
        onAccepted={checkTerms}
      />

      {/* Launch on Login Dialog - shown on every startup until enabled or declined */}
      <LaunchOnLoginDialog
        isOpen={launchOnLoginDialogOpen}
        onClose={() => {
          setLaunchOnLoginDialogOpen(false);
        }}
      />

      <WindowResizeWarningDialog
        isOpen={windowResizeWarningOpen}
        browserType={windowResizeWarningBrowserType}
        onResult={(proceed) => {
          setWindowResizeWarningOpen(false);
          windowResizeWarningResolver.current?.(proceed);
          windowResizeWarningResolver.current = null;
        }}
      />

      <SyncFollowerDialog
        isOpen={syncLeaderProfile !== null}
        onClose={() => {
          setSyncLeaderProfile(null);
        }}
        leaderProfile={syncLeaderProfile}
        allProfiles={profiles}
        runningProfiles={runningProfiles}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        onAction={runShortcut}
        groupTargets={groupTargets}
        onSelectGroup={handleSelectGroup}
        profiles={profiles}
        runningProfileIds={runningProfiles}
        onLaunchProfile={(profile) => {
          void launchProfile(profile);
        }}
        onKillProfile={(profile) => {
          void handleKillProfile(profile);
        }}
      />

      <ShortcutsDialog
        open={shortcutsDialogOpen}
        onOpenChange={setShortcutsDialogOpen}
        groupTargets={groupTargets}
      />
    </div>
  );
}
