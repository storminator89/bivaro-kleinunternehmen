"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { LogOut, Settings, User as UserIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function getInitials(name?: string | null, email?: string | null) {
  const source = (name || email || "?").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function UserMenu() {
  const { data: session, status } = useSession();

  if (status !== "authenticated" || !session?.user) return null;

  const { name, email, role } = session.user as { name?: string; email?: string; role?: string };
  const initials = getInitials(name, email);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full p-1 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Benutzermenü öffnen"
        >
          <Avatar className="size-8">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium leading-none text-foreground">
            {name || "Benutzer"}
          </span>
          {email && (
            <span className="text-xs font-normal leading-none text-muted-foreground">
              {email}
            </span>
          )}
          {role && (
            <span className="mt-1 inline-flex w-fit items-center rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {role === "ADMIN" ? "Administrator" : "Benutzer"}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings" className="cursor-pointer">
            <Settings className="mr-2 h-4 w-4" /> Einstellungen
          </Link>
        </DropdownMenuItem>
        {role === "ADMIN" && (
          <DropdownMenuItem asChild>
            <Link href="/users" className="cursor-pointer">
              <UserIcon className="mr-2 h-4 w-4" /> Benutzerverwaltung
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => signOut({ callbackUrl: "/" })}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" /> Abmelden
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
