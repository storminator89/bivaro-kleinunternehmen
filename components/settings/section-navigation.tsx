import { Building2, Mail, HardDrive, KeyRound, FileCheck, ChevronDown } from 'lucide-react';

export function SettingsSectionNavigation({ isAdmin }: { isAdmin: boolean }) {
  const items = [
    { id: 'company-settings', label: 'Firmendaten', Icon: Building2 },
    ...(isAdmin ? [{ id: 'email-settings', label: 'E-Mail-Versand', Icon: Mail }] : []),
    { id: 'backup-settings', label: 'Datensicherung', Icon: HardDrive },
    { id: 'access-settings', label: 'API-Zugang', Icon: KeyRound },
    { id: 'procedure-settings', label: 'Dokumentation', Icon: FileCheck },
  ];
  const links = items.map(({ id, label, Icon }) => <a key={id} href={`#${id}`}><Icon aria-hidden="true" /><span>{label}</span></a>);
  return <>
    <nav className="settings-section-nav" aria-label="Einstellungsbereiche"><p>Arbeitsbereich</p>{links}</nav>
    <details className="settings-mobile-nav"><summary>Bereich wechseln<ChevronDown aria-hidden="true" /></summary><nav aria-label="Mobile Einstellungsbereiche">{links}</nav></details>
  </>;
}
