"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { SheetClose } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-switch";
import { 
  Home, 
  LayoutDashboard, 
  Users, 
  LogIn, 
  UserPlus, 
  LogOut,
  Calculator,
  FileText,
  BarChart3,
  PieChart,
  SunMoon
} from "lucide-react";
import { useState, useEffect } from "react";

export function NavLinks() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
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
  
  const isActive = (path: string) => {
    return pathname === path;
  };

  const mainNavItems = [
    { 
      href: "/", 
      label: "Start", 
      icon: Home,
      auth: "all"
    },
    { 
      href: "/dashboard", 
      label: "Dashboard", 
      icon: LayoutDashboard,
      auth: "authenticated"
    },
    { 
      href: "/steuer-simulation", 
      label: "Steuer-Simulation", 
      icon: Calculator,
      auth: "authenticated"
    },
    { 
      href: "/customers", 
      label: "Kunden", 
      icon: Users,
      auth: "authenticated"
    }
  ];

  const authNavItems = [
    { 
      href: "/login", 
      label: "Anmelden", 
      icon: LogIn,
      auth: "unauthenticated"
    },
    { 
      href: "/register", 
      label: "Registrieren", 
      icon: UserPlus,
      auth: "unauthenticated"
    }
  ];

  if (isCollapsed) {
    return (
      <nav className="flex flex-col h-full">
        <ul className="space-y-1 flex-1">
          {mainNavItems.map((item) => {
            // Show item based on auth status
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
          })}
          
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
            <SunMoon className="h-5 w-5" />
          </div>
          
          {/* Show logout button if authenticated */}
          {status === "authenticated" && (
            <button 
              onClick={() => signOut({ callbackUrl: '/' })} 
              className="flex items-center justify-center p-3 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-colors duration-200"
              title="Abmelden"
            >
              <LogOut className="h-5 w-5" />
            </button>
          )}
        </div>
      </nav>
    );
  }

  return (
    <nav className="flex flex-col h-full">
      <ul className="space-y-1 flex-1">
        {mainNavItems.map((item) => {
          // Show item based on auth status
          if (item.auth === "authenticated" && status !== "authenticated") return null;
          
          const Icon = item.icon;
          const active = isActive(item.href);
          
          return (
            <li key={item.href}>
              <Link 
                href={item.href} 
                className={`flex items-center px-3 py-2.5 rounded-lg transition-all duration-200 ${
                  active 
                    ? 'bg-primary text-primary-foreground shadow-sm' 
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className="h-5 w-5 mr-3" />
                <span className="font-medium">{item.label}</span>
              </Link>
            </li>
          );
        })}
        
        {/* Auth items when expanded */}
        {status === "unauthenticated" && (
          <>
            {authNavItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              
              return (
                <li key={item.href}>
                  <Link 
                    href={item.href} 
                    className={`flex items-center px-3 py-2.5 rounded-lg transition-all duration-200 ${
                      active 
                        ? 'bg-primary text-primary-foreground shadow-sm' 
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <Icon className="h-5 w-5 mr-3" />
                    <span className="font-medium">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </>
        )}
      </ul>
      
      {/* Bottom section when expanded */}
      <div className="pt-4 border-t border-border mt-auto space-y-1">
        <div className="flex items-center justify-between px-3 py-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-200">
          <div className="flex items-center">
            <SunMoon className="h-5 w-5 mr-3" />
            <span className="font-medium">Theme</span>
          </div>
          <ThemeToggle />
        </div>
        
        {/* Show logout button if authenticated */}
        {status === "authenticated" && (
          <button 
            onClick={() => signOut({ callbackUrl: '/' })} 
            className="flex items-center w-full px-3 py-2.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-colors duration-200"
          >
            <LogOut className="h-5 w-5 mr-3" />
            <span className="font-medium">Abmelden</span>
          </button>
        )}
      </div>
    </nav>
  );
}
