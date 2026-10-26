import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SwitchingChecklist } from '@/components/public-accounting/switching-checklist';
import { switchingTopics } from '@/lib/switching-checklist';

describe('public switching checklist static render', () => {
  it('renders six natively labelled keyboard controls with an open default', () => {
    const html = renderToStaticMarkup(createElement(SwitchingChecklist));
    expect(html.match(/<select\b/g)).toHaveLength(6);
    expect(html.match(/<option value="open" selected=""/g)).toHaveLength(6);
    for (const topic of switchingTopics) {
      expect(html).toContain(`for="umstieg-${topic.id}"`);
      expect(html).toContain(`id="umstieg-${topic.id}"`);
      expect(html).toContain(`aria-describedby="umstieg-${topic.id}-task"`);
      expect(html).toContain(`id="umstieg-${topic.id}-task"`);
    }
    expect(html).not.toMatch(/tabindex="-1"|<input\b|<form\b/i);
  });

  it('discloses reset/privacy, manual-only review and non-demonstrated limits before any action', () => {
    const html = renderToStaticMarkup(createElement(SwitchingChecklist));
    expect(html).toContain('0 von 6 Punkten selbst vorbereitet');
    expect(html).toContain('Ein Neuladen setzt sie zurück');
    expect(html).toContain('speichert oder übermittelt Ihre Auswahl nicht');
    expect(html).toContain('Keine Umstiegs-, Produkt- oder Steuerfreigabe');
    expect(html).toContain('keine geführte Demo');
    expect(html).toContain('Kein Versand und keine automatische Kontaktaufnahme');
    expect(html).toContain('Reviewbogen zum Kopieren anzeigen');
    expect(html).toMatch(/<textarea[^>]*readonly=""/i);
    expect(html).toContain('<noscript>');
    expect(html.match(/<button type="button"/g)).toHaveLength(2);
  });
});
