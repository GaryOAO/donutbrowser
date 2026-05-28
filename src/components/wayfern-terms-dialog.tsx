"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";

export const WAYFERN_TERMS_DECLINED_KEY = "wayfern_terms_declined";

interface WayfernTermsDialogProps {
  isOpen: boolean;
  onAccepted: () => void;
}

export function WayfernTermsDialog({
  isOpen,
  onAccepted,
}: WayfernTermsDialogProps) {
  const { t } = useTranslation();
  const [isAccepting, setIsAccepting] = useState(false);

  const handleAccept = useCallback(async () => {
    setIsAccepting(true);
    try {
      await invoke("accept_wayfern_terms");
      // Clear any prior decline marker
      try {
        window.localStorage.removeItem(WAYFERN_TERMS_DECLINED_KEY);
      } catch {
        // ignore storage errors
      }
      showSuccessToast(t("wayfernTerms.acceptSuccess"));
      onAccepted();
    } catch (error) {
      console.error("Failed to accept terms:", error);
      showErrorToast(t("wayfernTerms.acceptFailed"), {
        description:
          error instanceof Error ? error.message : t("wayfernTerms.tryAgain"),
      });
    } finally {
      setIsAccepting(false);
    }
  }, [onAccepted, t]);

  const handleDecline = useCallback(() => {
    // TODO: replace with a `decline_wayfern_terms` Tauri command once the
    // backend exposes one. For now we persist the decision client-side so the
    // dialog does not re-open every launch.
    try {
      window.localStorage.setItem(WAYFERN_TERMS_DECLINED_KEY, "true");
    } catch {
      // ignore storage errors
    }
    showSuccessToast(t("wayfernTerms.declined"));
    onAccepted();
  }, [onAccepted, t]);

  return (
    <Dialog open={isOpen}>
      <DialogContent
        className="sm:max-w-lg"
        onEscapeKeyDown={(e) => {
          e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          e.preventDefault();
        }}
        onInteractOutside={(e) => {
          e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("wayfernTerms.title")}</DialogTitle>
          <DialogDescription>{t("wayfernTerms.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            {t("wayfernTerms.reviewLabel")}
          </p>
          <a
            href="https://wayfern.com/tos"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline text-sm font-medium block"
          >
            https://wayfern.com/tos
          </a>
          <p className="text-sm text-muted-foreground">
            {t("wayfernTerms.agreeNotice")}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={handleDecline}
            disabled={isAccepting}
          >
            {t("wayfernTerms.declineButton")}
          </Button>
          <LoadingButton onClick={handleAccept} isLoading={isAccepting}>
            {t("wayfernTerms.acceptButton")}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
