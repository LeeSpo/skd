import * as React from "react";
import { cn } from "./utils";

export type StatusDotVariant =
  | "connected"
  | "connecting"
  | "disconnected"
  | "pending";

const variantClasses: Record<StatusDotVariant, string> = {
  connected: "bg-status-connected",
  connecting: "bg-status-connecting",
  disconnected: "bg-status-disconnected",
  pending: "bg-status-pending animate-pulse",
};

interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant: StatusDotVariant;
  size?: "sm" | "md";
}

function StatusDot({ variant, size = "sm", className, ...props }: StatusDotProps) {
  return (
    <span
      data-slot="status-dot"
      data-variant={variant}
      className={cn(
        "inline-block shrink-0 rounded-full",
        size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}

export { StatusDot };