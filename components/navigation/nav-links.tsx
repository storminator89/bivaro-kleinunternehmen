"use client";

import { ReviewLink as Link } from "@/components/purchases/review-link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { BivaroIcon, type BivaroIconName } from "@/components/brand/bivaro-icon";
import { useState, useEffect } from "react";
import { useReviewNavigation } from "@/components/purchases/use-review-navigation";

type NavItem = {
  href: string;
  label: string;
  icon: BivaroIconName;
  auth: "all" | "authenticated" | "unauthenticated";
};

type NavSection = {
  title: string;
  items: NavItem[];
};

export function NavLinks({ allowCollapse = true, onNavigate }: { allowCollapse?: boolean; onNavigate?: () => void }) {
  const { data: session, status } = useSession();
  const requestNavigation = useReviewNavigation();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Load collapsed state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved === "true" || saved === "false") {
      setIsCollapsed(saved === "true");
    }

    // Listen for sidebar toggle events
    const handleToggle = (_e: CustomEvent) => {
      setIsCollapsed(_e.detail);
    };

    window.addEventListener('sidebar-toggle', handleToggle as EventListener);

    return () => {
      window.removeEventListener('sidebar-toggle', handleToggle as EventListener);
    };
  }, []);

  // Prüft ob ein Link aktiv ist (berücksichtigt auch Query-Parameter)
  const isActive = (href: string) => {
    const [path, query] = href.split('?');

    if (pathname.startsWith('/dashboard/invoices/') && href === '/dashboard?tab=invoices') return true;
    if (pathname.startsWith('/dashboard/quotes/') && href === '/dashboard?tab=quotes') return true;

    if (href === '/settings' && pathname.startsWith('/settings/')) return true;

    // Exakter Pfad-Match (für Unterseiten wie /dashboard/reminders)
    if (pathname === path && !query) {
      return !searchParams.get('tab');
    }

    // Pfad muss übereinstimmen
    if (pathname !== path) return false;

    // Wenn kein Query-Parameter im href, ist es aktiv wenn auch die URL keinen tab hat
    if (!query) {
      return !searchParams.get('tab');
    }

    // Query-Parameter prüfen
    const hrefParams = new URLSearchParams(query);
    const hrefTab = hrefParams.get('tab');
    const currentTab = searchParams.get('tab');

    return hrefTab === currentTab;
  };

  const isAdmin = session?.user?.role === "ADMIN";

  // Thematisch gruppierte Navigation
  const navSections: NavSection[] = [
    {
      title: "Übersicht",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: "nav-dashboard", auth: "authenticated" },
        { href: "/dashboard/today", label: "Heute erledigen", icon: "nav-reminders", auth: "authenticated" },
      ]
    },
    {
      title: "Verkauf",
      items: [
        { href: "/dashboard?tab=invoices", label: "Rechnungen", icon: "nav-invoices", auth: "authenticated" },
        { href: "/dashboard?tab=quotes", label: "Angebote", icon: "nav-quotes", auth: "authenticated" },
        { href: "/history", label: "Rechnungshistorie", icon: "nav-invoices", auth: "authenticated" },
        { href: "/dashboard/reminders", label: "Mahnwesen", icon: "nav-reminders", auth: "authenticated" },
        { href: "/customers", label: "Kunden", icon: "nav-customers", auth: "authenticated" },
      ]
    },
    {
      title: "Buchhaltung",
      items: [
        { href: "/dashboard?tab=incomes", label: "Einnahmen", icon: "nav-incomes", auth: "authenticated" },
        { href: "/purchases", label: "Belegeingang", icon: "nav-expenses", auth: "authenticated" },
        { href: "/dashboard?tab=expenses", label: "Ausgaben", icon: "nav-expenses", auth: "authenticated" },
        { href: "/cashbook", label: "Kassenbuch", icon: "nav-cashbook", auth: "authenticated" },
      ]
    },
    {
      title: "Auswertungen",
      items: [
        { href: "/dashboard?tab=eur", label: "EÜR", icon: "nav-eur", auth: "authenticated" },
        { href: "/dashboard?tab=gwg", label: "GWG-Verzeichnis", icon: "nav-assets", auth: "authenticated" },
        { href: "/steuer-simulation", label: "Steuer-Simulation", icon: "nav-tax", auth: "authenticated" },
      ]
    },
    {
      title: "System",
      items: [
        { href: "/settings", label: "Einstellungen", icon: "nav-settings", auth: "authenticated" },
        ...(isAdmin ? [{ href: "/users", label: "Benutzer", icon: "nav-users" as const, auth: "authenticated" as const }] : []),
      ]
    }
  ];

  const authNavItems: NavItem[] = [
    { href: "/login", label: "Anmelden", icon: "nav-users", auth: "unauthenticated" },
    { href: "/register", label: "Registrieren", icon: "nav-customers", auth: "unauthenticated" }
  ];

  // Collapsed view
  if (allowCollapse && isCollapsed) {
    return (
      <div className="flex h-full flex-col">
        <ul className="space-y-1 flex-1">
          {navSections.map((section) => (
            section.items.map((item) => {
              if (item.auth === "authenticated" && status !== "authenticated") return null;

              const active = isActive(item.href);

              return (
                <li key={item.href}>
                  <Link
                    onClick={onNavigate}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    data-active={active}
                    className={`app-nav-link flex items-center justify-center p-3 ${active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                      }`}
                    title={item.label}
                  >
                    <BivaroIcon name={item.icon} className="nav-artwork" size={28} />
                  </Link>
                </li>
              );
            })
          ))}

          {/* Auth items when collapsed */}
          {status === "unauthenticated" && authNavItems.map((item) => {
            const active = isActive(item.href);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  data-active={active}
                  className={`app-nav-link flex items-center justify-center p-3 ${active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`}
                  title={item.label}
                >
                  <BivaroIcon name={item.icon} className="nav-artwork" size={28} />
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Bottom section when collapsed */}
        <div className="mt-auto space-y-1 border-t border-border/80 pt-3">
          {status === "authenticated" && (
            <button
              onClick={() => requestNavigation(() => { void signOut({ callbackUrl: '/' }); })}
              className="flex min-h-11 w-full cursor-pointer items-center justify-center rounded-md p-3 text-muted-foreground transition-colors duration-200 hover:bg-destructive/10 hover:text-destructive"
              title="Abmelden"
            >
              <BivaroIcon name="nav-logout" className="nav-artwork" size={28} />
            </button>
          )}
        </div>
      </div>
    );
  }

  // Expanded view with sections
  return (
    <div className="flex h-full flex-col">
      <div className="app-nav-scroll flex-1 space-y-4 overflow-y-auto pr-1">
        {navSections.map((section) => {
          const visibleItems = section.items.filter(item =>
            item.auth !== "authenticated" || status === "authenticated"
          );

          if (visibleItems.length === 0) return null;

          return (
            <div key={section.title}>
              <h3 className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {section.title}
              </h3>
              <ul className="space-y-1">
                {visibleItems.map((item) => {
                      const active = isActive(item.href);

                  return (
                    <li key={item.href}>
                      <Link
                        onClick={onNavigate}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        data-active={active}
                        className={`app-nav-link flex items-center gap-3 px-3 py-2 ${active
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                          }`}
                      >
                        <BivaroIcon name={item.icon} className="nav-artwork" size={28} />
                        <span className="text-sm font-medium">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        {/* Auth items when expanded */}
        {status === "unauthenticated" && (
          <div>
            <h3 className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Konto
            </h3>
            <ul className="space-y-1">
              {authNavItems.map((item) => {
                  const active = isActive(item.href);

                return (
                  <li key={item.href}>
                    <Link
                      onClick={onNavigate}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      data-active={active}
                      className={`app-nav-link flex min-h-11 items-center gap-3 px-3 py-2 ${active
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                        }`}
                    >
                      <BivaroIcon name={item.icon} className="nav-artwork" size={28} />
                      <span className="text-sm font-medium">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Bottom section when expanded */}
      <div className="mt-auto space-y-1 border-t border-border/80 pt-3">
        {status === "authenticated" && (
          <button
            onClick={() => requestNavigation(() => { void signOut({ callbackUrl: '/' }); })}
            className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-muted-foreground transition-colors duration-200 hover:bg-destructive/10 hover:text-destructive"
          >
            <BivaroIcon name="nav-logout" className="nav-artwork" size={28} />
            <span className="text-sm font-medium">Abmelden</span>
          </button>
        )}
      </div>
    </div>
  );
}
