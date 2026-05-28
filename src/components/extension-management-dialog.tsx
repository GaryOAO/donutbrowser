"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FaChrome, FaFirefox } from "react-icons/fa";
import { GoPlus } from "react-icons/go";
import {
  LuChevronLeft,
  LuExternalLink,
  LuPencil,
  LuPuzzle,
  LuTrash2,
  LuUpload,
} from "react-icons/lu";
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
import { ProBadge } from "@/components/ui/pro-badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import type { Extension, ExtensionGroup } from "@/types";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";
import { RippleButton } from "./ui/ripple";

type SyncStatus = "disabled" | "syncing" | "synced" | "error" | "waiting";

function getSyncStatusDot(
  item: { sync_enabled?: boolean; last_sync?: number },
  liveStatus: SyncStatus | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): { color: string; tooltip: string; animate: boolean } {
  const status = liveStatus ?? (item.sync_enabled ? "synced" : "disabled");

  switch (status) {
    case "syncing":
      return {
        color: "bg-warning",
        tooltip: t("profileTable.syncTooltipSyncing"),
        animate: true,
      };
    case "synced":
      return {
        color: "bg-success",
        tooltip: item.last_sync
          ? t("profileTable.syncTooltipSyncedAt", {
              time: new Date(item.last_sync * 1000).toLocaleString(),
            })
          : t("profileTable.syncTooltipSynced"),
        animate: false,
      };
    case "waiting":
      return {
        color: "bg-warning",
        tooltip: t("profileTable.syncTooltipWaiting"),
        animate: false,
      };
    case "error":
      return {
        color: "bg-destructive",
        tooltip: t("profileTable.syncTooltipError"),
        animate: false,
      };
    default:
      return {
        color: "bg-muted-foreground",
        tooltip: t("profileTable.syncTooltipNotSynced"),
        animate: false,
      };
  }
}

interface ExtensionManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
  limitedMode: boolean;
}

type Tab = "extensions" | "groups";

