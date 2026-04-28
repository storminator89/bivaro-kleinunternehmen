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
  return (
    <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">{title}</h1>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  // Öffentliche Seiten ohne Sidebar
  const publicPaths = ['/', '/login', '/register'];
  const isPublicPage = publicPaths.includes(pathname);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
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
        <header className="bg-background/80 backdrop-blur-sm border-b border-border sticky top-0 z-40">
          <div className="container mx-auto py-4 px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center">
              <Link href="/" className="flex items-center">
                <Image
                  src="/Bivaro_Logo.png"
                  alt="Bivaro Logo"
                  width={40}
                  height={40}
                  className="h-10 w-auto"
                  unoptimized
                />
              </Link>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                {session ? (
                  <Link href="/dashboard">
                    <Button>Dashboard</Button>
                  </Link>
                ) : (
                  <>
                    <Link href="/login">
                      <Button variant="ghost">Anmelden</Button>
                    </Link>
                    <Link href="/register">
                      <Button>Registrieren</Button>
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        <main id="main-content" className="flex-grow bg-background">
          {children}
        </main>

        <footer className="bg-background border-t border-border py-6">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-center text-muted-foreground text-sm">
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
      <aside className="hidden bg-background border-r border-border md:flex md:flex-col shadow-sm h-screen sticky top-0 w-64 transition-all duration-300">
        <div className="sidebar-header relative p-4 pb-4 flex items-center justify-center">
          <Link href="/dashboard" className="brand-link text-xl font-bold text-foreground">
            <Image
              src="/Bivaro_Logo.png"
              alt="Bivaro Logo"
              width={48}
              height={48}
              className="brand-full h-12 w-auto max-w-full object-contain"
              unoptimized
            />
            <Image
              src="/Bivaro_Logo.png"
              alt="Bivaro Logo kompakt"
              width={32}
              height={32}
              className="brand-compact h-8 w-auto max-w-full object-contain"
              unoptimized
            />
          </Link>
          <div className="absolute right-3 top-3">
            <CollapseButton />
          </div>
        </div>
        <nav className="flex-1 px-4 py-2 overflow-y-auto">
          <NavLinks />
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen w-full">
        {/* Desktop top bar */}
        <header className="hidden bg-background/80 backdrop-blur-md border-b border-border sticky top-0 z-30 md:block">
          <div className="flex items-center justify-between gap-4 px-6 py-3 lg:px-8">
            <Suspense fallback={<div className="h-6 w-32 animate-pulse rounded bg-muted/60" />}>
              <PageHeading />
            </Suspense>
            <div className="flex flex-1 items-center justify-end gap-2">
              <Suspense fallback={null}>
                <CommandPaletteTrigger className="hidden lg:inline-flex w-72" />
              </Suspense>
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </header>

        {/* Mobile top bar */}
        <header className="bg-background/80 backdrop-blur-sm border-b border-border md:hidden sticky top-0 z-40">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Menü öffnen">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-64 p-0">
                  <div className="flex flex-col h-full bg-background">
                    <div className="p-6 pb-4 border-b border-border">
                      <Link href="/dashboard" className="flex items-center text-2xl font-bold text-foreground">
                        <Image
                          src="/Bivaro_Logo.png"
                          alt="Bivaro Logo"
                          width={48}
                          height={48}
                          className="h-12 w-auto"
                          unoptimized
                        />
                      </Link>
                    </div>
                    <nav className="flex-1 px-4 py-4 overflow-y-auto">
                      <NavLinks />
                    </nav>
                  </div>
                </SheetContent>
              </Sheet>
              <Suspense fallback={null}>
                <PageHeading />
              </Suspense>
            </div>
            <UserMenu />
          </div>
        </header>

        <main id="main-content" className="flex-grow bg-background">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </div>
        </main>

        <footer className="bg-background border-t border-border py-6">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-center text-muted-foreground text-sm">
              &copy; {new Date().getFullYear()} Bivaro |
              Alle Beträge werden in Euro (€) angezeigt
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
