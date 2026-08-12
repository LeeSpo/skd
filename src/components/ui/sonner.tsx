"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, toast, useSonner, type ToastT, type ToasterProps } from "sonner";

import {
  APP_SETTINGS_CHANGED_EVENT,
  APP_SETTINGS_STORAGE_KEY,
} from "@/lib/keyboard-shortcuts";

const DEFAULT_TOAST_DURATION_MS = 3000;
const INTERACTIVE_TOAST_TARGET_SELECTOR = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[role='button']",
  "[role='link']",
].join(",");

function loadNotificationsEnabled(): boolean {
  try {
    const savedSettings = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!savedSettings) return true;

    const parsed = JSON.parse(savedSettings) as { enableNotifications?: unknown };
    return parsed.enableNotifications !== false;
  } catch {
    return true;
  }
}

function getToastAtIndex(
  toasts: ToastT[],
  toastElement: HTMLElement,
  toasterId: string | undefined,
  defaultPosition: NonNullable<ToasterProps["position"]>,
): ToastT | undefined {
  const index = Number.parseInt(toastElement.dataset.index ?? "", 10);
  if (!Number.isInteger(index) || index < 0) return undefined;

  const renderedPosition = `${toastElement.dataset.yPosition}-${toastElement.dataset.xPosition}`;
  const matchingToasts = toasts
    .filter((item) => toasterId ? item.toasterId === toasterId : !item.toasterId)
    .filter((item) => (item.position ?? defaultPosition) === renderedPosition);

  return matchingToasts[index];
}

function InteractiveToaster({
  className,
  duration = DEFAULT_TOAST_DURATION_MS,
  id,
  position = "bottom-right",
  style,
  theme: themeProp,
  toastOptions,
  ...props
}: ToasterProps) {
  const { theme = "system" } = useTheme();
  const { toasts } = useSonner();
  const toasterRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    const toaster = toasterRef.current;
    if (!toaster) return;

    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      if (event.target.closest(INTERACTIVE_TOAST_TARGET_SELECTOR)) return;
      if (window.getSelection()?.toString()) return;

      const toastElement = event.target.closest<HTMLElement>("[data-sonner-toast]");
      if (
        !toastElement
        || !toaster.contains(toastElement)
        || toastElement.dataset.dismissible === "false"
        || toastElement.dataset.removed === "true"
      ) {
        return;
      }

      const selectedToast = getToastAtIndex(toasts, toastElement, id, position);
      if (selectedToast) toast.dismiss(selectedToast.id);
    };

    toaster.addEventListener("click", handleClick);
    return () => toaster.removeEventListener("click", handleClick);
  }, [id, position, toasts]);

  return (
    <Sonner
      ref={toasterRef}
      id={id}
      position={position}
      duration={duration}
      theme={(themeProp ?? theme) as ToasterProps["theme"]}
      className={["toaster group", className].filter(Boolean).join(" ")}
      toastOptions={{
        ...toastOptions,
        classNames: {
          toast: "cursor-pointer rounded-xl border border-border shadow-lg data-[dismissible=false]:cursor-default",
          success: "border-success/30",
          error: "border-destructive/30",
          warning: "border-warning/30",
          info: "border-primary/30",
          ...toastOptions?.classNames,
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "0.75rem",
          ...style,
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

const Toaster = ({ ...props }: ToasterProps) => {
  const [notificationsEnabled, setNotificationsEnabled] = React.useState(loadNotificationsEnabled);

  React.useEffect(() => {
    const refreshNotificationsEnabled = () => {
      setNotificationsEnabled(loadNotificationsEnabled());
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === APP_SETTINGS_STORAGE_KEY) {
        refreshNotificationsEnabled();
      }
    };

    window.addEventListener(APP_SETTINGS_CHANGED_EVENT, refreshNotificationsEnabled);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, refreshNotificationsEnabled);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  if (!notificationsEnabled) return null;
  return <InteractiveToaster {...props} />;
};

export { Toaster };