export function ExtensionManagementDialog({
  isOpen,
  onClose,
  limitedMode,
}: ExtensionManagementDialogProps) {
  const { t } = useTranslation();
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [extensionGroups, setExtensionGroups] = useState<ExtensionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Extension upload state
  const [isUploading, setIsUploading] = useState(false);
  const [extensionName, setExtensionName] = useState("");
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [pendingFile, setPendingFile] = useState<{
    name: string;
    data: number[];
  } | null>(null);

  // Group state
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  // Master-detail selection: which group's detail is shown
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  // Inline rename state for the selected group (within the detail pane)
  const [renamingGroup, setRenamingGroup] = useState(false);
  const [renameGroupValue, setRenameGroupValue] = useState("");

  // Inline-edit state for an extension row (rename only — re-upload + metadata
  // are shown inline in an expanded panel below the row when active)
  const [inlineEditingExtId, setInlineEditingExtId] = useState<string | null>(
    null,
  );
  const [inlineEditName, setInlineEditName] = useState("");
  const [inlineEditFile, setInlineEditFile] = useState<{
    name: string;
    data: number[];
  } | null>(null);

  // Delete state
  const [extensionToDelete, setExtensionToDelete] = useState<Extension | null>(
    null,
  );
  const [groupToDelete, setGroupToDelete] = useState<ExtensionGroup | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  // Extension icons
  const [extensionIcons, setExtensionIcons] = useState<Record<string, string>>(
    {},
  );

  // Sync state
  const [extSyncStatus, setExtSyncStatus] = useState<
    Record<string, SyncStatus>
  >({});
  const [isTogglingExtSync, setIsTogglingExtSync] = useState<
    Record<string, boolean>
  >({});
  const [isTogglingGroupSync, setIsTogglingGroupSync] = useState<
    Record<string, boolean>
  >({});

  // Tab
  const [activeTab, setActiveTab] = useState<Tab>("extensions");

  const loadData = useCallback(async () => {
    if (limitedMode) return;
    setIsLoading(true);
    try {
      const [exts, groups] = await Promise.all([
        invoke<Extension[]>("list_extensions"),
        invoke<ExtensionGroup[]>("list_extension_groups"),
      ]);
      setExtensions(exts);
      setExtensionGroups(groups);
    } catch {
      // User may not have pro subscription
      setExtensions([]);
      setExtensionGroups([]);
    } finally {
      setIsLoading(false);
    }
  }, [limitedMode]);

  const loadIcons = useCallback(async (exts: Extension[]) => {
    const icons: Record<string, string> = {};
    for (const ext of exts) {
      try {
        const icon = await invoke<string | null>("get_extension_icon", {
          extensionId: ext.id,
        });
        if (icon) {
          icons[ext.id] = icon;
        }
      } catch {
        // Icon not available
      }
    }
    setExtensionIcons(icons);
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadData();
    } else {
      // Reset master-detail state when dialog closes
      setSelectedGroupId(null);
      setRenamingGroup(false);
      setInlineEditingExtId(null);
    }
  }, [isOpen, loadData]);

  useEffect(() => {
    if (extensions.length > 0) {
      void loadIcons(extensions);
    }
  }, [extensions, loadIcons]);

  // Listen for extension sync status events
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<{ id: string; status: string }>(
        "extension-sync-status",
        (event) => {
          const { id, status } = event.payload;
          setExtSyncStatus((prev) => ({
            ...prev,
            [id]: status as SyncStatus,
          }));
        },
      );
    };

    void setupListener();
    return () => {
      unlisten?.();
    };
  }, []);

  const handleToggleExtSync = useCallback(
    async (ext: Extension) => {
      setIsTogglingExtSync((prev) => ({ ...prev, [ext.id]: true }));
      try {
        await invoke("set_extension_sync_enabled", {
          extensionId: ext.id,
          enabled: !ext.sync_enabled,
        });
        showSuccessToast(
          ext.sync_enabled
            ? t("extensions.syncDisabled")
            : t("extensions.syncEnabled"),
        );
        void loadData();
      } catch (err) {
        showErrorToast(err instanceof Error ? err.message : String(err));
      } finally {
        setIsTogglingExtSync((prev) => ({ ...prev, [ext.id]: false }));
      }
    },
    [loadData, t],
  );

  const handleToggleGroupSync = useCallback(
    async (group: ExtensionGroup) => {
      setIsTogglingGroupSync((prev) => ({ ...prev, [group.id]: true }));
      try {
        await invoke("set_extension_group_sync_enabled", {
          extensionGroupId: group.id,
          enabled: !group.sync_enabled,
        });
        showSuccessToast(
          group.sync_enabled
            ? t("extensions.syncDisabled")
            : t("extensions.syncEnabled"),
        );
        void loadData();
      } catch (err) {
        showErrorToast(err instanceof Error ? err.message : String(err));
      } finally {
        setIsTogglingGroupSync((prev) => ({ ...prev, [group.id]: false }));
      }
    },
    [loadData, t],
  );

  // Inline-save extension (name + optional new file)
  const handleSaveInlineExtension = useCallback(async () => {
    if (!inlineEditingExtId || !inlineEditName.trim()) return;
    try {
      await invoke("update_extension", {
        extensionId: inlineEditingExtId,
        name: inlineEditName.trim(),
        fileName: inlineEditFile?.name ?? null,
        fileData: inlineEditFile?.data ?? null,
      });
      showSuccessToast(t("extensions.updateSuccess"));
      setInlineEditingExtId(null);
      setInlineEditName("");
      setInlineEditFile(null);
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    }
  }, [inlineEditingExtId, inlineEditName, inlineEditFile, loadData, t]);

  const handleCancelInlineExtension = useCallback(() => {
    setInlineEditingExtId(null);
    setInlineEditName("");
    setInlineEditFile(null);
  }, []);

  const handleInlineExtFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const validExtensions = [".xpi", ".crx", ".zip"];
      const isValid = validExtensions.some((ext) =>
        file.name.toLowerCase().endsWith(ext),
      );
      if (!isValid) {
        showErrorToast(t("extensions.invalidFileType"));
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const data = Array.from(new Uint8Array(arrayBuffer));
        setInlineEditFile({ name: file.name, data });
      };
      reader.readAsArrayBuffer(file);
      e.target.value = "";
    },
    [t],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const validExtensions = [".xpi", ".crx", ".zip"];
      const isValid = validExtensions.some((ext) =>
        file.name.toLowerCase().endsWith(ext),
      );
      if (!isValid) {
        showErrorToast(t("extensions.invalidFileType"));
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const data = Array.from(new Uint8Array(arrayBuffer));
        const baseName = file.name
          .replace(/\.(xpi|crx|zip)$/i, "")
          .replace(/[-_]/g, " ");
        setExtensionName(baseName);
        setPendingFile({ name: file.name, data });
        setShowUploadForm(true);
      };
      reader.onerror = () => {
        showErrorToast(t("extensions.readError"));
      };
      reader.readAsArrayBuffer(file);

      // Reset input
      e.target.value = "";
    },
    [t],
  );

  const handleUpload = useCallback(async () => {
    if (!pendingFile || !extensionName.trim()) return;
    setIsUploading(true);
    try {
      await invoke("add_extension", {
        name: extensionName.trim(),
        fileName: pendingFile.name,
        fileData: pendingFile.data,
      });
      showSuccessToast(t("extensions.uploadSuccess"));
      setShowUploadForm(false);
      setPendingFile(null);
      setExtensionName("");
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
    }
  }, [pendingFile, extensionName, loadData, t]);

  const handleDeleteExtension = useCallback(async () => {
    if (!extensionToDelete) return;
    setIsDeleting(true);
    try {
      await invoke("delete_extension", { extensionId: extensionToDelete.id });
      showSuccessToast(t("extensions.deleteSuccess"));
      setExtensionToDelete(null);
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  }, [extensionToDelete, loadData, t]);

  const handleCreateGroup = useCallback(async () => {
    if (!newGroupName.trim()) return;
    try {
      const created = await invoke<ExtensionGroup>("create_extension_group", {
        name: newGroupName.trim(),
      });
      showSuccessToast(t("extensions.groupCreateSuccess"));
      setShowCreateGroup(false);
      setNewGroupName("");
      void loadData();
      setSelectedGroupId(created.id);
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    }
  }, [newGroupName, loadData, t]);

  // Rename selected group inline (replaces nested EditGroup dialog)
  const handleSaveGroupRename = useCallback(async () => {
    if (!selectedGroupId || !renameGroupValue.trim()) return;
    try {
      await invoke("update_extension_group", {
        groupId: selectedGroupId,
        name: renameGroupValue.trim(),
      });
      showSuccessToast(t("extensions.groupUpdateSuccess"));
      setRenamingGroup(false);
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    }
  }, [selectedGroupId, renameGroupValue, loadData, t]);

  // Add an extension to selected group (replaces the nested dialog flow)
  const handleAddExtensionToSelectedGroup = useCallback(
    async (extId: string) => {
      if (!selectedGroupId) return;
      try {
        await invoke("add_extension_to_group", {
          groupId: selectedGroupId,
          extensionId: extId,
        });
        showSuccessToast(t("extensions.groupUpdateSuccess"));
        void loadData();
      } catch (err) {
        showErrorToast(err instanceof Error ? err.message : String(err));
      }
    },
    [selectedGroupId, loadData, t],
  );

  const handleRemoveExtensionFromSelectedGroup = useCallback(
    async (extId: string) => {
      if (!selectedGroupId) return;
      try {
        await invoke("remove_extension_from_group", {
          groupId: selectedGroupId,
          extensionId: extId,
        });
        showSuccessToast(t("extensions.groupUpdateSuccess"));
        void loadData();
      } catch (err) {
        showErrorToast(err instanceof Error ? err.message : String(err));
      }
    },
    [selectedGroupId, loadData, t],
  );

  const handleDeleteGroup = useCallback(async () => {
    if (!groupToDelete) return;
    setIsDeleting(true);
    try {
      await invoke("delete_extension_group", { groupId: groupToDelete.id });
      showSuccessToast(t("extensions.groupDeleteSuccess"));
      // If the deleted group was selected, clear the detail pane
      if (selectedGroupId === groupToDelete.id) {
        setSelectedGroupId(null);
      }
      setGroupToDelete(null);
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  }, [groupToDelete, selectedGroupId, loadData, t]);

  const renderCompatIcons = (compat: string[]) => {
    const hasChromium = compat.includes("chromium");
    const hasFirefox = compat.includes("firefox");
    if (!hasChromium && !hasFirefox) return null;
    return (
      <div className="flex items-center gap-1 shrink-0">
        {hasChromium && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <FaChrome className="w-3.5 h-3.5 text-muted-foreground" />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t("extensions.compatibility.chromium")}
            </TooltipContent>
          </Tooltip>
        )}
        {hasFirefox && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <FaFirefox className="w-3.5 h-3.5 text-muted-foreground" />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t("extensions.compatibility.firefox")}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  };

  const renderExtensionIcon = (ext: Extension, size: "sm" | "md" = "md") => {
    const sizeClass = size === "sm" ? "w-4 h-4" : "w-5 h-5";
    if (extensionIcons[ext.id]) {
      return (
        // biome-ignore lint/performance/noImgElement: base64 data URI icons cannot use next/image
        <img
          src={extensionIcons[ext.id]}
          alt=""
          className={`${sizeClass} shrink-0 rounded-sm`}
        />
      );
    }
    return (
      <LuPuzzle className={`${sizeClass} shrink-0 text-muted-foreground`} />
    );
  };

  const MAX_VISIBLE_ICONS = 3;

  const selectedGroup =
    extensionGroups.find((g) => g.id === selectedGroupId) ?? null;
  const selectedGroupExtensions = selectedGroup
    ? (selectedGroup.extension_ids
        .map((id) => extensions.find((e) => e.id === id))
        .filter(Boolean) as Extension[])
    : [];
  const extensionsNotInSelectedGroup = selectedGroup
    ? extensions.filter((e) => !selectedGroup.extension_ids.includes(e.id))
    : [];

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LuPuzzle className="w-5 h-5" />
              {t("extensions.title")}
              {limitedMode && <ProBadge />}
            </DialogTitle>
            <DialogDescription>{t("extensions.description")}</DialogDescription>
          </DialogHeader>

          <ScrollArea className="overflow-y-auto flex-1">
            <div className="relative">
              {limitedMode && (
                <>
                  <div className="absolute inset-0 backdrop-blur-[6px] bg-background/30 z-[1]" />
                  <div className="absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background to-transparent z-[2]" />
                  <div className="absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent z-[2]" />
                  <div className="absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-background to-transparent z-[2]" />
                  <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-background to-transparent z-[2]" />
                  <div className="absolute inset-0 flex items-center justify-center z-[3]">
                    <div className="flex items-center gap-2 rounded-md bg-background/80 px-3 py-1.5">
                      <ProBadge />
                      <span className="text-sm font-medium text-muted-foreground">
                        {t("extensions.proRequired")}
                      </span>
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-4">
                {/* Tab selector */}
                <div className="flex gap-2 border-b">
                  <button
                    type="button"
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === "extensions"
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => {
                      setActiveTab("extensions");
                    }}
                    disabled={limitedMode}
                  >
                    {t("extensions.extensionsTab")}
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === "groups"
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => {
                      setActiveTab("groups");
                      // Returning to groups tab clears any leftover detail
                      // selection so the user starts fresh.
                      setRenamingGroup(false);
                    }}
                    disabled={limitedMode}
                  >
                    {t("extensions.groupsTab")}
                  </button>
                </div>

                {/* Notice */}
                <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                  {t("extensions.managedNotice")}
                </div>

                {activeTab === "extensions" && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <Label>{t("extensions.extensionsTab")}</Label>
                      <div>
                        <label htmlFor="ext-file-input">
                          <RippleButton
                            size="sm"
                            className="flex gap-2 items-center"
                            disabled={limitedMode}
                            onClick={() =>
                              document.getElementById("ext-file-input")?.click()
                            }
                          >
                            <LuUpload className="w-4 h-4" />
                            {t("extensions.upload")}
                          </RippleButton>
                        </label>
                        <input
                          id="ext-file-input"
                          type="file"
                          accept=".xpi,.crx,.zip"
                          className="hidden"
                          onChange={handleFileSelect}
                          disabled={limitedMode}
                        />
                      </div>
                    </div>

                    {/* Upload form */}
                    {showUploadForm && pendingFile && (
                      <div className="space-y-3 rounded-md border p-3">
                        <div className="text-sm text-muted-foreground">
                          {t("extensions.selectedFile")}:{" "}
                          <span className="font-medium text-foreground">
                            {pendingFile.name}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <Input
                            value={extensionName}
                            onChange={(e) => {
                              setExtensionName(e.target.value);
                            }}
                            placeholder={t("extensions.namePlaceholder")}
                            className="flex-1"
                          />
                          <RippleButton
                            size="sm"
                            onClick={() => void handleUpload()}
                            disabled={isUploading || !extensionName.trim()}
                          >
                            {isUploading
                              ? t("common.buttons.loading")
                              : t("common.buttons.add")}
                          </RippleButton>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setShowUploadForm(false);
                              setPendingFile(null);
                              setExtensionName("");
                            }}
                          >
                            {t("common.buttons.cancel")}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Extensions list (inline-edit on Pencil click) */}
                    {isLoading ? (
                      <div className="text-sm text-muted-foreground">
                        {t("common.buttons.loading")}
                      </div>
                    ) : extensions.length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        {t("extensions.empty")}
                      </div>
                    ) : (
                      <div className="border rounded-md max-h-[400px] overflow-y-auto">
                        {extensions.map((ext) => {
                          const syncDot = getSyncStatusDot(
                            ext,
                            extSyncStatus[ext.id],
                            t,
                          );
                          const isInlineEditing = inlineEditingExtId === ext.id;
                          return (
                            <div
                              key={ext.id}
                              className="border-b last:border-b-0"
                            >
                              <div className="flex items-center gap-2 px-3 py-2">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div
                                      className={`w-2 h-2 rounded-full shrink-0 ${syncDot.color} ${
                                        syncDot.animate ? "animate-pulse" : ""
                                      }`}
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{syncDot.tooltip}</p>
                                  </TooltipContent>
                                </Tooltip>
                                {renderExtensionIcon(ext, "sm")}
                                {isInlineEditing ? (
                                  <Input
                                    autoFocus
                                    value={inlineEditName}
                                    onChange={(e) => {
                                      setInlineEditName(e.target.value);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        void handleSaveInlineExtension();
                                      } else if (e.key === "Escape") {
                                        handleCancelInlineExtension();
                                      }
                                    }}
                                    placeholder={t(
                                      "extensions.namePlaceholder",
                                    )}
                                    className="h-7 text-sm flex-1 max-w-[260px]"
                                  />
                                ) : (
                                  <span className="text-sm font-medium truncate min-w-0 flex-1 max-w-[180px]">
                                    {ext.name}
                                  </span>
                                )}
                                <Badge
                                  variant="outline"
                                  className="shrink-0 text-xs"
                                >
                                  .{ext.file_type}
                                </Badge>
                                {renderCompatIcons(ext.browser_compatibility)}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex items-center shrink-0">
                                      <Checkbox
                                        checked={ext.sync_enabled}
                                        onCheckedChange={() =>
                                          void handleToggleExtSync(ext)
                                        }
                                        disabled={isTogglingExtSync[ext.id]}
                                      />
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>
                                      {ext.sync_enabled
                                        ? t("extensions.syncDisableTooltip")
                                        : t("extensions.syncEnableTooltip")}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                                <div className="flex gap-0.5 ml-auto shrink-0">
                                  {isInlineEditing ? (
                                    <>
                                      <RippleButton
                                        size="sm"
                                        className="h-7 px-2 text-xs"
                                        onClick={() =>
                                          void handleSaveInlineExtension()
                                        }
                                        disabled={!inlineEditName.trim()}
                                      >
                                        {t("common.buttons.save")}
                                      </RippleButton>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 px-2 text-xs"
                                        onClick={handleCancelInlineExtension}
                                      >
                                        {t("common.buttons.cancel")}
                                      </Button>
                                    </>
                                  ) : (
                                    <>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 w-7 p-0"
                                            onClick={() => {
                                              setInlineEditingExtId(ext.id);
                                              setInlineEditName(ext.name);
                                              setInlineEditFile(null);
                                            }}
                                          >
                                            <LuPencil className="w-3.5 h-3.5" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          {t("extensions.editExtension")}
                                        </TooltipContent>
                                      </Tooltip>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 w-7 p-0"
                                            onClick={() => {
                                              setExtensionToDelete(ext);
                                            }}
                                          >
                                            <LuTrash2 className="w-3.5 h-3.5" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          {t("extensions.delete")}
                                        </TooltipContent>
                                      </Tooltip>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Inline metadata + re-upload panel */}
                              {isInlineEditing && (
                                <div className="px-3 pb-3 space-y-3 bg-muted/30">
                                  <div className="rounded-md border bg-background p-3 space-y-2">
                                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                                      {t("extensions.metadata")}
                                    </Label>
                                    <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-sm">
                                      {ext.version && (
                                        <>
                                          <span className="text-muted-foreground">
                                            {t("extensions.version")}
                                          </span>
                                          <span>{ext.version}</span>
                                        </>
                                      )}
                                      {ext.author && (
                                        <>
                                          <span className="text-muted-foreground">
                                            {t("extensions.author")}
                                          </span>
                                          <span>{ext.author}</span>
                                        </>
                                      )}
                                      {ext.description && (
                                        <>
                                          <span className="text-muted-foreground">
                                            {t("common.labels.description")}
                                          </span>
                                          <span className="line-clamp-3">
                                            {ext.description}
                                          </span>
                                        </>
                                      )}
                                      <span className="text-muted-foreground">
                                        {t("extensions.compatibility.label")}
                                      </span>
                                      <div className="flex items-center gap-1">
                                        {renderCompatIcons(
                                          ext.browser_compatibility,
                                        )}
                                      </div>
                                      <span className="text-muted-foreground">
                                        {t("common.labels.type")}
                                      </span>
                                      <span>.{ext.file_type}</span>
                                      {ext.homepage_url && (
                                        <>
                                          <span className="text-muted-foreground">
                                            {t("extensions.homepage")}
                                          </span>
                                          <a
                                            href={ext.homepage_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline flex items-center gap-1 truncate"
                                          >
                                            <span className="truncate">
                                              {ext.homepage_url}
                                            </span>
                                            <LuExternalLink className="w-3 h-3 shrink-0" />
                                          </a>
                                        </>
                                      )}
                                      {!ext.version &&
                                        !ext.author &&
                                        !ext.description &&
                                        !ext.homepage_url && (
                                          <span className="col-span-2 text-muted-foreground text-xs">
                                            {t("extensions.noMetadata")}
                                          </span>
                                        )}
                                    </div>
                                  </div>

                                  <div className="space-y-2">
                                    <Label className="text-xs">
                                      {t("extensions.reupload")}
                                    </Label>
                                    <div className="flex gap-2 items-center">
                                      <RippleButton
                                        size="sm"
                                        variant="outline"
                                        onClick={() =>
                                          document
                                            .getElementById(
                                              `ext-inline-file-${ext.id}`,
                                            )
                                            ?.click()
                                        }
                                      >
                                        <LuUpload className="w-3 h-3 mr-1" />
                                        {t("extensions.selectFile")}
                                      </RippleButton>
                                      <input
                                        id={`ext-inline-file-${ext.id}`}
                                        type="file"
                                        accept=".xpi,.crx,.zip"
                                        className="hidden"
                                        onChange={handleInlineExtFileSelect}
                                      />
                                      {inlineEditFile && (
                                        <span className="text-xs text-muted-foreground truncate max-w-[220px]">
                                          {inlineEditFile.name}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "groups" && (
                  <div className="space-y-4">
                    {/* Master-detail: either show list, or detail of selected group */}
                    {selectedGroup === null ? (
                      <>
                        <div className="flex justify-between items-center">
                          <Label>{t("extensions.groupsTab")}</Label>
                          <RippleButton
                            size="sm"
                            onClick={() => {
                              setShowCreateGroup(true);
                            }}
                            className="flex gap-2 items-center"
                            disabled={limitedMode}
                          >
                            <GoPlus className="w-4 h-4" />
                            {t("extensions.createGroup")}
                          </RippleButton>
                        </div>

                        {/* Inline create form */}
                        {showCreateGroup && (
                          <div className="flex gap-2 items-center">
                            <Input
                              autoFocus
                              value={newGroupName}
                              onChange={(e) => {
                                setNewGroupName(e.target.value);
                              }}
                              placeholder={t("extensions.groupNamePlaceholder")}
                              className="flex-1"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  void handleCreateGroup();
                                } else if (e.key === "Escape") {
                                  setShowCreateGroup(false);
                                  setNewGroupName("");
                                }
                              }}
                            />
                            <RippleButton
                              size="sm"
                              onClick={() => void handleCreateGroup()}
                              disabled={!newGroupName.trim()}
                            >
                              {t("common.buttons.create")}
                            </RippleButton>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setShowCreateGroup(false);
                                setNewGroupName("");
                              }}
                            >
                              {t("common.buttons.cancel")}
                            </Button>
                          </div>
                        )}

                        {/* Groups list */}
                        {extensionGroups.length === 0 ? (
                          <div className="text-sm text-muted-foreground">
                            {t("extensions.noGroups")}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {extensionGroups.map((group) => {
                              const groupExts = group.extension_ids
                                .map((id) =>
                                  extensions.find((e) => e.id === id),
                                )
                                .filter(Boolean) as Extension[];
                              const visibleExts = groupExts.slice(
                                0,
                                MAX_VISIBLE_ICONS,
                              );
                              const overflowCount =
                                groupExts.length - MAX_VISIBLE_ICONS;
                              const groupSyncDot = getSyncStatusDot(
                                group,
                                extSyncStatus[group.id],
                                t,
                              );

                              return (
                                <button
                                  key={group.id}
                                  type="button"
                                  className="w-full text-left flex items-center gap-3 rounded-md border px-3 py-2 hover:bg-muted/50 transition-colors"
                                  onClick={() => {
                                    setSelectedGroupId(group.id);
                                    setRenamingGroup(false);
                                  }}
                                >
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div
                                        className={`w-2 h-2 rounded-full shrink-0 ${groupSyncDot.color} ${
                                          groupSyncDot.animate
                                            ? "animate-pulse"
                                            : ""
                                        }`}
                                      />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>{groupSyncDot.tooltip}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                  <span className="font-medium text-sm truncate min-w-0">
                                    {group.name}
                                  </span>

                                  <div className="flex items-center gap-1 shrink-0">
                                    {visibleExts.map((ext) => (
                                      <Tooltip key={ext.id}>
                                        <TooltipTrigger asChild>
                                          <span className="inline-flex">
                                            {renderExtensionIcon(ext, "sm")}
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          {ext.name}
                                        </TooltipContent>
                                      </Tooltip>
                                    ))}
                                    {overflowCount > 0 && (
                                      <Badge
                                        variant="secondary"
                                        className="text-xs h-5 px-1.5 shrink-0"
                                      >
                                        +{overflowCount}
                                      </Badge>
                                    )}
                                    {groupExts.length === 0 && (
                                      <span className="text-xs text-muted-foreground">
                                        {t("extensions.noExtensionsInGroup")}
                                      </span>
                                    )}
                                  </div>

                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="flex items-center shrink-0 ml-auto">
                                        <Checkbox
                                          checked={group.sync_enabled}
                                          onCheckedChange={() =>
                                            void handleToggleGroupSync(group)
                                          }
                                          disabled={
                                            isTogglingGroupSync[group.id]
                                          }
                                          onClick={(e) => {
                                            e.stopPropagation();
                                          }}
                                          onKeyDown={(e) => {
                                            e.stopPropagation();
                                          }}
                                        />
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>
                                        {group.sync_enabled
                                          ? t("extensions.syncDisableTooltip")
                                          : t("extensions.syncEnableTooltip")}
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>

                                  <div className="flex gap-1 shrink-0">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setGroupToDelete(group);
                                          }}
                                        >
                                          <LuTrash2 className="w-4 h-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {t("extensions.deleteGroup")}
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </>
                    ) : (
                      // Group detail pane (replaces the previously nested edit
                      // dialog). Lives in the same Dialog — no second modal.
                      <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 flex items-center gap-1"
                            onClick={() => {
                              setSelectedGroupId(null);
                              setRenamingGroup(false);
                            }}
                          >
                            <LuChevronLeft className="w-4 h-4" />
                            {t("extensions.management.detail.backToGroups")}
                          </Button>
                          <span className="text-sm text-muted-foreground">
                            {t(
                              "extensions.management.detail.editingGroupBreadcrumb",
                            )}
                          </span>
                        </div>

                        {/* Inline rename row */}
                        <div className="space-y-2">
                          <Label>{t("common.labels.name")}</Label>
                          {renamingGroup ? (
                            <div className="flex gap-2 items-center">
                              <Input
                                autoFocus
                                value={renameGroupValue}
                                onChange={(e) => {
                                  setRenameGroupValue(e.target.value);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    void handleSaveGroupRename();
                                  } else if (e.key === "Escape") {
                                    setRenamingGroup(false);
                                  }
                                }}
                                placeholder={t(
                                  "extensions.groupNamePlaceholder",
                                )}
                                className="flex-1"
                              />
                              <RippleButton
                                size="sm"
                                onClick={() => void handleSaveGroupRename()}
                                disabled={!renameGroupValue.trim()}
                              >
                                {t("common.buttons.save")}
                              </RippleButton>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setRenamingGroup(false);
                                }}
                              >
                                {t("common.buttons.cancel")}
                              </Button>
                            </div>
                          ) : (
                            <div className="flex gap-2 items-center">
                              <div className="flex-1 px-3 py-2 rounded-md border bg-muted/30 text-sm font-medium">
                                {selectedGroup.name}
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setRenamingGroup(true);
                                  setRenameGroupValue(selectedGroup.name);
                                }}
                              >
                                <LuPencil className="w-3.5 h-3.5 mr-1" />
                                {t("common.buttons.edit")}
                              </Button>
                            </div>
                          )}
                        </div>

                        {/* Add extension */}
                        {extensionsNotInSelectedGroup.length > 0 && (
                          <div className="space-y-2">
                            <Label>{t("extensions.addToGroup")}</Label>
                            <Select
                              value=""
                              onValueChange={(extId) => {
                                void handleAddExtensionToSelectedGroup(extId);
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={t("extensions.addToGroup")}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {extensionsNotInSelectedGroup.map((ext) => (
                                  <SelectItem key={ext.id} value={ext.id}>
                                    <div className="flex items-center gap-2">
                                      {renderExtensionIcon(ext, "sm")}
                                      {ext.name}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {/* Extensions in this group */}
                        <div className="space-y-2">
                          <Label>{t("extensions.groupExtensions")}</Label>
                          {selectedGroupExtensions.length === 0 ? (
                            <div className="text-sm text-muted-foreground py-2">
                              {t("extensions.noExtensionsInGroup")}
                            </div>
                          ) : (
                            <div className="space-y-1 max-h-[260px] overflow-y-auto">
                              {selectedGroupExtensions.map((ext) => (
                                <div
                                  key={ext.id}
                                  className="flex items-center gap-2 rounded-md border px-2 py-1.5"
                                >
                                  {renderExtensionIcon(ext, "sm")}
                                  <span className="text-sm flex-1 truncate min-w-0">
                                    {ext.name}
                                  </span>
                                  {renderCompatIcons(ext.browser_compatibility)}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0 shrink-0"
                                    onClick={() => {
                                      void handleRemoveExtensionFromSelectedGroup(
                                        ext.id,
                                      );
                                    }}
                                  >
                                    <LuTrash2 className="w-3 h-3" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>

          <DialogFooter>
            <RippleButton variant="outline" onClick={onClose}>
              {t("common.buttons.close")}
            </RippleButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete extension confirmation */}
      <DeleteConfirmationDialog
        isOpen={extensionToDelete !== null}
        onClose={() => {
          setExtensionToDelete(null);
        }}
        onConfirm={handleDeleteExtension}
        title={t("extensions.deleteConfirmTitle")}
        description={t("extensions.deleteConfirmDescription", {
          name: extensionToDelete?.name ?? "",
        })}
        isLoading={isDeleting}
      />

      {/* Delete group confirmation */}
      <DeleteConfirmationDialog
        isOpen={groupToDelete !== null}
        onClose={() => {
          setGroupToDelete(null);
        }}
        onConfirm={handleDeleteGroup}
        title={t("extensions.deleteGroupConfirmTitle")}
        description={t("extensions.deleteGroupConfirmDescription", {
          name: groupToDelete?.name ?? "",
        })}
        isLoading={isDeleting}
      />
    </>
  );
}
