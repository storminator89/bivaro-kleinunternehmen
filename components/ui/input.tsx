import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-11 min-h-11 w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none transition-[color,border-color] duration-150 file:inline-flex file:h-8 file:border-0 file:bg-transparent file:text-sm file:font-medium hover:border-ring/60 active:border-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-input focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
        "aria-invalid:border-destructive aria-invalid:outline-2 aria-invalid:outline-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
