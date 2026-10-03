import * as React from "react";

import { cn } from "./utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "resize-none border-input placeholder:text-muted-foreground aria-invalid:border-destructive flex field-sizing-content min-h-16 w-full rounded-md border-[0.5px] bg-input-background px-3 py-2 text-[13px] shadow-none transition-[color,background-color,box-shadow] motion-reduce:transition-none outline-none focus-visible:border-transparent focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
