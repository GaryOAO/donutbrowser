"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GoPlus } from "react-icons/go";
import { toast } from "sonner";
import { LoadingButton } from "@/components/loading-button";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BrowserProfile, ExtensionGroup, ProfileGroup } from "@/types";
import { RippleButton } from "./ui/ripple";

export type BulkAssignKind = "group" | "extension-group";

interface BulkAssignDialogProps {
  kind: BulkAssignKind;
  isOpen: boolean;
  onClose: () => void;
  selectedProfiles: string[];
  onAssignmentComplete: () => void;
  profiles?: BrowserProfile[];
}

type AssignableItem = { id: string; name: string };

const MAX_VISIBLE_PROFILES = 5;
const NONE_VALUE = "__none__";

export function BulkAssignDialog({
  kind,
  isOpen,
  onClose,
  selectedProfiles,
  onAssignmentComplete,
  profiles = [],
}: BulkAssignDialogProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<AssignableItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline-create state (replaces nested CreateGroupDialog)
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (kind === "group") {
        const list = await invoke<ProfileGroup[]>("get_profile_groups");
        setItems(list.map((g) => ({ id: g.id, name: g.name })));
      } else {
        const list = await invoke<ExtensionGroup[]>("list_extension_groups");
        setItems(list.map((g) => ({ id: g.id, name: g.name })));
      }
    } catch (err) {
      console.error("Failed to load items:", err);
      setError(
        err instanceof Error
          ? err.message
          : kind === "group"
            ? t("groupManagement.loadFailed")
            : t("extensions.loadGroupsFailed"),
      );
    } finally {
      setIsLoading(false);
    }
  }, [kind, t]);

  // Determine common pre-selected value across the selected profiles
  const commonCurrentId = useMemo<string | null | "mixed">(() => {
    if (selectedProfiles.length === 0) return null;
    const ids = selectedProfiles
      .map((pid) => profiles.find((p) => p.id === pid))
      .filter(Boolean) as BrowserProfile[];
    if (ids.length === 0) return null;
    const getCurrent = (p: BrowserProfile): string | null => {
      if (kind === "group") return p.group_id ?? null;
      return p.extension_group_id ?? null;
    };
    const first = getCurrent(ids[0]);
    for (const p of ids) {
      if (getCurrent(p) !== first) return "mixed";
    }
    return first;
  }, [selectedProfiles, profiles, kind]);

  const handleAssign = useCallback(async () => {
    setIsAssigning(true);
    setError(null);
    try {
      if (kind === "group") {
        await invoke("assign_profiles_to_group", {
          profileIds: selectedProfiles,
          groupId: selectedItemId,
        });
        const groupName = selectedItemId
          ? (items.find((g) => g.id === selectedItemId)?.name ??
            t("groups.unknownGroup"))
          : t("groups.defaultGroup");
        toast.success(
          t("groups.assignSuccess", {
            count: selectedProfiles.length,
            group: groupName,
          }),
        );
      } else {
        // No batch tauri command — invoke in parallel
        await Promise.all(
          selectedProfiles.map((profileId) =>
            invoke("assign_extension_group_to_profile", {
              profileId,
              extensionGroupId: selectedItemId,
            }),
          ),
        );
        toast.success(t("extensions.assignSuccess"));
      }
      onAssignmentComplete();
      onClose();
    } catch (err) {
      console.error("Failed to assign:", err);
      const errorMessage =
        err instanceof Error
          ? err.message
          : kind === "group"
            ? t("groupAssignment.failedFallback")
            : t("extensions.assignGroupFailed");
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsAssigning(false);
    }
  }, [
    kind,
    selectedProfiles,
    selectedItemId,
    items,
    onAssignmentComplete,
    onClose,
    t,
  ]);

  const handleCreateInline = useCallback(async () => {
    const name = newItemName.trim();
    if (!name) return;
    setIsCreating(true);
    setError(null);
    try {
      if (kind === "group") {
        const created = await invoke<ProfileGroup>("create_profile_group", {
          name,
        });
        setItems((prev) => [...prev, { id: created.id, name: created.name }]);
        setSelectedItemId(created.id);
      } else {
        const created = await invoke<ExtensionGroup>("create_extension_group", {
          name,
        });
        setItems((prev) => [...prev, { id: created.id, name: created.name }]);
        setSelectedItemId(created.id);
      }
      setShowCreateForm(false);
      setNewItemName("");
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : kind === "group"
            ? t("groups.createFailed")
            : t("extensions.groupCreateSuccess");
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsCreating(false);
    }
  }, [kind, newItemName, t]);

  useEffect(() => {
    if (isOpen) {
      void loadItems();
      setError(null);
      setShowCreateForm(false);
      setNewItemName("");
    }
  }, [isOpen, loadItems]);

  // Pre-select based on commonCurrentId once items are loaded
  useEffect(() => {
    if (!isOpen) return;
    if (commonCurrentId === "mixed") {
      setSelectedItemId(null);
    } else {
      setSelectedItemId(commonCurrentId ?? null);
    }
  }, [isOpen, commonCurrentId]);

  const visibleProfiles = selectedProfiles.slice(0, MAX_VISIBLE_PROFILES);
  const overflowCount = selectedProfiles.length - MAX_VISIBLE_PROFILES;

  const title =
    kind === "group" ? t("groupAssignment.title") : t("extensions.assignTitle");
  const description =
    kind === "group"
      ? selectedProfiles.length === 1
        ? t("groupAssignment.description_one", {
            count: selectedProfiles.length,
          })
        : t("groupAssignment.description_other", {
            count: selectedProfiles.length,
          })
      : t("extensions.assignDescription", {
          count: selectedProfiles.length,
        });

  const selectLabel =
    kind === "group"
      ? t("groupAssignment.assignGroupLabel")
      : `${t("extensions.extensionGroup")}:`;

  const noneLabel =
    kind === "group"
      ? t("groups.defaultGroupNoGroup")
      : t("extensions.noGroup");

  const selectValue = selectedItemId ?? NONE_VALUE;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("bulkAssign.selectedProfilesLabel")}</Label>
            <div className="p-3 bg-muted rounded-md max-h-32 overflow-y-auto">
              <ul className="text-sm space-y-1">
                {visibleProfiles.map((profileId) => {
                  const profile = profiles.find((p) => p.id === profileId);
                  const displayName = profile ? profile.name : profileId;
                  return (
                    <li key={profileId} className="truncate">
                      &bull; {displayName}
                    </li>
                  );
                })}
                {overflowCount > 0 && (
                  <li className="text-muted-foreground italic">
                    {t("bulkAssign.moreProfiles", { count: overflowCount })}
                  </li>
                )}
              </ul>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="bulk-assign-select">{selectLabel}</Label>
              <RippleButton
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setShowCreateForm((prev) => !prev);
                }}
              >
                <GoPlus className="mr-1 w-3 h-3" />
                {t("bulkAssign.createNew")}
              </RippleButton>
            </div>

            {showCreateForm && (
              <div className="flex gap-2 items-center">
                <Input
                  autoFocus
                  value={newItemName}
                  onChange={(e) => {
                    setNewItemName(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newItemName.trim()) {
                      void handleCreateInline();
                    } else if (e.key === "Escape") {
                      setShowCreateForm(false);
                      setNewItemName("");
                    }
                  }}
                  placeholder={t("bulkAssign.newNamePlaceholder")}
                  className="flex-1"
                />
                <RippleButton
                  size="sm"
                  onClick={() => void handleCreateInline()}
                  disabled={isCreating || !newItemName.trim()}
                >
                  {t("common.buttons.create")}
                </RippleButton>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewItemName("");
                  }}
                >
                  {t("common.buttons.cancel")}
                </Button>
              </div>
            )}

            {commonCurrentId === "mixed" && (
              <div className="text-xs text-muted-foreground">
                {t("bulkAssign.mixedSelection")}
              </div>
            )}

            {isLoading ? (
              <div className="text-sm text-muted-foreground">
                {t("common.buttons.loading")}
              </div>
            ) : (
              <Select
                value={selectValue}
                onValueChange={(value) => {
                  setSelectedItemId(value === NONE_VALUE ? null : value);
                }}
              >
                <SelectTrigger id="bulk-assign-select">
                  <SelectValue
                    placeholder={t("bulkAssign.selectPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>{noneLabel}</SelectItem>
                  {items.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
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
            disabled={isLoading}
          >
            {t("bulkAssign.applyToAll")}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
