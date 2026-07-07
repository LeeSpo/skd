import { cn } from "@/components/ui/utils";

export const TAB_CONTENT_PANEL =
  "absolute inset-0 mt-0 data-[state=inactive]:hidden";

export const TAB_CONTENT_WRAPPER =
  "relative mt-0 min-h-0 flex-1 overflow-hidden bg-background";

export const TREE_INDENT_PX = 16;

export function panelColumn(className?: string) {
  return cn("flex h-full min-h-0 flex-col overflow-hidden", className);
}

export function tabContentPanel(className?: string) {
  return cn(TAB_CONTENT_PANEL, className);
}

export function tabContentWrapper(className?: string) {
  return cn(TAB_CONTENT_WRAPPER, className);
}

export function treeRowState(opts: {
  selected?: boolean;
  focused?: boolean;
  variant?: "sidebar" | "panel";
  className?: string;
}) {
  const { selected, focused, variant = "panel", className } = opts;
  return cn(
    "flex items-center rounded-sm",
    className,
    variant === "sidebar"
      ? cn("hover:bg-sidebar-accent", selected && "bg-sidebar-accent")
      : cn(
          selected && "bg-accent",
          focused && !selected && "bg-muted",
          !selected && !focused && "hover:bg-muted/60",
        ),
  );
}

export function treeIndent(depth: number, basePadding = 8, step = TREE_INDENT_PX) {
  return { paddingLeft: `${depth * step + basePadding}px` };
}