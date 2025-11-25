"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { ThemeToggle } from "@/components/theme-switch";
import { 
  Home, 
  LayoutDashboard, 
  Users, 
  LogIn, 
  UserPlus, 
  LogOut,
  Calculator,
  SunMoon,
  Settings,
  UserCog,
  TrendingUp,
  TrendingDown,
  FileText,
  Receipt
} from "lucide-react";
import { useState, useEffect } from "react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  auth: "all" | "authenticated" | "unauthenticated";
};

type NavSection = {
  title: string;
  items: NavItem[];
};

export function NavLinks() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  // Load collapsed state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved) {
      setIsCollapsed(JSON.parse(saved));
    }
    
    // Listen for sidebar toggle events
    const handleToggle = (e: CustomEvent) => {
      setIsCollapsed(e.detail);
    };
    
    window.addEventListener('sidebar-toggle', handleToggle as EventListener);
    
    return () => {
      window.removeEventListener('sidebar-toggle', handleToggle as EventListener);
    };
  }, []);
  
  // Prüft ob ein Link aktiv ist (berücksichtigt auch Query-Parameter)
  const isActive = (href: string) => {
    const [path, query] = href.split('?');
    
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
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, auth: "authenticated" },
      ]
    },
    {
      title: "Finanzen",
      items: [
        { href: "/dashboard?tab=incomes", label: "Einnahmen", icon: TrendingUp, auth: "authenticated" },
        { href: "/dashboard?tab=expenses", label: "Ausgaben", icon: TrendingDown, auth: "authenticated" },
        { href: "/dashboard?tab=invoices", label: "Rechnungen", icon: FileText, auth: "authenticated" },
      ]
    },
    {
      title: "Analyse",
      items: [
        { href: "/steuer-simulation", label: "Steuer-Simulation", icon: Calculator, auth: "authenticated" },
      ]
    },
    {
      title: "Stammdaten",
      items: [
        { href: "/customers", label: "Kunden", icon: Users, auth: "authenticated" },
      ]
    },
    {
      title: "System",
      items: [
        { href: "/settings", label: "Einstellungen", icon: Settings, auth: "authenticated" },
        ...(isAdmin ? [{ href: "/users", label: "Benutzer", icon: UserCog, auth: "authenticated" as const }] : []),
      ]
    }
  ];

  const authNavItems: NavItem[] = [
    { href: "/login", label: "Anmelden", icon: LogIn, auth: "unauthenticated" },
    { href: "/register", label: "Registrieren", icon: UserPlus, auth: "unauthenticated" }
  ];

  // Collapsed view
  if (isCollapsed) {
    return (
      <nav className="flex flex-col h-full">
        <ul className="space-y-1 flex-1">
          {navSections.map((section) => (
            section.items.map((item) => {
              if (item.auth === "authenticated" && status !== "authenticated") return null;
              
              const Icon = item.icon;
              const active = isActive(item.href);
              
              return (
                <li key={item.href}>
                  <Link 
                    href={item.href} 
                    className={`flex items-center justify-center p-3 rounded-lg transition-all duration-200 ${
                      active 
                        ? 'bg-primary text-primary-foreground shadow-sm' 
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                    title={item.label}
                  >
                    <Icon className="h-5 w-5" />
                  </Link>
                </li>
              );
            })
          ))}
          
          {/* Auth items when collapsed */}
          {status === "unauthenticated" && authNavItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            
            return (
              <li key={item.href}>
                <Link 
                  href={item.href} 
                  className={`flex items-center justify-center p-3 rounded-lg transition-all duration-200 ${
                    active 
                      ? 'bg-primary text-primary-foreground shadow-sm' 
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                  title={item.label}
                >
                  <Icon className="h-5 w-5" />
                </Link>
              </li>
            );
          })}
        </ul>
        
        {/* Bottom section when collapsed */}
        <div className="pt-4 border-t border-border mt-auto space-y-1">
          <div className="flex items-center justify-center p-3 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-200">
            <ThemeToggle />
          </div>
          
          {status === "authenticated" && (
            <button 
              onClick={() => signOut({ callbackUrl: '/' })} 
              className="flex items-center justify-center w-full p-3 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive cursor-pointer transition-colors duration-200"
              title="Abmelden"
            >
              <LogOut className="h-5 w-5" />
            </button>
          )}
        </div>
      </nav>
    );
  }

  // Expanded view with sections
  return (
    <nav className="flex flex-col h-full">
      <div className="space-y-6 flex-1 overflow-y-auto">
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
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  
                  return (
                    <li key={item.href}>
                      <Link 
                        href={item.href} 
                        className={`flex items-center px-3 py-2 rounded-lg transition-all duration-200 ${
                          active 
                            ? 'bg-primary text-primary-foreground shadow-sm' 
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        <Icon className="h-4 w-4 mr-3" />
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
                const Icon = item.icon;
                const active = isActive(item.href);
                
                return (
                  <li key={item.href}>
                    <Link 
                      href={item.href} 
                      className={`flex items-center px-3 py-2 rounded-lg transition-all duration-200 ${
                        active 
                          ? 'bg-primary text-primary-foreground shadow-sm' 
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      <Icon className="h-4 w-4 mr-3" />
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
      <div className="pt-4 border-t border-border mt-auto space-y-1">
        <div className="flex items-center justify-between px-3 py-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-200">
          <div className="flex items-center">
            <SunMoon className="h-4 w-4 mr-3" />
            <span className="text-sm font-medium">Theme</span>
          </div>
          <ThemeToggle />
        </div>
        
        {status === "authenticated" && (
          <button 
            onClick={() => signOut({ callbackUrl: '/' })} 
            className="flex items-center w-full px-3 py-2 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive cursor-pointer transition-colors duration-200"
          >
            <LogOut className="h-4 w-4 mr-3" />
            <span className="text-sm font-medium">Abmelden</span>
          </button>
        )}
      </div>
    </nav>
  );
}
