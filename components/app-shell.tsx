"use client";

import { Suspense, useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { ReviewLink as Link } from "@/components/purchases/review-link";
import { BivaroBrand } from "@/components/brand/bivaro-brand";
import { NavLinks } from "@/components/navigation/nav-links";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { CollapseButton } from "@/components/sidebar-collapse-button";
import { CommandPalette, CommandPaletteTrigger } from "@/components/command-palette";
import { UserMenu } from "@/components/user-menu";
import { ThemeToggle } from "@/components/theme-switch";
import { usePageTitle } from "@/hooks/use-page-title";
import publicStyles from "@/components/public-accounting/pilot-public.module.css";

function PageHeading() {
  const title = usePageTitle();
  return <p className="app-page-title flex min-w-0 items-center gap-3 text-foreground"><span className="hidden text-muted-foreground sm:inline">Bivaro</span><span aria-hidden="true" className="hidden text-muted-foreground/50 sm:inline">/</span><span className="truncate">{title}</span></p>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Öffentliche Seiten ohne Sidebar
  const publicPaths = ['/', '/login', '/register', '/help', '/help/access'];
  const isPublicPage = publicPaths.includes(pathname);

  // Public content must exist during the initial render so native hash links
  // can resolve before session hydration. Protected workspaces still wait.
  if (status === "loading" && !isPublicPage) {
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
        <header className={`${publicStyles.publicHeader} sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur-xl`}>
          <div className="mx-auto flex w-full max-w-[90rem] items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex w-full min-w-0 items-center justify-between gap-3">
              <Link href="/" aria-label="Bivaro Startseite" className="flex min-h-11 min-w-11 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&_.bivaro-wordmark]:hidden min-[400px]:[&_.bivaro-wordmark]:inline">
                <BivaroBrand className="brand-full" />
              </Link>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <ThemeToggle />
                <nav aria-label="Öffentliche Navigation" className="flex items-center gap-1 sm:gap-2">
                  <Button variant="ghost" asChild><Link href="/help" aria-current={pathname === "/help" ? "page" : undefined}>Hilfe</Link></Button>
                  {session ? (
                    <Button asChild>
                      <Link href="/dashboard">Dashboard</Link>
                    </Button>
                  ) : (
                    <>
                      <Button variant="ghost" asChild>
                        <Link href="/login">Anmelden</Link>
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
          <div className="mx-auto flex w-full max-w-[90rem] flex-wrap items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} Bivaro
            </p>
            <nav aria-label="Weitere Informationen" className="flex flex-wrap gap-4 text-sm text-muted-foreground"><a href="/help#umfang" className="underline underline-offset-4">Umfang und Grenzen</a><Link href="/help/access" className="underline underline-offset-4">Zugangshilfe</Link><a href="/help#angebot" className="underline underline-offset-4">Angebot und Quellcode</a></nav>
          </div>
        </footer>
      </div>
    );
  }

  // Eingeloggter Benutzer mit Sidebar
  return (
    <div className="flex min-h-screen app-workspace">
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
      <aside aria-label="Anwendungsnavigation" className="app-sidebar sticky top-0 hidden h-dvh shrink-0 w-64 flex-col border-r border-border/80 bg-card/70 lg:flex">
        <div className="sidebar-header relative flex items-center border-b border-border/80 px-5 py-4">
          <Link href="/dashboard" className="brand-link text-xl font-bold text-foreground">
            <BivaroBrand surface="sidebar" className="brand-full" />
            <BivaroBrand surface="sidebar" compact className="brand-compact" />
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
        <header className="app-topbar sticky top-0 z-30 hidden border-b border-border bg-card lg:block">
          <div className="flex h-16 items-center justify-between gap-6 px-6 xl:px-10">
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
        <header className="app-topbar sticky top-0 z-40 border-b border-border bg-card lg:hidden">
          <div className="flex h-16 items-center justify-between gap-2 px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Menü öffnen">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent aria-describedby={undefined} side="left" className="nav-sheet w-[min(20rem,calc(100vw-2rem))] p-0">
                  <SheetTitle className="sr-only">Bivaro Navigation</SheetTitle>
                  <div className="app-sidebar nav-drawer flex h-full flex-col">
                    <div className="border-b border-border/80 p-5 pb-4">
                      <Link href="/dashboard" className="flex items-center text-2xl font-bold text-foreground">
                        <BivaroBrand surface="sidebar" className="brand-full" />
                      </Link>
                    </div>
                    <nav aria-label="Mobile Hauptnavigation" className="flex-1 overflow-y-auto px-3 py-4">
                      <NavLinks allowCollapse={false} onNavigate={() => setMobileNavOpen(false)} />
                    </nav>
                  </div>
                </SheetContent>
              </Sheet>
              <Suspense fallback={null}>
                <PageHeading />
              </Suspense>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Suspense fallback={null}><CommandPaletteTrigger className="size-11 justify-center p-0 [&>span]:hidden [&>kbd]:hidden" /></Suspense>
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-grow bg-background outline-none">
          <div className="app-content mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6 sm:py-8 xl:px-10">
            {children}
          </div>
        </main>

        <footer className="border-t border-border/80 bg-background py-5">
          <div className="mx-auto w-full max-w-[90rem] px-4 sm:px-6 xl:px-10">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} Bivaro
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
