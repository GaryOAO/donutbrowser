"use client";

// Legacy shim: GroupAssignmentDialog has been unified into BulkAssignDialog.
// Kept as a thin wrapper so existing imports in page.tsx continue to work
// until consumers migrate.

import { BulkAssignDialog } from "@/components/bulk-assign-dialog";
import type { BrowserProfile } from "@/types";

interface GroupAssignmentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedProfiles: string[];
  onAssignmentComplete: () => void;
  profiles?: BrowserProfile[];
}

export function GroupAssignmentDialog(props: GroupAssignmentDialogProps) {
  return <BulkAssignDialog kind="group" {...props} />;
}
