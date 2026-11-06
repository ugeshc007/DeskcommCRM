"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Trash, Copy } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";

/** Removes only the selected draft item. Persistence still belongs to Save. */
export function CanvasDeleteControl({ kind, label, onDelete, onDuplicate, open: controlledOpen, onOpenChange }: {
  kind: "block" | "connection";
  label: string;
  onDelete: () => void;
  onDuplicate?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const title = kind === "block" ? t("Delete selected block") : t("Delete selected connection");
  return (
    <>
      <div className="absolute top-3 right-3 z-20 flex max-w-[calc(100%-24px)] items-center gap-2 rounded-lg border border-border bg-surface p-1.5 shadow-sm">
        <span className="min-w-0 truncate px-2 text-xs" title={label}>{label}</span>
        {onDuplicate && <Button type="button" variant="ghost" size="sm" onClick={onDuplicate}><Copy size={16} aria-hidden />{t("Duplicate")}</Button>}
        <Button type="button" variant="ghost" size="icon" className="shrink-0 text-error hover:text-error" aria-label={title} title={title} onClick={() => setOpen(true)}>
          <Trash size={18} aria-hidden />
        </Button>
      </div>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-[calc(100vw-32px)] bg-surface text-text sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{title}?</AlertDialogTitle>
            <AlertDialogDescription className="break-words text-text-muted">
              {label}. {kind === "block"
                ? t("This removes the block and its attached connections from the draft.")
                : t("This removes only the connection. Both blocks will remain.")}
              {" "}{t("Your changes are not saved or published automatically.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-error text-white hover:bg-error" onClick={() => {
              onDelete();
              toast.success(t("Removed from draft. Save to keep your changes."));
            }}>{t("Delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
