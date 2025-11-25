"use client";

import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { NavLinks } from "@/components/navigation/nav-links";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { CollapseButton } from "@/components/sidebar-collapse-button";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  
  // Öffentliche Seiten ohne Sidebar
  const publicPaths = ['/', '/login', '/register'];
  const isPublicPage = publicPaths.includes(pathname);
  
  // Wenn nicht eingeloggt oder auf öffentlicher Seite, zeige nur den Inhalt
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
        {/* Einfacher Header für öffentliche Seiten */}
        <header className="bg-background/80 backdrop-blur-sm border-b border-border sticky top-0 z-40">
          <div className="container mx-auto py-4 px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center">
              <Link href="/" className="flex items-center">
                <img
                  src="/Bivaro_Logo.png"
                  alt="Bivaro Logo"
                  className="h-10 w-auto"
                />
              </Link>
              <div className="flex items-center gap-4">
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
        
        <main className="flex-grow bg-background">
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
      {/* Sidebar for desktop */}
      <aside className="hidden bg-background border-r border-border md:flex md:flex-col shadow-sm h-screen sticky top-0 w-64 transition-all duration-300">
        <div className="sidebar-header relative p-4 pb-4 flex items-center justify-center">
          <Link href="/dashboard" className="brand-link text-xl font-bold text-foreground">
            <img
              src="/Bivaro_Logo.png"
              alt="Bivaro Logo"
              className="brand-full h-12 w-auto max-w-full object-contain"
            />
            <img
              src="/Bivaro_Logo.png"
              alt="Bivaro Logo kompakt"
              className="brand-compact h-8 w-auto max-w-full object-contain"
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

      {/* Mobile sidebar trigger */}
      <div className="md:hidden fixed top-4 left-4 z-50">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="bg-background/80 backdrop-blur-sm">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <div className="flex flex-col h-full bg-background">
              <div className="p-6 pb-4 border-b border-border">
                <Link href="/dashboard" className="flex items-center text-2xl font-bold text-foreground">
                  <img
                    src="/Bivaro_Logo.png"
                    alt="Bivaro Logo"
                    className="h-12 w-auto"
                  />
                </Link>
              </div>
              <nav className="flex-1 px-4 py-4">
                <NavLinks />
              </nav>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen w-full">
        <header className="bg-background/80 backdrop-blur-sm border-b border-border md:hidden sticky top-0 z-40">
          <div className="container mx-auto py-4 px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center">
              <div>
                <Link href="/dashboard" className="text-lg font-bold text-foreground">
                  <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                    Bivaro
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </header>
        
        <main className="flex-grow bg-background">
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
