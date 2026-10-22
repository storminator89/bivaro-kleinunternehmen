"use client";

import * as React from "react";
import { Command, defaultFilter } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "next-themes";

import { BivaroIcon, type BivaroIconName } from "@/components/brand/bivaro-icon";
import { cn } from "@/lib/utils";
import { RECORD_SEARCH_GROUPS, RECORD_SEARCH_MAX_LENGTH, RECORD_SEARCH_MIN_LENGTH } from '@/lib/record-search/contract';
import { startRecordSearch, type RecordSearchState } from '@/lib/record-search/client';

type CommandItem = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: React.ComponentType<{ className?: string }> | BivaroIconName;
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
  { id: "nav-dashboard", label: "Dashboard öffnen", group: "Navigation", icon: "nav-dashboard", keywords: ["start", "übersicht", "home"], action: ({ router, close }) => { router.push("/dashboard"); close(); } },
  { id: "nav-incomes", label: "Einnahmen", group: "Navigation", icon: "nav-incomes", keywords: ["umsatz", "rechnung"], action: ({ router, close }) => { router.push("/dashboard?tab=incomes"); close(); } },
  { id: "nav-purchases", label: "Belegeingang", group: "Navigation", icon: "nav-expenses", keywords: ["eingangsrechnung", "lieferant", "original", "upload"], action: ({ router, close }) => { router.push("/purchases"); close(); } },
  { id: "nav-expenses", label: "Ausgaben", group: "Navigation", icon: "nav-expenses", keywords: ["beleg", "kosten"], action: ({ router, close }) => { router.push("/dashboard?tab=expenses"); close(); } },
  { id: "nav-invoices", label: "Rechnungen", group: "Navigation", icon: "nav-invoices", action: ({ router, close }) => { router.push("/dashboard?tab=invoices"); close(); } },
  { id: "nav-cashbook", label: "Kassenbuch", group: "Navigation", icon: "nav-cashbook", action: ({ router, close }) => { router.push("/cashbook"); close(); } },
  { id: "nav-reminders", label: "Mahnwesen", group: "Navigation", icon: "nav-reminders", action: ({ router, close }) => { router.push("/dashboard/reminders"); close(); } },
  { id: "nav-tax", label: "Steuer-Simulation", group: "Navigation", icon: "nav-tax", keywords: ["einkommensteuer"], action: ({ router, close }) => { router.push("/steuer-simulation"); close(); } },
  { id: "nav-customers", label: "Kunden", group: "Navigation", icon: "nav-customers", action: ({ router, close }) => { router.push("/customers"); close(); } },
  { id: "nav-settings", label: "Einstellungen", group: "Navigation", icon: "nav-settings", action: ({ router, close }) => { router.push("/settings"); close(); } },
  { id: "nav-users", label: "Benutzerverwaltung", group: "Navigation", icon: "nav-users", adminOnly: true, action: ({ router, close }) => { router.push("/users"); close(); } },

  // Aktionen
  { id: "action-new-invoice", label: "Neue Rechnung erstellen", hint: "Öffnet den Editor", group: "Aktionen", icon: "nav-invoices", keywords: ["create", "rechnung"], action: ({ router, close }) => { router.push("/dashboard/invoices/new"); close(); } },
  { id: "action-new-quote", label: "Neues Angebot erstellen", hint: "Öffnet den Editor", group: "Aktionen", icon: "nav-quotes", keywords: ["create", "angebot"], action: ({ router, close }) => { router.push("/dashboard/quotes/new"); close(); } },
  { id: "action-new-expense", label: "Neue Ausgabe erfassen", hint: "Fokussiert das Formular", group: "Aktionen", icon: "nav-expenses", keywords: ["beleg"], action: ({ router, close }) => { router.push("/dashboard?tab=expenses&new=1"); close(); } },
  { id: "action-new-income", label: "Neue Einnahme erfassen", hint: "Fokussiert das Formular", group: "Aktionen", icon: "nav-incomes", action: ({ router, close }) => { router.push("/dashboard?tab=incomes&new=1"); close(); } },

  // Theme
  { id: "theme-light", label: "Helles Design", group: "Erscheinungsbild", icon: Sun, keywords: ["theme", "hell"], action: ({ setTheme, close }) => { setTheme("light"); close(); } },
  { id: "theme-dark", label: "Dunkles Design", group: "Erscheinungsbild", icon: Moon, keywords: ["theme", "dunkel"], action: ({ setTheme, close }) => { setTheme("dark"); close(); } },
  { id: "theme-system", label: "System-Design", group: "Erscheinungsbild", icon: Sun, keywords: ["theme", "system", "auto"], action: ({ setTheme, close }) => { setTheme("system"); close(); } },

  // Account
  { id: "logout", label: "Abmelden", group: "Konto", icon: "nav-logout", action: ({ close }) => { close(); signOut({ callbackUrl: "/" }); } },
];

export function CommandPalette() {
  return <React.Suspense fallback={null}><ScopedCommandPalette /></React.Suspense>;
}

function ScopedCommandPalette() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const params = useSearchParams();
  if (status !== 'authenticated') return null;
  // Dispose all terms, pending work and results on navigation/account/session changes.
  return <AuthenticatedCommandPalette key={`${session.user.id}:${session.user.role}:${session.user.sessionVersion}:${pathname}?${params}`} />;
}

function AuthenticatedCommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [searchState, setSearchState] = React.useState<RecordSearchState | null>(null);
  const [retry, setRetry] = React.useState(0);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const term = query.trim();
  const searchable = term.length >= RECORD_SEARCH_MIN_LENGTH;
  const current = open && searchState?.query === term ? searchState : null;
  const changeOpen = (value: boolean) => { setOpen(value); setQuery(''); setSearchState(null); };
  React.useEffect(() => {
    if (!open || !searchable) return;
    let request: ReturnType<typeof startRecordSearch> | undefined;
    const timer = setTimeout(() => {
      setSearchState({ query: term, status: 'loading' });
      request = startRecordSearch(term, setSearchState);
    }, 250);
    return () => { clearTimeout(timer); request?.cancel(); };
  }, [open, searchable, term, retry]);
  const router = useRouter();
  const { setTheme } = useTheme();
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement && !document.activeElement.closest('[cmdk-root]')) returnFocus.current = document.activeElement;
        setOpen((v) => !v); setQuery(''); setSearchState(null);
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

  const helpers: CommandHelpers = { router, setTheme, close: () => changeOpen(false) };

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-foreground/45" />
        <Dialog.Content aria-label="Befehlspalette" onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }); }} className="fixed left-1/2 top-[10dvh] z-[90] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-popover shadow-[var(--shadow-floating)]">
          <Command label="Befehlspalette" filter={(value, search, keywords) => value.startsWith('record:') || value.startsWith('record-list:') || value === 'record-search-retry' ? 1 : defaultFilter(value, search, keywords)} className="flex max-h-[calc(90dvh-1rem)] flex-col">
        <Dialog.Title className="sr-only">Befehlspalette</Dialog.Title>
        <Dialog.Description className="sr-only">Seiten, Aktionen und eigene Datensätze suchen. Mit den Pfeiltasten auswählen und mit Enter öffnen.</Dialog.Description>
        <div className="border-b border-border px-3">
          <Command.Input
            autoFocus
            value={query}
            onValueChange={value => { setQuery(value); if (value.trim() !== term) setSearchState(null); }}
            maxLength={RECORD_SEARCH_MAX_LENGTH}
            aria-label="Aktionen und Datensätze suchen"
            placeholder="Aktion, Kunde oder Belegnummer…"
            className="flex h-12 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
        <Command.List className="min-h-0 max-h-[420px] overflow-y-auto p-2">
          {!searchable && <Command.Empty className="px-3 py-3 text-center text-sm text-muted-foreground">Keine passende Aktion.</Command.Empty>}
          <div role="status" aria-live="polite" className="px-3 py-2 text-xs text-muted-foreground">
            {!searchable ? 'Datensätze ab 3 Zeichen · Namen, Belegnummern und Eingangsdateien' : !current || current.status === 'loading' ? 'Datensätze werden gesucht…' : current.status === 'expired' ? 'Sitzung abgelaufen. Bitte erneut anmelden.' : current.status === 'error' ? 'Suche nicht verfügbar. Bitte erneut versuchen.' : current.result?.groups.every(group => !group.items.length) ? 'Keine eigenen Datensätze gefunden.' : 'Eigene Datensätze · höchstens 5 je Typ'}
          </div>
          {current?.status === 'error' && <Command.Item value="record-search-retry" onSelect={() => { setSearchState(null); setRetry(value => value + 1); }} className="min-h-11 cursor-pointer rounded-md px-3 py-3 text-sm data-[selected=true]:bg-accent">Suche erneut versuchen</Command.Item>}
          {current?.status === 'ready' && current.result?.groups.filter(group => group.items.length > 0).map(group => (
            <Command.Group key={group.type} heading={`Datensätze · ${RECORD_SEARCH_GROUPS[group.type].title}`} className="px-1 py-1 text-xs font-semibold text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider">
              {group.items.map(item => <Command.Item key={`${item.type}:${item.id}`} value={`record:${item.type}:${item.id}`} onSelect={() => { router.push(item.href); changeOpen(false); }} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground">
                <BivaroIcon name={RECORD_SEARCH_GROUPS[group.type].icon} size={26} /><span className="min-w-0 flex-1 truncate" title={item.label}>{item.label}</span><span aria-hidden="true" className="text-muted-foreground">↗</span>
              </Command.Item>)}
              <Command.Item value={`record-list:${group.type}`} onSelect={() => { router.push(RECORD_SEARCH_GROUPS[group.type].href); changeOpen(false); }} className="min-h-11 cursor-pointer rounded-md px-3 py-3 text-xs text-muted-foreground data-[selected=true]:bg-accent">
                {group.hasMore ? 'Weitere Treffer vorhanden · ' : ''}Alle {RECORD_SEARCH_GROUPS[group.type].title} öffnen (ungefiltert)
              </Command.Item>
            </Command.Group>
          ))}
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
                    {typeof Icon === "string" ? <BivaroIcon name={Icon} size={26} /> : <Icon className="h-4 w-4 text-muted-foreground" />}
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
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">↑↓</kbd>
            <span>Navigation</span>
            <kbd className="ml-2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">↵</kbd>
            <span>Auswählen</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">Esc</kbd>
            <span>Schließen</span>
          </div>
        </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
        "inline-flex min-h-11 items-center gap-2 rounded-md border border-border/80 bg-card px-3 py-2 text-sm text-muted-foreground shadow-none transition-[background-color,color,transform] duration-150 hover:-translate-y-px hover:bg-secondary hover:text-foreground",
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
      <kbd className="ml-auto hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs sm:inline">
        {shortcut}
      </kbd>
    </button>
  );
}
