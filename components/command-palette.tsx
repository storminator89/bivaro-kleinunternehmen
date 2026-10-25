"use client";

import * as React from "react";
import { flushSync } from "react-dom";
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
import { RECORD_SEARCH_GROUPS, RECORD_SEARCH_MAX_LENGTH, RECORD_SEARCH_MAX_PAGE, RECORD_SEARCH_MIN_LENGTH, recordSearchPages, sameRecordSearchPages, type RecordSearchPages, type RecordSearchType } from '@/lib/record-search/contract';
import { startRecordSearch, type RecordSearchState } from '@/lib/record-search/client';
import { useReviewNavigation } from '@/components/purchases/use-review-navigation';
import { reviewSessionKey } from '@/components/purchases/incoming-review-history';

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
  navigate: (href: string) => void;
  logout: () => void;
  setTheme: (theme: string) => void;
  close: () => void;
};

const COMMANDS: CommandItem[] = [
  // Navigation
  { id: "nav-dashboard", label: "Dashboard öffnen", group: "Navigation", icon: "nav-dashboard", keywords: ["start", "übersicht", "home"], action: ({ navigate }) => { navigate("/dashboard"); } },
  { id: "nav-incomes", label: "Einnahmen", group: "Navigation", icon: "nav-incomes", keywords: ["umsatz", "rechnung"], action: ({ navigate }) => { navigate("/dashboard?tab=incomes"); } },
  { id: "nav-purchases", label: "Belegeingang", group: "Navigation", icon: "nav-expenses", keywords: ["eingangsrechnung", "lieferant", "original", "upload"], action: ({ navigate }) => { navigate("/purchases"); } },
  { id: "nav-expenses", label: "Ausgaben", group: "Navigation", icon: "nav-expenses", keywords: ["beleg", "kosten"], action: ({ navigate }) => { navigate("/dashboard?tab=expenses"); } },
  { id: "nav-invoices", label: "Rechnungen", group: "Navigation", icon: "nav-invoices", action: ({ navigate }) => { navigate("/dashboard?tab=invoices"); } },
  { id: "nav-cashbook", label: "Kassenbuch", group: "Navigation", icon: "nav-cashbook", action: ({ navigate }) => { navigate("/cashbook"); } },
  { id: "nav-reminders", label: "Mahnwesen", group: "Navigation", icon: "nav-reminders", action: ({ navigate }) => { navigate("/dashboard/reminders"); } },
  { id: "nav-tax", label: "Steuer-Simulation", group: "Navigation", icon: "nav-tax", keywords: ["einkommensteuer"], action: ({ navigate }) => { navigate("/steuer-simulation"); } },
  { id: "nav-customers", label: "Kunden", group: "Navigation", icon: "nav-customers", action: ({ navigate }) => { navigate("/customers"); } },
  { id: "nav-settings", label: "Einstellungen", group: "Navigation", icon: "nav-settings", action: ({ navigate }) => { navigate("/settings"); } },
  { id: "nav-users", label: "Benutzerverwaltung", group: "Navigation", icon: "nav-users", adminOnly: true, action: ({ navigate }) => { navigate("/users"); } },

  // Aktionen
  { id: "action-new-invoice", label: "Neue Rechnung erstellen", hint: "Öffnet den Editor", group: "Aktionen", icon: "nav-invoices", keywords: ["create", "rechnung"], action: ({ navigate }) => { navigate("/dashboard/invoices/new"); } },
  { id: "action-new-quote", label: "Neues Angebot erstellen", hint: "Öffnet den Editor", group: "Aktionen", icon: "nav-quotes", keywords: ["create", "angebot"], action: ({ navigate }) => { navigate("/dashboard/quotes/new"); } },
  { id: "action-new-expense", label: "Neue Ausgabe erfassen", hint: "Fokussiert das Formular", group: "Aktionen", icon: "nav-expenses", keywords: ["beleg"], action: ({ navigate }) => { navigate("/dashboard?tab=expenses&new=1"); } },
  { id: "action-new-income", label: "Neue Einnahme erfassen", hint: "Fokussiert das Formular", group: "Aktionen", icon: "nav-incomes", action: ({ navigate }) => { navigate("/dashboard?tab=incomes&new=1"); } },

  // Theme
  { id: "theme-light", label: "Helles Design", group: "Erscheinungsbild", icon: Sun, keywords: ["theme", "hell"], action: ({ setTheme, close }) => { setTheme("light"); close(); } },
  { id: "theme-dark", label: "Dunkles Design", group: "Erscheinungsbild", icon: Moon, keywords: ["theme", "dunkel"], action: ({ setTheme, close }) => { setTheme("dark"); close(); } },
  { id: "theme-system", label: "System-Design", group: "Erscheinungsbild", icon: Sun, keywords: ["theme", "system", "auto"], action: ({ setTheme, close }) => { setTheme("system"); close(); } },

  // Account
  { id: "logout", label: "Abmelden", group: "Konto", icon: "nav-logout", action: ({ logout }) => { logout(); } },
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
  return <AuthenticatedCommandPalette key={`${reviewSessionKey(session, status)}:${pathname}?${params}`} />;
}

function AuthenticatedCommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [searchState, setSearchState] = React.useState<RecordSearchState | null>(null);
  const [pages, setPages] = React.useState<RecordSearchPages>(recordSearchPages);
  const [selectedValue, setSelectedValue] = React.useState('');
  const [pendingSelection, setPendingSelection] = React.useState<string | null>(null);
  const [selectionReady, setSelectionReady] = React.useState(0);
  const [retry, setRetry] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const selectionTargets = React.useRef(new Map<string, HTMLDivElement>());
  const pendingRequest = React.useRef<ReturnType<typeof startRecordSearch> | null>(null);
  const generation = React.useRef(0);
  const changingPage = React.useRef(false);
  const pageFocus = React.useRef<RecordSearchType | null>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const openRef = React.useRef(false);
  const alive = React.useRef(false);
  React.useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; pendingRequest.current?.cancel(); pendingRequest.current = null; }; }, []);
  const term = query.trim();
  const searchable = term.length >= RECORD_SEARCH_MIN_LENGTH;
  const current = open && searchState?.query === term && sameRecordSearchPages(searchState.pages, pages) ? searchState : null;
  const discardSearch = React.useCallback(() => { generation.current++; pendingRequest.current?.cancel(); pendingRequest.current = null; setSearchState(null); setSelectedValue(''); setPendingSelection(null); }, []);
  const changeOpen = React.useCallback((value: boolean) => { discardSearch(); openRef.current = value; setOpen(value); setQuery(''); setPages(recordSearchPages()); changingPage.current = false; pageFocus.current = null; }, [discardSearch]);
  const restorePaletteFocus = () => {
    // Radix defers close autofocus beyond the unmount commit. A chooser or
    // newer control may already own focus by then; never take it back.
    if (!alive.current || openRef.current || (document.activeElement && document.activeElement !== document.body)) return;
    if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
  };
  React.useEffect(() => {
    if (!open || !searchable) return;
    const requestGeneration = generation.current;
    let request: ReturnType<typeof startRecordSearch> | undefined;
    const timer = setTimeout(() => {
      if (requestGeneration !== generation.current || !openRef.current) return;
      setSearchState({ query: term, pages, status: 'loading' });
      request = startRecordSearch(term, state => {
        if (!alive.current || !openRef.current || requestGeneration !== generation.current) return;
        changingPage.current = false;
        setSearchState(state);
        if (state.status === 'ready') {
          const target = state.result?.groups.find(group => group.type === pageFocus.current) ?? state.result?.groups.find(group => group.items.length);
          const item = target?.items[0];
          setPendingSelection(item ? `record:${item.type}:${item.id}` : target && target.page > 0 ? `record-page:${target.type}:back` : null);
          pageFocus.current = null;
        }
      }, fetch, pages);
      pendingRequest.current = request;
    }, 250);
    return () => {
      clearTimeout(timer);
      if (request && pendingRequest.current === request) { request.cancel(); pendingRequest.current = null; }
    };
  }, [open, searchable, term, pages, retry]);
  React.useLayoutEffect(() => {
    if (current?.status !== 'ready' || !pendingSelection) return;
    const target = selectionTargets.current.get(pendingSelection);
    const neutral = selectionTargets.current.get(`record-list:${pendingSelection.split(':')[1]}`);
    if (!target?.isConnected || !neutral?.isConnected) return;
    // cmdk 1.1's controlled value alone does not synchronize its active
    // descendant. Use its public pointer interaction on the real option, then
    // scroll explicitly (pointer selection intentionally skips cmdk scrolling).
    // A target already auto-selected by cmdk otherwise makes its setter a no-op.
    // A distinct real option forces synchronization, without invoking its action.
    neutral.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }));
    target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }));
    target.scrollIntoView({ block: 'nearest' });
    setPendingSelection(null);
  }, [current, pendingSelection, selectionReady]);
  const router = useRouter();
  const requestNavigation = useReviewNavigation();
  const { setTheme } = useTheme();
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement && !document.activeElement.closest('[cmdk-root]')) returnFocus.current = document.activeElement;
        changeOpen(!openRef.current);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [changeOpen]);

  if (status !== "authenticated") return null;

  const visible = COMMANDS.filter((c) => !c.adminOnly || isAdmin);
  const grouped = visible.reduce<Record<string, CommandItem[]>>((acc, item) => {
    (acc[item.group] ||= []).push(item);
    return acc;
  }, {});

  // Dispose the overlaid palette (including input/results) before the receipt's
  // save/discard/stay preflight gets focus. No raw push or signOut bypasses it.
  const closeBeforeNavigation = (action: () => void) => {
    flushSync(() => changeOpen(false));
    // Record the real source control as the review chooser's return trigger.
    restorePaletteFocus();
    requestNavigation(action);
  };
  const navigate = (href: string) => closeBeforeNavigation(() => router.push(href));
  const helpers: CommandHelpers = { navigate, logout: () => closeBeforeNavigation(() => { void signOut({ callbackUrl: "/" }); }), setTheme, close: () => changeOpen(false) };
  const rememberSelection = (value: string, node: HTMLDivElement | null) => {
    if (!node) { selectionTargets.current.delete(value); return; }
    selectionTargets.current.set(value, node);
    // cmdk may attach an option only after its own filtering commit, after
    // the parent's ready effect already ran. Retry when that real target exists.
    if (pendingSelection && (pendingSelection === value || value === `record-list:${pendingSelection.split(':')[1]}`)) setSelectionReady(previous => previous + 1);
  };
  const changePage = (type: RecordSearchType, direction: -1 | 1) => {
    const group = current?.status === 'ready' ? current.result?.groups.find(group => group.type === type) : undefined;
    const page = pages[type] + direction;
    if (!group || changingPage.current || page < 0 || page > RECORD_SEARCH_MAX_PAGE || (direction === 1 && !group.hasMore)) return;
    discardSearch();
    changingPage.current = true;
    pageFocus.current = type;
    setPages(previous => ({ ...previous, [type]: page }));
    inputRef.current?.focus({ preventScroll: true });
  };
  const statusText = !searchable ? 'Datensätze ab 3 Zeichen · Namen, Belegnummern und Eingangsdateien' : !current || current.status === 'loading' ? 'Datensätze werden gesucht…' : current.status === 'expired' ? 'Sitzung abgelaufen. Bitte erneut anmelden.' : current.status === 'error' ? 'Suche nicht verfügbar. Bitte erneut versuchen.' : current.result?.groups.every(group => !group.items.length) ? Object.values(pages).some(page => page > 0) ? 'Keine Treffer auf diesen Seiten. Zurückblättern oder Suchbegriff ändern.' : 'Keine eigenen Datensätze gefunden.' : `Eigene Datensätze · höchstens 5 je Typ und Seite · ${current.result?.groups.filter(group => group.items.length || group.page > 0).map(group => `${RECORD_SEARCH_GROUPS[group.type].title} Seite ${group.page + 1}`).join(', ')}`;

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-foreground/45" />
        <Dialog.Content aria-label="Befehlspalette" onCloseAutoFocus={event => { event.preventDefault(); restorePaletteFocus(); }} className="fixed left-1/2 top-[10dvh] z-[90] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-popover shadow-[var(--shadow-floating)]">
          <Command label="Befehlspalette" value={selectedValue} onValueChange={setSelectedValue} filter={(value, search, keywords) => value.startsWith('record:') || value.startsWith('record-list:') || value.startsWith('record-page:') || value.startsWith('record-search-') ? 1 : defaultFilter(value, search, keywords)} className="flex max-h-[calc(90dvh-1rem)] flex-col">
        <Dialog.Title className="sr-only">Befehlspalette</Dialog.Title>
        <Dialog.Description className="sr-only">Seiten, Aktionen und eigene Datensätze suchen. Mit den Pfeiltasten auswählen und mit Enter öffnen.</Dialog.Description>
        <div className="border-b border-border px-3">
          <Command.Input
            ref={inputRef}
            autoFocus
            value={query}
            onValueChange={value => { setQuery(value); if (value.trim() !== term) { discardSearch(); setPages(recordSearchPages()); changingPage.current = false; pageFocus.current = null; } }}
            maxLength={RECORD_SEARCH_MAX_LENGTH}
            aria-label="Aktionen und Datensätze suchen"
            placeholder="Aktion, Kunde oder Belegnummer…"
            className="flex h-12 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
        <Command.List aria-busy={searchable && (!current || current.status === 'loading')} className="min-h-0 max-h-[420px] overflow-y-auto p-2">
          {!searchable && <Command.Empty className="px-3 py-3 text-center text-sm text-muted-foreground">Keine passende Aktion.</Command.Empty>}
          <div role="status" aria-live="polite" className="px-3 py-2 text-xs text-muted-foreground">
            {statusText}
          </div>
          {current?.status === 'error' && <Command.Item value="record-search-retry" onSelect={() => { discardSearch(); setRetry(value => value + 1); inputRef.current?.focus({ preventScroll: true }); }} className="min-h-11 cursor-pointer rounded-md px-3 py-3 text-sm data-[selected=true]:bg-accent">Suche erneut versuchen</Command.Item>}
          {current?.status === 'error' && Object.values(pages).some(page => page > 0) && <Command.Item value="record-search-reset" onSelect={() => { discardSearch(); setPages(recordSearchPages()); changingPage.current = false; pageFocus.current = null; inputRef.current?.focus({ preventScroll: true }); }} className="min-h-11 cursor-pointer rounded-md px-3 py-3 text-sm data-[selected=true]:bg-accent">Zur ersten Ergebnisseite</Command.Item>}
          {current?.status === 'ready' && <p className="px-3 pb-2 text-xs text-muted-foreground">Treffer können sich beim Blättern ändern. Keine Gesamtzahl; maximal 20 Seiten je Typ. Bei Bedarf Suchbegriff eingrenzen.</p>}
          {current?.status === 'ready' && current.result?.groups.filter(group => group.items.length > 0 || group.page > 0).map(group => (
            <Command.Group key={group.type} heading={`Datensätze · ${RECORD_SEARCH_GROUPS[group.type].title} · Seite ${group.page + 1}`} className="px-1 py-1 text-xs font-semibold text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider">
              {!group.items.length && <p className="px-3 py-2 text-xs">Auf dieser Seite keine Treffer mehr.</p>}
              {group.items.map(item => <Command.Item key={`${item.type}:${item.id}`} ref={node => rememberSelection(`record:${item.type}:${item.id}`, node)} value={`record:${item.type}:${item.id}`} onSelect={() => navigate(item.href)} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground">
                <BivaroIcon name={RECORD_SEARCH_GROUPS[group.type].icon} size={26} /><span className="min-w-0 flex-1 truncate" title={item.label}>{item.label}</span><span aria-hidden="true" className="text-muted-foreground">↗</span>
              </Command.Item>)}
              {group.page > 0 && <Command.Item ref={node => rememberSelection(`record-page:${group.type}:back`, node)} value={`record-page:${group.type}:back`} onSelect={() => changePage(group.type, -1)} className="min-h-11 cursor-pointer rounded-md px-3 py-3 text-sm text-foreground data-[selected=true]:bg-accent">Vorherige Treffer · {RECORD_SEARCH_GROUPS[group.type].title}</Command.Item>}
              {group.hasMore && group.page < RECORD_SEARCH_MAX_PAGE && <Command.Item value={`record-page:${group.type}:next`} onSelect={() => changePage(group.type, 1)} className="min-h-11 cursor-pointer rounded-md px-3 py-3 text-sm text-foreground data-[selected=true]:bg-accent">Weitere Treffer · {RECORD_SEARCH_GROUPS[group.type].title}</Command.Item>}
              {group.hasMore && group.page === RECORD_SEARCH_MAX_PAGE && <p className="px-3 py-2 text-xs">Suchgrenze erreicht · Suchbegriff eingrenzen.</p>}
              <Command.Item ref={node => rememberSelection(`record-list:${group.type}`, node)} value={`record-list:${group.type}`} onSelect={() => navigate(RECORD_SEARCH_GROUPS[group.type].href)} className="min-h-11 cursor-pointer rounded-md px-3 py-3 text-xs text-muted-foreground data-[selected=true]:bg-accent">
                Liste öffnen (ungefiltert) · {RECORD_SEARCH_GROUPS[group.type].title}
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
