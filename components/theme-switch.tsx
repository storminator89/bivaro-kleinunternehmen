"use client"

import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const [mounted, setMounted] = useState(false)

  // The server cannot know the browser's stored/system theme. Keep the first
  // accessible label stable, then expose the actual action after hydration.
  useEffect(() => { setMounted(true) }, [])

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={mounted ? (isDark ? "Helles Farbschema aktivieren" : "Dunkles Farbschema aktivieren") : "Farbschema wechseln"}
      title={mounted ? (isDark ? "Helles Farbschema" : "Dunkles Farbschema") : "Farbschema wechseln"}
      className="relative rounded-full"
    >
      <Sun className="size-5 rotate-0 opacity-100 transition-[opacity,transform] duration-150 dark:-rotate-90 dark:opacity-0" />
      <Moon className="absolute size-5 rotate-90 opacity-0 transition-[opacity,transform] duration-150 dark:rotate-0 dark:opacity-100" />
    </Button>
  )
}
