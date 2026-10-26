"use client";

import { PageHeader } from "@/components/page-header";
import styles from "@/components/settings/admin-workspace.module.css";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserX, UserPlus, Loader2, Pencil, ShieldAlert } from "lucide-react";
import { validatePassword, PASSWORD_POLICY_HINT } from "@/lib/password-policy";

interface User {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: string;
  deactivatedAt: string | null;
}

export default function UsersPage() {
  const { data: session } = useSession();
  const _router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [readAccessDenied, setReadAccessDenied] = useState(false);
  const usersReadRef = useRef({ mounted: false, generation: 0 });
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "USER" });
  const [editingUser, setEditingUser] = useState({ id: "", name: "", email: "", password: "", role: "USER" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchUsers = useCallback(async () => {
    const read = usersReadRef.current;
    if (!read.mounted) return;
    const generation = ++read.generation;
    const isCurrent = () => read.mounted && read.generation === generation;
    setLoading(true);
    setLoadError(false);

    try {
      const response = await fetch("/api/users");
      if (!response.ok) {
        if (isCurrent() && (response.status === 401 || response.status === 403)) setReadAccessDenied(true);
        throw new Error(`Failed to fetch users (${response.status})`);
      }
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("Invalid users response");
      if (isCurrent()) {
        setUsers(data);
        setHasLoaded(true);
        setReadAccessDenied(false);
      }
    } catch (error) {
      if (isCurrent()) {
        console.error("Failed to fetch users", error);
        setLoadError(true);
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session?.user && (session.user as { role?: string }).role !== "ADMIN") {
      // Redirect or show access denied
      // For now we just let the API handle it, but UI should reflect it
    }
    const read = usersReadRef.current;
    read.mounted = true;
    void fetchUsers();
    return () => {
      read.mounted = false;
      read.generation++;
    };
  }, [session, fetchUsers]);

  const handleDelete = async (id: string) => {
    if (!confirm("Zugang deaktivieren? Anmeldung und API-Schlüssel werden gesperrt. Belege, Buchungen und Protokolle bleiben erhalten.")) return;

    try {
      const response = await fetch(`/api/users/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await fetchUsers();
      } else {
        const error = await response.text();
        alert(error || "Fehler beim Deaktivieren des Zugangs");
      }
    } catch (error) {
      console.error("Failed to deactivate user", error);
      alert("Fehler beim Deaktivieren des Zugangs");
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validatePassword(newUser.password);
    if (!validation.valid) return alert(validation.message);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });

      if (response.ok) {
        setIsAddUserOpen(false);
        setNewUser({ name: "", email: "", password: "", role: "USER" });
        fetchUsers();
      } else {
        const data = await response.json();
        alert(data.message || "Fehler beim Erstellen des Benutzers");
      }
    } catch (error) {
      console.error("Failed to create user", error);
      alert("Fehler beim Erstellen des Benutzers");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditClick = (user: User) => {
    setEditingUser({
      id: user.id,
      name: user.name || "",
      email: user.email,
      role: user.role || "USER",
      password: "" // Password is empty by default
    });
    setIsEditUserOpen(true);
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingUser.password) {
      const validation = validatePassword(editingUser.password);
      if (!validation.valid) return alert(validation.message);
    }
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/users/${editingUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingUser.name,
          email: editingUser.email,
          role: editingUser.role,
          password: editingUser.password || undefined // Only send if not empty
        }),
      });

      if (response.ok) {
        setIsEditUserOpen(false);
        setEditingUser({ id: "", name: "", email: "", password: "", role: "USER" });
        fetchUsers();
      } else {
        const error = await response.text();
        alert(error || "Fehler beim Aktualisieren des Benutzers");
      }
    } catch (error) {
      console.error("Failed to update user", error);
      alert("Fehler beim Aktualisieren des Benutzers");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading && (!hasLoaded || readAccessDenied)) {
    return (
      <div className="flex items-center justify-center h-full" role="status" aria-label="Benutzer werden geladen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (session?.user && (session.user as { role?: string }).role !== "ADMIN") {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
        <ShieldAlert className="h-16 w-16 text-destructive" />
        <h1 className="text-2xl font-bold">Zugriff verweigert</h1>
        <p className="text-muted-foreground">Sie haben keine Berechtigung, diese Seite zu sehen.</p>
      </div>
    );
  }

  if (loadError && (!hasLoaded || readAccessDenied)) {
    return (
      <div className={`${styles.workspace} space-y-6`}>
        <PageHeader title="Benutzer" />
        <Card className={styles.surface}>
          <CardHeader>
            <CardTitle>Zugänge</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p role="alert">Benutzer konnten nicht geladen werden. Bitte versuchen Sie es erneut.</p>
            <Button onClick={() => void fetchUsers()}>Erneut versuchen</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={`${styles.workspace} space-y-6`}>
      <PageHeader title="Benutzer" actions={<>
<Dialog open={isAddUserOpen} onOpenChange={setIsAddUserOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="mr-2 h-4 w-4" />
              Benutzer hinzufügen
            </Button>
          </DialogTrigger>
          <DialogContent className={styles.dialog}>
            <DialogHeader>
              <DialogTitle>Neuen Benutzer hinzufügen</DialogTitle>
              <DialogDescription className="sr-only">Benutzerzugang anlegen.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAddUser}>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                    placeholder="Max Mustermann"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">E-Mail</Label>
                  <Input
                    id="email"
                    type="email"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    placeholder="max@beispiel.de"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="role">Rolle</Label>
                  <select
                    id="role"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  >
                    <option value="USER">Benutzer</option>
                    <option value="ADMIN">Administrator</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password">Passwort</Label>
                  <Input
                    id="password"
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    required
                    minLength={8}
                  />
                  <p className="text-xs text-muted-foreground">{PASSWORD_POLICY_HINT}</p>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Erstellen
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={isEditUserOpen} onOpenChange={setIsEditUserOpen}>
          <DialogContent className={styles.dialog}>
            <DialogHeader>
              <DialogTitle>Benutzer bearbeiten</DialogTitle>
              <DialogDescription className="sr-only">Benutzerdaten ändern.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleUpdateUser}>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-name">Name</Label>
                  <Input
                    id="edit-name"
                    value={editingUser.name}
                    onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                    placeholder="Max Mustermann"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-email">E-Mail</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={editingUser.email}
                    onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                    placeholder="max@beispiel.de"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-role">Rolle</Label>
                  <select
                    id="edit-role"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={editingUser.role}
                    onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}
                  >
                    <option value="USER">Benutzer</option>
                    <option value="ADMIN">Administrator</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-password">Neues Passwort (leer = behalten)</Label>
                  <Input
                    id="edit-password"
                    type="password"
                    value={editingUser.password}
                    onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })}
                    minLength={8}
                    placeholder="••••••"
                  />
                  <p className="text-xs text-muted-foreground">{PASSWORD_POLICY_HINT}</p>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Speichern
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
</>} />

      <Card className={styles.surface}>
        <CardHeader>
          <CardTitle>Zugänge <span className="ml-2 text-sm font-normal text-muted-foreground">{users.length}</span></CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p role="status" className="mb-4 text-sm text-muted-foreground">Benutzer werden aktualisiert.</p>}
          {loadError && (
            <div className="mb-4 space-y-2">
              <p role="alert">Benutzer konnten nicht aktualisiert werden. Die angezeigten Daten sind möglicherweise nicht aktuell.</p>
              <Button onClick={() => void fetchUsers()}>Erneut versuchen</Button>
            </div>
          )}
          <Table className={styles.recordTable}>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>E-Mail</TableHead>
                <TableHead>Rolle</TableHead>
                <TableHead>Zugang</TableHead>
                <TableHead>Erstellt am</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell data-label="Name" className="font-medium"><div className={styles.identity}><span className={styles.avatar} aria-hidden="true">{(user.name || user.email).slice(0, 2).toUpperCase()}</span><div>{user.name || "-"}{session?.user?.id === user.id && <p className={styles.self}>Ihr Zugang</p>}</div></div></TableCell>
                  <TableCell data-label="E-Mail">{user.email}</TableCell>
                  <TableCell data-label="Rolle">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${user.role === 'ADMIN'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                      }`}>
                      {user.role === 'ADMIN' ? 'Administrator' : 'Benutzer'}
                    </span>
                  </TableCell>
                  <TableCell data-label="Zugang">{user.deactivatedAt ? "Deaktiviert" : "Aktiv"}</TableCell>
                  <TableCell data-label="Erstellt am">
                    {new Date(user.createdAt).toLocaleDateString("de-DE")}
                  </TableCell>
                  <TableCell data-label="Aktionen" className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEditClick(user)}
                        disabled={!!user.deactivatedAt}
                        title="Bearbeiten"
                        aria-label={`${user.name || user.email} bearbeiten`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(user.id)}
                        disabled={!!user.deactivatedAt || session?.user?.id === user.id}
                        title={session?.user?.id === user.id ? "Sie können sich nicht selbst deaktivieren" : "Zugang deaktivieren"}
                        aria-label="Zugang deaktivieren"
                      >
                        <UserX className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {users.length === 0 && !loading && !loadError && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-4">
                    Keine Benutzer gefunden.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
