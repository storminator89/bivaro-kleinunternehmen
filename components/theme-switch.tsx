"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Helles Farbschema aktivieren" : "Dunkles Farbschema aktivieren"}
      title={isDark ? "Helles Farbschema" : "Dunkles Farbschema"}
      className="relative rounded-full"
    >
      <Sun className="size-5 rotate-0 opacity-100 transition-[opacity,transform] duration-150 dark:-rotate-90 dark:opacity-0" />
      <Moon className="absolute size-5 rotate-90 opacity-0 transition-[opacity,transform] duration-150 dark:rotate-0 dark:opacity-100" />
    </Button>
  )
}
