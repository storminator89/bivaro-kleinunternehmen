"use client";

import { Suspense } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { NavLinks } from "@/components/navigation/nav-links";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { CollapseButton } from "@/components/sidebar-collapse-button";
import { CommandPalette, CommandPaletteTrigger } from "@/components/command-palette";
import { UserMenu } from "@/components/user-menu";
import { ThemeToggle } from "@/components/theme-switch";
import { usePageTitle } from "@/hooks/use-page-title";

function PageHeading() {
  const title = usePageTitle();
  return <p className="app-page-title truncate text-foreground">{title}</p>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  // Öffentliche Seiten ohne Sidebar
  const publicPaths = ['/', '/login', '/register'];
  const isPublicPage = publicPaths.includes(pathname);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center" aria-busy="true">
        <div role="status" className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" aria-hidden="true" />
          <span className="sr-only">Anwendung wird geladen</span>
        </div>
      </div>
    );
  }

  if (!session || isPublicPage) {
    return (
      <div className="min-h-screen flex flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Zum Inhalt springen
        </a>
        <header className="sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-[90rem] items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center">
              <Link href="/" className="flex items-center">
                <Image
                  src="/Bivaro_Logo.png"
                  alt="Bivaro Logo"
                  width={106}
                  height={40}
                  className="h-9 w-auto dark:brightness-0 dark:invert"
                  unoptimized
                />
              </Link>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <ThemeToggle />
                <nav aria-label="Öffentliche Navigation" className="flex items-center gap-1.5 sm:gap-2">
                  {session ? (
                    <Button asChild>
                      <Link href="/dashboard">Dashboard</Link>
                    </Button>
                  ) : (
                    <>
                      <Button variant="ghost" asChild>
                        <Link href="/login">Anmelden</Link>
                      </Button>
                      <Button asChild>
                        <Link href="/register">Registrieren</Link>
                      </Button>
                    </>
                  )}
                </nav>
              </div>
            </div>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-grow bg-background outline-none">
          {children}
        </main>

        <footer className="border-t border-border/80 bg-background py-5">
          <div className="mx-auto flex w-full max-w-[90rem] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} Bivaro |
              Alle Beträge werden in Euro (€) angezeigt
            </p>
          </div>
        </footer>
      </div>
    );
  }

  // Eingeloggter Benutzer mit Sidebar
  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Zum Inhalt springen
      </a>

      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>

      {/* Sidebar for desktop */}
      <aside aria-label="Anwendungsnavigation" className="sticky top-0 hidden h-dvh w-64 flex-col border-r border-border/80 bg-card/70 lg:flex">
        <div className="sidebar-header relative flex items-center border-b border-border/80 px-5 py-4">
          <Link href="/dashboard" className="brand-link text-xl font-bold text-foreground">
            <Image
              src="/Bivaro_Logo.png"
              alt="Bivaro Logo"
              width={127}
              height={48}
              className="brand-full h-10 w-auto max-w-full object-contain dark:brightness-0 dark:invert"
              unoptimized
            />
            <Image
              src="/Bivaro_Logo.png"
              alt="Bivaro Logo kompakt"
              width={85}
              height={32}
              className="brand-compact h-8 w-auto max-w-full object-contain dark:brightness-0 dark:invert"
              unoptimized
            />
          </Link>
          <div className="absolute right-3 top-3">
            <CollapseButton />
          </div>
        </div>
        <nav aria-label="Hauptnavigation" className="flex-1 overflow-y-auto px-3 py-4">
          <NavLinks />
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* Desktop top bar */}
        <header className="sticky top-0 z-30 hidden border-b border-border/80 bg-background/90 backdrop-blur-xl lg:block">
          <div className="flex min-h-16 items-center justify-between gap-6 px-6 py-3 xl:px-10">
            <Suspense fallback={<div className="h-6 w-32 animate-pulse rounded bg-muted/60" />}>
              <PageHeading />
            </Suspense>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <Suspense fallback={null}>
                <CommandPaletteTrigger className="hidden w-full max-w-sm lg:inline-flex" />
              </Suspense>
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </header>

        {/* Mobile top bar */}
        <header className="sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur-xl lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Menü öffnen">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[min(20rem,calc(100vw-2rem))] p-0">
                  <div className="flex h-full flex-col bg-card">
                    <div className="border-b border-border/80 p-5 pb-4">
                      <Link href="/dashboard" className="flex items-center text-2xl font-bold text-foreground">
                        <Image
                          src="/Bivaro_Logo.png"
                          alt="Bivaro Logo"
                          width={127}
                          height={48}
                          className="h-10 w-auto dark:brightness-0 dark:invert"
                          unoptimized
                        />
                      </Link>
                    </div>
                    <nav aria-label="Mobile Hauptnavigation" className="flex-1 overflow-y-auto px-3 py-4">
                      <NavLinks />
                    </nav>
                  </div>
                </SheetContent>
              </Sheet>
              <Suspense fallback={null}>
                <PageHeading />
              </Suspense>
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-grow bg-background outline-none">
          <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6 sm:py-8 xl:px-10">
            {children}
          </div>
        </main>

        <footer className="border-t border-border/80 bg-background py-5">
          <div className="mx-auto w-full max-w-[90rem] px-4 sm:px-6 xl:px-10">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} Bivaro |
              Alle Beträge werden in Euro (€) angezeigt
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
