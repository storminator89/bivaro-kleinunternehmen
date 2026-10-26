"use client";

import { ReviewLink as Link } from "@/components/purchases/review-link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { SidebarIcon, type SidebarNavIconName } from "@/components/brand/sidebar-icon";
import { useState, useEffect } from "react";
import { useReviewNavigation } from "@/components/purchases/use-review-navigation";
import { ChevronDown } from "lucide-react";
import { isNavigationItemActive } from "@/lib/navigation";

type NavItem = {
  href: string;
  label: string;
  icon: SidebarNavIconName;
  auth: "all" | "authenticated" | "unauthenticated";
};

type NavSection = {
  title: string;
  items: NavItem[];
  secondaryTitle?: string;
  secondaryItems?: NavItem[];
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

  const isActive = (href: string) => isNavigationItemActive(href, pathname, searchParams);

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
        { href: "/customers", label: "Kunden", icon: "nav-customers", auth: "authenticated" },
      ],
      secondaryTitle: "Historie und Mahnwesen",
      secondaryItems: [
        { href: "/history", label: "Rechnungshistorie", icon: "nav-invoices", auth: "authenticated" },
        { href: "/dashboard/reminders", label: "Mahnwesen", icon: "nav-reminders", auth: "authenticated" },
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
      items: [],
      secondaryItems: [
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

  const visibleItems = (items: NavItem[]) => items.filter(item =>
    item.auth !== "authenticated" || status === "authenticated"
  );
  const collapsed = allowCollapse && isCollapsed;

  const renderItem = (item: NavItem) => {
    const active = isActive(item.href);
    return (
      <li key={item.href}>
        <Link
          onClick={onNavigate}
          href={item.href}
          aria-label={collapsed ? item.label : undefined}
          aria-current={active ? "page" : undefined}
          data-active={active}
          title={collapsed ? item.label : undefined}
          className={`app-nav-link flex min-h-11 items-center ${collapsed ? 'justify-center p-3' : 'gap-3 px-3 py-2'} ${active
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
        >
          <SidebarIcon name={item.icon} className="nav-artwork" size={28} />
          {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
        </Link>
      </li>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="app-nav-scroll flex-1 space-y-4 overflow-y-auto pr-1">
        {collapsed ? (
          <ul className="space-y-1">
            {navSections.flatMap(section => visibleItems([...section.items, ...(section.secondaryItems ?? [])])).map(renderItem)}
            {status === "unauthenticated" && authNavItems.map(renderItem)}
          </ul>
        ) : navSections.map(section => {
          const primary = visibleItems(section.items);
          const secondary = visibleItems(section.secondaryItems ?? []);
          if (!primary.length && !secondary.length) return null;
          const activeSecondary = secondary.find(item => isActive(item.href));
          // Native disclosure toggles do not add a history entry. A new active
          // secondary route (including Back/Forward) reveals its current link.
          const disclosure = secondary.length > 0 && (
            <details key={`${section.title}:${activeSecondary?.href ?? ''}`} open={Boolean(activeSecondary)} className="group/nav-section">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md px-3 py-2 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                {primary.length > 0
                  ? <span className="text-xs font-medium">{section.secondaryTitle}</span>
                  : <h3 className="text-xs font-semibold">{section.title}</h3>}
                <ChevronDown aria-hidden="true" className="size-4 shrink-0 transition-transform group-open/nav-section:rotate-180" />
              </summary>
              <ul className="space-y-1">{secondary.map(renderItem)}</ul>
            </details>
          );
          return (
            <div key={section.title}>
              {primary.length > 0 && <>
                <h3 className="mb-2 px-3 text-xs font-semibold text-muted-foreground">{section.title}</h3>
                <ul className="space-y-1">{primary.map(renderItem)}</ul>
              </>}
              {disclosure}
            </div>
          );
        })}

        {!collapsed && status === "unauthenticated" && (
          <div>
            <h3 className="mb-2 px-3 text-xs font-semibold text-muted-foreground">Konto</h3>
            <ul className="space-y-1">{authNavItems.map(renderItem)}</ul>
          </div>
        )}
      </div>

      <div className="mt-auto space-y-1 border-t border-border/80 pt-3">
        {status === "authenticated" && (
          <button
            type="button"
            onClick={() => requestNavigation(() => { void signOut({ callbackUrl: '/' }); })}
            aria-label={collapsed ? "Abmelden" : undefined}
            title={collapsed ? "Abmelden" : undefined}
            className={`flex min-h-11 w-full cursor-pointer items-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-destructive/10 hover:text-destructive ${collapsed ? 'justify-center p-3' : 'gap-3 px-3 py-2'}`}
          >
            <SidebarIcon name="nav-logout" className="nav-artwork" size={28} />
            {!collapsed && <span className="text-sm font-medium">Abmelden</span>}
          </button>
        )}
      </div>
    </div>
  );
}
