"use client";

import * as React from "react";
import { GripVerticalIcon } from "lucide-react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "./utils";

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) {
  return (
    <ResizablePrimitive.PanelGroup
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

function ResizablePanel({
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Panel>) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

const dividerToneClasses = {
  default: "before:bg-transparent hover:before:bg-primary active:before:bg-primary data-[resize-handle-state=drag]:before:bg-primary focus-visible:before:bg-primary",
  panel: "before:bg-panel-border hover:before:bg-primary active:before:bg-primary data-[resize-handle-state=drag]:before:bg-primary focus-visible:before:bg-primary",
  sidebar: "before:bg-sidebar-border hover:before:bg-primary active:before:bg-primary data-[resize-handle-state=drag]:before:bg-primary focus-visible:before:bg-primary",
} as const;

function ResizableHandle({
  withHandle,
  dividerTone = "default",
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean;
  dividerTone?: keyof typeof dividerToneClasses;
}) {
  return (
    <ResizablePrimitive.PanelResizeHandle
      data-slot="resizable-handle"
      className={cn(
        // Zero layout footprint — panels sit flush; hit area extends via ::after
        "group relative flex shrink-0 items-center justify-center overflow-visible",
        "w-0",
        "after:absolute after:inset-y-0 after:left-1/2 after:z-10 after:w-4 after:-translate-x-1/2 after:content-['']",
        // Visible divider on hover/drag
        "before:absolute before:inset-y-0 before:left-1/2 before:z-20 before:w-px before:-translate-x-1/2",
        "before:transition-colors before:duration-150",
        dividerToneClasses[dividerTone],
        "focus-visible:outline-hidden",
        // Vertical resize overrides
        "data-[panel-group-direction=vertical]:h-0 data-[panel-group-direction=vertical]:w-full",
        "data-[panel-group-direction=vertical]:after:inset-x-0 data-[panel-group-direction=vertical]:after:inset-y-auto",
        "data-[panel-group-direction=vertical]:after:top-1/2 data-[panel-group-direction=vertical]:after:left-0",
        "data-[panel-group-direction=vertical]:after:h-4 data-[panel-group-direction=vertical]:after:w-full",
        "data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0",
        "data-[panel-group-direction=vertical]:before:inset-x-0 data-[panel-group-direction=vertical]:before:inset-y-auto",
        "data-[panel-group-direction=vertical]:before:top-1/2 data-[panel-group-direction=vertical]:before:left-0",
        "data-[panel-group-direction=vertical]:before:h-px data-[panel-group-direction=vertical]:before:w-full",
        "data-[panel-group-direction=vertical]:before:-translate-y-1/2 data-[panel-group-direction=vertical]:before:translate-x-0",
        "[&[data-panel-group-direction=vertical]>div]:rotate-90",
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div className="bg-border z-10 flex h-4 w-3 items-center justify-center rounded-xs border">
          <GripVerticalIcon className="size-2.5" />
        </div>
      )}
    </ResizablePrimitive.PanelResizeHandle>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
