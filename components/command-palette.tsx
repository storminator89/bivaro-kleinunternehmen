"use client";

import * as React from "react";
import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  FileText,
  Wallet,
  AlertCircle,
  Calculator,
  Users,
  Settings,
  UserCog,
  LogOut,
  Sun,
  Moon,
  Plus,
} from "lucide-react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";

type CommandItem = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords?: string[];
  adminOnly?: boolean;
  action: (helpers: CommandHelpers) => void;
};

type CommandHelpers = {
  router: ReturnType<typeof useRouter>;
  setTheme: (theme: string) => void;
  close: () => void;
};

const COMMANDS: CommandItem[] = [
  // Navigation
  { id: "nav-dashboard", label: "Dashboard öffnen", group: "Navigation", icon: LayoutDashboard, keywords: ["start", "übersicht", "home"], action: ({ router, close }) => { router.push("/dashboard"); close(); } },
  { id: "nav-incomes", label: "Einnahmen", group: "Navigation", icon: TrendingUp, keywords: ["umsatz", "rechnung"], action: ({ router, close }) => { router.push("/dashboard?tab=incomes"); close(); } },
  { id: "nav-expenses", label: "Ausgaben", group: "Navigation", icon: TrendingDown, keywords: ["beleg", "kosten"], action: ({ router, close }) => { router.push("/dashboard?tab=expenses"); close(); } },
  { id: "nav-invoices", label: "Rechnungen", group: "Navigation", icon: FileText, action: ({ router, close }) => { router.push("/dashboard?tab=invoices"); close(); } },
  { id: "nav-cashbook", label: "Kassenbuch", group: "Navigation", icon: Wallet, action: ({ router, close }) => { router.push("/cashbook"); close(); } },
  { id: "nav-reminders", label: "Mahnwesen", group: "Navigation", icon: AlertCircle, action: ({ router, close }) => { router.push("/dashboard/reminders"); close(); } },
  { id: "nav-tax", label: "Steuer-Simulation", group: "Navigation", icon: Calculator, keywords: ["einkommensteuer"], action: ({ router, close }) => { router.push("/steuer-simulation"); close(); } },
  { id: "nav-customers", label: "Kunden", group: "Navigation", icon: Users, action: ({ router, close }) => { router.push("/customers"); close(); } },
  { id: "nav-settings", label: "Einstellungen", group: "Navigation", icon: Settings, action: ({ router, close }) => { router.push("/settings"); close(); } },
  { id: "nav-users", label: "Benutzerverwaltung", group: "Navigation", icon: UserCog, adminOnly: true, action: ({ router, close }) => { router.push("/users"); close(); } },

  // Aktionen
  { id: "action-new-invoice", label: "Neue Rechnung erstellen", hint: "Öffnet den Editor", group: "Aktionen", icon: Plus, keywords: ["create", "rechnung"], action: ({ router, close }) => { router.push("/dashboard/invoices/new"); close(); } },
  { id: "action-new-quote", label: "Neues Angebot erstellen", hint: "Öffnet den Editor", group: "Aktionen", icon: Plus, keywords: ["create", "angebot"], action: ({ router, close }) => { router.push("/dashboard/quotes/new"); close(); } },
  { id: "action-new-expense", label: "Neue Ausgabe erfassen", hint: "Fokussiert das Formular", group: "Aktionen", icon: Plus, keywords: ["beleg"], action: ({ router, close }) => { router.push("/dashboard?tab=expenses&new=1"); close(); } },
  { id: "action-new-income", label: "Neue Einnahme erfassen", hint: "Fokussiert das Formular", group: "Aktionen", icon: Plus, action: ({ router, close }) => { router.push("/dashboard?tab=incomes&new=1"); close(); } },

  // Theme
  { id: "theme-light", label: "Helles Design", group: "Erscheinungsbild", icon: Sun, keywords: ["theme", "hell"], action: ({ setTheme, close }) => { setTheme("light"); close(); } },
  { id: "theme-dark", label: "Dunkles Design", group: "Erscheinungsbild", icon: Moon, keywords: ["theme", "dunkel"], action: ({ setTheme, close }) => { setTheme("dark"); close(); } },
  { id: "theme-system", label: "System-Design", group: "Erscheinungsbild", icon: Sun, keywords: ["theme", "system", "auto"], action: ({ setTheme, close }) => { setTheme("system"); close(); } },

  // Account
  { id: "logout", label: "Abmelden", group: "Konto", icon: LogOut, action: ({ close }) => { close(); signOut({ callbackUrl: "/" }); } },
];

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const { setTheme } = useTheme();
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  if (status !== "authenticated") return null;

  const visible = COMMANDS.filter((c) => !c.adminOnly || isAdmin);
  const grouped = visible.reduce<Record<string, CommandItem[]>>((acc, item) => {
    (acc[item.group] ||= []).push(item);
    return acc;
  }, {});

  const helpers: CommandHelpers = { router, setTheme, close: () => setOpen(false) };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Befehlspalette"
      className="fixed inset-0 z-[80]"
    >
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <div className="fixed left-1/2 top-[15%] z-[90] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        <Dialog.Title className="sr-only">Befehlspalette</Dialog.Title>
        <div className="border-b border-border px-3">
          <Command.Input
            autoFocus
            placeholder="Tippen, um Aktionen oder Seiten zu suchen…"
            className="flex h-12 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
        <Command.List className="max-h-[420px] overflow-y-auto p-2">
          <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
            Keine Treffer.
          </Command.Empty>
          {Object.entries(grouped).map(([group, items]) => (
            <Command.Group
              key={group}
              heading={group}
              className="px-1 py-1 text-xs font-semibold text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
            >
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <Command.Item
                    key={item.id}
                    value={`${item.label} ${(item.keywords || []).join(" ")}`}
                    onSelect={() => item.action(helpers)}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground",
                      "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1">{item.label}</span>
                    {item.hint && (
                      <span className="text-xs text-muted-foreground">{item.hint}</span>
                    )}
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}
        </Command.List>
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">↑↓</kbd>
            <span>Navigation</span>
            <kbd className="ml-2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">↵</kbd>
            <span>Auswählen</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd>
            <span>Schließen</span>
          </div>
        </div>
      </div>
    </Command.Dialog>
  );
}

export function CommandPaletteTrigger({ className }: { className?: string }) {
  const [shortcut, setShortcut] = React.useState("Ctrl+K");

  React.useEffect(() => {
    const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    setShortcut(isMac ? "⌘K" : "Ctrl+K");
  }, []);

  const open = () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
    );
  };

  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
      aria-label="Befehlspalette öffnen"
    >
      <svg
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <span className="hidden sm:inline">Suchen oder springen…</span>
      <kbd className="ml-2 hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] sm:inline">
        {shortcut}
      </kbd>
    </button>
  );
}
