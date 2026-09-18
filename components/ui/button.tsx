import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-[color,background-color,border-color,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring aria-invalid:border-destructive aria-invalid:outline-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[var(--shadow-card)] hover:bg-[var(--color-accent-hover)] active:translate-y-px",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 active:bg-destructive/80",
        outline:
          "border border-input bg-card hover:bg-secondary hover:text-secondary-foreground active:translate-y-px",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent active:translate-y-px",
        ghost:
          "hover:bg-secondary hover:text-secondary-foreground active:translate-y-px",
        link: "text-primary underline-offset-4 hover:underline active:text-[var(--color-accent-hover)]",
      },
      size: {
        default: "h-11 min-h-11 px-4 py-2 has-[>svg]:px-3",
        sm: "h-11 min-h-11 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-12 min-h-11 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-11 min-h-11 min-w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
