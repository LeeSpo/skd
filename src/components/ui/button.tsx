import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium transition-[color,background-color,border-color,box-shadow,filter] motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:shadow-[var(--focus-ring)] aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover active:brightness-95",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:brightness-95",
        outline:
          "border-[0.5px] border-border bg-input-background text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground active:brightness-95",
        secondary:
          "border-[0.5px] border-border bg-white text-foreground shadow-sm hover:bg-neutral-50 active:brightness-95 dark:bg-white/10 dark:hover:bg-white/15",
        ghost:
          "hover:bg-accent hover:text-accent-foreground active:brightness-95",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-7 px-3 py-1 has-[>svg]:px-2.5",
        sm: "h-6 rounded-md gap-1.5 px-2.5 text-[12px] has-[>svg]:px-2",
        lg: "h-9 rounded-md px-5 has-[>svg]:px-4",
        icon: "size-7 rounded-md",
        toolbar: "size-7 gap-0 p-0 rounded-md",
        menubar: "size-7 gap-0 p-0 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> &
    VariantProps<typeof buttonVariants> & {
      asChild?: boolean;
    }
>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
      data-slot="button"
    />
  );
});

Button.displayName = "Button";

export { Button, buttonVariants };
