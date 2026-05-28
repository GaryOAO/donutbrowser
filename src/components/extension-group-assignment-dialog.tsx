"use client";

// Legacy shim: ExtensionGroupAssignmentDialog has been unified into BulkAssignDialog.
// Kept as a thin wrapper so existing imports in page.tsx continue to work
// until consumers migrate.

import { BulkAssignDialog } from "@/components/bulk-assign-dialog";
import type { BrowserProfile } from "@/types";

interface ExtensionGroupAssignmentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedProfiles: string[];
  onAssignmentComplete: () => void;
  profiles?: BrowserProfile[];
}

export function ExtensionGroupAssignmentDialog(
  props: ExtensionGroupAssignmentDialogProps,
) {
  return <BulkAssignDialog kind="extension-group" {...props} />;
}
