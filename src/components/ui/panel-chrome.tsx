import * as React from "react";
import { cn } from "./utils";

type PanelHeaderProps = React.HTMLAttributes<HTMLDivElement>;

function PanelHeader({ className, children, ...props }: PanelHeaderProps) {
  return (
    <div
      data-slot="panel-header"
      className={cn(
        "panel-header flex shrink-0 items-center gap-1 px-2 py-1",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

type PanelToolbarProps = React.HTMLAttributes<HTMLDivElement>;

function PanelToolbar({ className, children, ...props }: PanelToolbarProps) {
  return (
    <div
      data-slot="panel-toolbar"
      className={cn(
        "panel-toolbar flex shrink-0 items-center gap-0.5 px-1.5 py-1",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { PanelHeader, PanelToolbar };