"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function NavLinks() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  
  const isActive = (path: string) => {
    return pathname === path;
  };

  return (
    <nav className="flex items-center">
      <ul className="flex space-x-6 mr-4 items-center">
        <li>
          <Link 
            href="/" 
            className={`${isActive('/') ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Start
          </Link>
        </li>
        
        {/* Show these links to all users */}
        {status === "authenticated" && (
          <>
            <li>
              <Link 
                href="/dashboard" 
                className={`${isActive('/dashboard') ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Dashboard
              </Link>
            </li>
            <li>
              <Link 
                href="/customers" 
                className={`${isActive('/customers') ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Kunden
              </Link>
            </li>
          </>
        )}
        
        {/* Authentication links */}
        {status === "unauthenticated" && (
          <>
            <li>
              <Link 
                href="/login" 
                className={`${isActive('/login') ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Anmelden
              </Link>
            </li>
            <li>
              <Link 
                href="/register" 
                className={`${isActive('/register') ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Registrieren
              </Link>
            </li>
          </>
        )}
        
        {/* Show logout button if authenticated */}
        {status === "authenticated" && (
          <li className="flex items-center">
            <button 
              onClick={() => signOut({ callbackUrl: '/' })} 
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              Abmelden
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}