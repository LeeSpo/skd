import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils";

const panelHeaderVariants = cva(
  "panel-header flex shrink-0 items-center gap-1 px-2",
  {
    variants: {
      density: {
        default: "py-1",
        dense: "py-px",
      },
      tone: {
        panel: "",
        sidebar: "border-sidebar-border",
      },
    },
    defaultVariants: {
      density: "default",
      tone: "panel",
    },
  },
);

type PanelHeaderProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof panelHeaderVariants>;

function PanelHeader({
  className,
  density,
  tone,
  children,
  ...props
}: PanelHeaderProps) {
  return (
    <div
      data-slot="panel-header"
      className={cn(panelHeaderVariants({ density, tone }), className)}
      {...props}
    >
      {children}
    </div>
  );
}

const panelToolbarVariants = cva(
  "panel-toolbar flex shrink-0 items-center gap-0.5 px-1.5",
  {
    variants: {
      density: {
        default: "py-1",
        dense: "py-px",
      },
    },
    defaultVariants: {
      density: "default",
    },
  },
);

type PanelToolbarProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof panelToolbarVariants>;

function PanelToolbar({
  className,
  density,
  children,
  ...props
}: PanelToolbarProps) {
  return (
    <div
      data-slot="panel-toolbar"
      className={cn(panelToolbarVariants({ density }), className)}
      {...props}
    >
      {children}
    </div>
  );
}

function PanelSurfaceFallback() {
  return <div className="h-full w-full bg-background" />;
}

function ToolbarDivider({ className }: { className?: string }) {
  return (
    <div
      className={cn("mx-1 h-4 w-px shrink-0 bg-border/60", className)}
      aria-hidden="true"
    />
  );
}

export {
  PanelHeader,
  PanelToolbar,
  PanelSurfaceFallback,
  ToolbarDivider,
  panelHeaderVariants,
  panelToolbarVariants,
};