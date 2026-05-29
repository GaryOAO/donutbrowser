"use client";

import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatGroupShortcut,
  formatShortcut,
  SHORTCUTS,
  type ShortcutDef,
} from "@/lib/shortcuts";

interface GroupTarget {
  id: string;
  name: string;
}

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ordered list — first 9 entries display their Mod+digit binding. */
  groupTargets: GroupTarget[];
}

function Tokens({ tokens }: { tokens: string[] }) {
  return (
    <div className="flex items-center gap-1">
      {tokens.map((tok, i) => (
        <kbd
          key={i}
          className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded border border-border bg-muted text-[11px] font-medium text-foreground"
        >
          {tok}
        </kbd>
      ))}
    </div>
  );
}

function ShortcutTokens({ shortcut }: { shortcut: ShortcutDef }) {
  return <Tokens tokens={formatShortcut(shortcut)} />;
}

export function ShortcutsDialog({
  open,
  onOpenChange,
  groupTargets,
}: ShortcutsDialogProps) {
  const { t } = useTranslation();

  const sections: Array<{ key: ShortcutDef["group"]; titleKey: string }> = [
    { key: "navigation", titleKey: "commandPalette.groups.navigation" },
    { key: "actions", titleKey: "commandPalette.groups.actions" },
  ];

  const digitGroups = groupTargets.slice(0, 9);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("shortcutsDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("shortcutsDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 max-h-[60vh] overflow-y-auto">
          {sections.map(({ key, titleKey }) => {
            const items = SHORTCUTS.filter((s) => s.group === key);
            if (items.length === 0) return null;
            return (
              <section key={key} className="flex flex-col gap-2">
                <h2 className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t(titleKey)}
                </h2>
                <div className="rounded-md border bg-card divide-y divide-border">
                  {items.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-4 px-3 py-2"
                    >
                      <span className="text-sm">{t(s.labelKey)}</span>
                      <ShortcutTokens shortcut={s} />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}

          {digitGroups.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("commandPalette.groups.profileGroups")}
              </h2>
              <div className="rounded-md border bg-card divide-y divide-border">
                {digitGroups.map((target, i) => (
                  <div
                    key={target.id}
                    className="flex items-center justify-between gap-4 px-3 py-2"
                  >
                    <span className="text-sm">{target.name}</span>
                    <Tokens tokens={formatGroupShortcut(i + 1)} />
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
