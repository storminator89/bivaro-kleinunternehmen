import { Building2, Mail, HardDrive, KeyRound, FileCheck, ChevronDown, ShieldCheck, History } from 'lucide-react';
import styles from '@/components/settings/admin-workspace.module.css';

export function SettingsSectionNavigation({ isAdmin }: { isAdmin: boolean }) {
  const items = [
    { id: 'company-settings', label: 'Firmendaten', Icon: Building2 },
    { id: 'fiscal-profile', label: 'Steuerprofil', Icon: FileCheck },
    ...(isAdmin ? [
      { id: 'email-settings', label: 'E-Mail-Versand', Icon: Mail },
      { id: 'registration-settings', label: 'Registrierung', Icon: ShieldCheck },
    ] : []),
    { id: 'handoff-settings', label: 'Unterlagen übergeben', Icon: FileCheck },
    { id: 'backup-settings', label: 'Datensicherung', Icon: HardDrive },
    { id: 'access-settings', label: 'API-Zugang', Icon: KeyRound },
    { id: 'audit-settings', label: 'Audit-Log', Icon: History },
    { id: 'procedure-settings', label: 'Dokumentation', Icon: FileCheck },
  ];
  const links = items.map(({ id, label, Icon }) => (
    <a key={id} href={`#${id}`}><Icon aria-hidden="true" /><span>{label}</span></a>
  ));
  return <>
    <nav className={styles.sectionNav} aria-label="Einstellungsbereiche"><p>In den Einstellungen</p>{links}</nav>
    <details className={styles.mobileNav}>
      <summary>Bereich wechseln<ChevronDown aria-hidden="true" /></summary>
      <nav aria-label="Mobile Einstellungsbereiche">{links}</nav>
    </details>
  </>;
}
