"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  History,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  LogIn,
  LogOut,
  Download,
  Upload,
  Key,
  Settings,
  Eye,
  RefreshCw,
  AlertTriangle,
  User,
  FileText,
  Users,
  Receipt,
  TrendingUp,
  TrendingDown,
  Bell,
  CreditCard,
  Database,
  Shield,
  Clock,
} from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow, format } from 'date-fns';
import { de } from 'date-fns/locale';

interface AuditLog {
  id: number;
  action: string;
  entityType: string;
  entityId: string | null;
  entityName: string | null;
  changedFields: string[] | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name: string | null;
  };
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

const ACTION_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  REVIEW: { label: 'Prüfhinweis', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: <AlertTriangle className="h-3 w-3" /> },
  CREATE: { label: 'Erstellt', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: <Plus className="h-3 w-3" /> },
  UPDATE: { label: 'Geändert', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: <Pencil className="h-3 w-3" /> },
  DELETE: { label: 'Gelöscht', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: <Trash2 className="h-3 w-3" /> },
  LOGIN: { label: 'Anmeldung', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', icon: <LogIn className="h-3 w-3" /> },
  LOGOUT: { label: 'Abmeldung', color: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400', icon: <LogOut className="h-3 w-3" /> },
  LOGIN_FAILED: { label: 'Fehlgeschlagen', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: <AlertTriangle className="h-3 w-3" /> },
  EXPORT: { label: 'Exportiert', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400', icon: <Download className="h-3 w-3" /> },
  IMPORT: { label: 'Importiert', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400', icon: <Upload className="h-3 w-3" /> },
  BACKUP: { label: 'Backup', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: <Database className="h-3 w-3" /> },
  RESTORE: { label: 'Wiederhergestellt', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: <RefreshCw className="h-3 w-3" /> },
  API_KEY_CREATED: { label: 'API-Key erstellt', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400', icon: <Key className="h-3 w-3" /> },
  API_KEY_REVOKED: { label: 'API-Key widerrufen', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', icon: <Key className="h-3 w-3" /> },
  PASSWORD_CHANGED: { label: 'Passwort geändert', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', icon: <Shield className="h-3 w-3" /> },
  SETTINGS_CHANGED: { label: 'Einstellungen', color: 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400', icon: <Settings className="h-3 w-3" /> },
  STATUS_CHANGED: { label: 'Status geändert', color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400', icon: <RefreshCw className="h-3 w-3" /> },
  PAYMENT_RECEIVED: { label: 'Zahlung erhalten', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: <CreditCard className="h-3 w-3" /> },
  REMINDER_SENT: { label: 'Mahnung gesendet', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', icon: <Bell className="h-3 w-3" /> },
  VIEW: { label: 'Angesehen', color: 'bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400', icon: <Eye className="h-3 w-3" /> },
  DOWNLOAD: { label: 'Heruntergeladen', color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400', icon: <Download className="h-3 w-3" /> },
};

const ENTITY_ICONS: Record<string, React.ReactNode> = {
  Customer: <Users className="h-4 w-4" />,
  Invoice: <Receipt className="h-4 w-4" />,
  Expense: <TrendingDown className="h-4 w-4" />,
  Income: <TrendingUp className="h-4 w-4" />,
  Settings: <Settings className="h-4 w-4" />,
  User: <User className="h-4 w-4" />,
  ApiKey: <Key className="h-4 w-4" />,
  RecurringExpense: <RefreshCw className="h-4 w-4" />,
  Reminder: <Bell className="h-4 w-4" />,
  InvoiceTemplate: <FileText className="h-4 w-4" />,
  Backup: <Database className="h-4 w-4" />,
  Session: <LogIn className="h-4 w-4" />,
};

const ENTITY_LABELS: Record<string, string> = {
  Customer: 'Kunde',
  Invoice: 'Rechnung',
  Expense: 'Ausgabe',
  Income: 'Einnahme',
  Settings: 'Einstellungen',
  User: 'Benutzer',
  ApiKey: 'API-Key',
  RecurringExpense: 'Wiederkehrende Ausgabe',
  Reminder: 'Mahnung',
  InvoiceTemplate: 'Rechnungsvorlage',
  Backup: 'Datensicherung',
  Session: 'Sitzung',
};

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  // Filters
  const [entityType, setEntityType] = useState<string>('all');
  const [action, setAction] = useState<string>('all');
  const [_searchQuery, _setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', '25');

      if (entityType && entityType !== 'all') params.set('entityType', entityType);
      if (action && action !== 'all') params.set('action', action);
      if (startDate) params.set('startDate', new Date(startDate).toISOString());
      if (endDate) params.set('endDate', new Date(endDate + 'T23:59:59').toISOString());

      const response = await fetch(`/api/audit-logs?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setLogs(data.logs);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error);
    }
    setIsLoading(false);
  }, [page, entityType, action, startDate, endDate]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleSearch = () => {
    setPage(1);
    fetchLogs();
  };

  const handleReset = () => {
    setEntityType('all');
    setAction('all');
    _setSearchQuery('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return format(date, 'dd.MM.yyyy HH:mm:ss', { locale: de });
  };

  const formatRelativeDate = (dateString: string) => {
    const date = new Date(dateString);
    return formatDistanceToNow(date, { addSuffix: true, locale: de });
  };

  const renderChangedFields = (log: AuditLog) => {
    if (!log.changedFields || log.changedFields.length === 0) return null;

    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {log.changedFields.map((field, index) => (
          <Badge key={index} variant="outline" className="text-xs">
            {field}
          </Badge>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Back Link */}
        <Link
          href="/settings"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Zurück zu Einstellungen
        </Link>

        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-primary/10 rounded-lg">
              <History className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Audit-Log</h1>
              <p className="text-muted-foreground">
                Protokoll aller Änderungen und Aktivitäten
              </p>
            </div>
          </div>
        </header>

        {/* Filters */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filter
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <Label htmlFor="entityType">Bereich</Label>
                <Select value={entityType} onValueChange={setEntityType}>
                  <SelectTrigger id="entityType">
                    <SelectValue placeholder="Alle Bereiche" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Bereiche</SelectItem>
                    <SelectItem value="Customer">Kunden</SelectItem>
                    <SelectItem value="Invoice">Rechnungen</SelectItem>
                    <SelectItem value="Expense">Ausgaben</SelectItem>
                    <SelectItem value="Income">Einnahmen</SelectItem>
                    <SelectItem value="Settings">Einstellungen</SelectItem>
                    <SelectItem value="ApiKey">API-Keys</SelectItem>
                    <SelectItem value="RecurringExpense">Wiederkehrende Ausgaben</SelectItem>
                    <SelectItem value="Reminder">Mahnungen</SelectItem>
                    <SelectItem value="Session">Sitzungen</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="action">Aktion</Label>
                <Select value={action} onValueChange={setAction}>
                  <SelectTrigger id="action">
                    <SelectValue placeholder="Alle Aktionen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Aktionen</SelectItem>
                    <SelectItem value="CREATE">Erstellt</SelectItem>
                    <SelectItem value="UPDATE">Geändert</SelectItem>
                    <SelectItem value="DELETE">Gelöscht</SelectItem>
                    <SelectItem value="LOGIN">Anmeldung</SelectItem>
                    <SelectItem value="EXPORT">Export</SelectItem>
                    <SelectItem value="BACKUP">Backup</SelectItem>
                    <SelectItem value="REVIEW">Prüfhinweis</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="startDate">Von</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="endDate">Bis</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>

              <div className="flex items-end gap-2">
                <Button onClick={handleSearch} className="flex-1">
                  <Search className="h-4 w-4 mr-2" />
                  Suchen
                </Button>
                <Button variant="outline" onClick={handleReset}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Logs Table */}
        <Card>
          <CardHeader>
            <CardTitle>Aktivitäten</CardTitle>
            <CardDescription>
              {pagination ? `${pagination.total} Einträge gefunden` : 'Laden...'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
                Laden...
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-12">
                <History className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium mb-2">Keine Einträge gefunden</h3>
                <p className="text-sm text-muted-foreground">
                  Es wurden keine Audit-Log-Einträge für die gewählten Filter gefunden.
                </p>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[180px]">Zeitpunkt</TableHead>
                      <TableHead>Benutzer</TableHead>
                      <TableHead>Aktion</TableHead>
                      <TableHead>Bereich</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => {
                      const actionInfo = ACTION_LABELS[log.action] || {
                        label: log.action,
                        color: 'bg-gray-100 text-gray-700',
                        icon: <Clock className="h-3 w-3" />
                      };

                      return (
                        <TableRow key={log.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedLog(log)}>
                          <TableCell>
                            <div className="text-sm font-medium">
                              {formatDate(log.createdAt)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatRelativeDate(log.createdAt)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <div>
                                <div className="text-sm font-medium">
                                  {log.user.name || log.user.email}
                                </div>
                                {log.ipAddress && (
                                  <div className="text-xs text-muted-foreground">
                                    IP: {log.ipAddress}
                                  </div>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={`${actionInfo.color} gap-1`}>
                              {actionInfo.icon}
                              {actionInfo.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {ENTITY_ICONS[log.entityType] || <FileText className="h-4 w-4" />}
                              <span className="text-sm">
                                {ENTITY_LABELS[log.entityType] || log.entityType}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-[250px]">
                              {log.entityName && (
                                <div className="text-sm font-medium truncate">
                                  {log.entityName}
                                </div>
                              )}
                              {renderChangedFields(log)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedLog(log);
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                {/* Pagination */}
                {pagination && pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <div className="text-sm text-muted-foreground">
                      Seite {pagination.page} von {pagination.totalPages}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(page - 1)}
                        disabled={page <= 1}
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        Zurück
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(page + 1)}
                        disabled={!pagination.hasMore}
                      >
                        Weiter
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Detail Dialog */}
        <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {selectedLog && ENTITY_ICONS[selectedLog.entityType]}
                Audit-Log Details
              </DialogTitle>
              <DialogDescription>
                {selectedLog && formatDate(selectedLog.createdAt)}
              </DialogDescription>
            </DialogHeader>

            {selectedLog && (
              <div className="space-y-4">
                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Benutzer</Label>
                    <p className="font-medium">{selectedLog.user.name || selectedLog.user.email}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">IP-Adresse</Label>
                    <p className="font-medium">{selectedLog.ipAddress || '-'}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Aktion</Label>
                    <div className="mt-1">
                      <Badge className={ACTION_LABELS[selectedLog.action]?.color || 'bg-gray-100'}>
                        {ACTION_LABELS[selectedLog.action]?.label || selectedLog.action}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Bereich</Label>
                    <p className="font-medium">
                      {ENTITY_LABELS[selectedLog.entityType] || selectedLog.entityType}
                      {selectedLog.entityId && ` #${selectedLog.entityId}`}
                    </p>
                  </div>
                </div>

                {selectedLog.entityName && (
                  <div>
                    <Label className="text-muted-foreground">Bezeichnung</Label>
                    <p className="font-medium">{selectedLog.entityName}</p>
                  </div>
                )}

                {/* Changed Fields */}
                {selectedLog.changedFields && selectedLog.changedFields.length > 0 && (
                  <div>
                    <Label className="text-muted-foreground">Geänderte Felder</Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedLog.changedFields.map((field, index) => (
                        <Badge key={index} variant="outline">{field}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Old Values */}
                {selectedLog.oldValues && Object.keys(selectedLog.oldValues).length > 0 && (
                  <div>
                    <Label className="text-muted-foreground">Alte Werte</Label>
                    <pre className="mt-1 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg text-xs overflow-x-auto">
                      {JSON.stringify(selectedLog.oldValues, null, 2)}
                    </pre>
                  </div>
                )}

                {/* New Values */}
                {selectedLog.newValues && Object.keys(selectedLog.newValues).length > 0 && (
                  <div>
                    <Label className="text-muted-foreground">Neue Werte</Label>
                    <pre className="mt-1 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg text-xs overflow-x-auto">
                      {JSON.stringify(selectedLog.newValues, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Metadata */}
                {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                  <div>
                    <Label className="text-muted-foreground">Zusätzliche Informationen</Label>
                    <pre className="mt-1 p-3 bg-muted rounded-lg text-xs overflow-x-auto">
                      {JSON.stringify(selectedLog.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
