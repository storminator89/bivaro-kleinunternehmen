"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { HelpCircle, Search } from "lucide-react";

// Offizielle AfA-Tabelle (Auszug der gängigsten Wirtschaftsgüter)
// Quelle: Bundesfinanzministerium AfA-Tabellen
const afaTable = [
  // EDV & Bürotechnik
  { category: "EDV & Bürotechnik", item: "Computer, PC, Laptop, Notebook", years: 3 },
  { category: "EDV & Bürotechnik", item: "Drucker, Scanner, Kopierer", years: 3 },
  { category: "EDV & Bürotechnik", item: "Monitor, Bildschirm", years: 3 },
  { category: "EDV & Bürotechnik", item: "Server", years: 3 },
  { category: "EDV & Bürotechnik", item: "Tablet, iPad", years: 3 },
  { category: "EDV & Bürotechnik", item: "Smartphone (betrieblich)", years: 5 },
  { category: "EDV & Bürotechnik", item: "Telefonanlage", years: 10 },
  { category: "EDV & Bürotechnik", item: "Faxgerät", years: 6 },
  { category: "EDV & Bürotechnik", item: "Software (Standard)", years: 3 },
  { category: "EDV & Bürotechnik", item: "NAS, externe Festplatten", years: 3 },
  
  // Büromöbel & Einrichtung
  { category: "Büromöbel & Einrichtung", item: "Schreibtisch", years: 13 },
  { category: "Büromöbel & Einrichtung", item: "Bürostuhl", years: 13 },
  { category: "Büromöbel & Einrichtung", item: "Aktenschrank, Regal", years: 13 },
  { category: "Büromöbel & Einrichtung", item: "Konferenztisch", years: 13 },
  { category: "Büromöbel & Einrichtung", item: "Empfangstheke", years: 13 },
  { category: "Büromöbel & Einrichtung", item: "Teppichboden", years: 8 },
  { category: "Büromöbel & Einrichtung", item: "Lampen, Beleuchtung", years: 13 },
  { category: "Büromöbel & Einrichtung", item: "Klimagerät (mobil)", years: 9 },
  { category: "Büromöbel & Einrichtung", item: "Tresor", years: 23 },
  
  // Fahrzeuge
  { category: "Fahrzeuge", item: "PKW", years: 6 },
  { category: "Fahrzeuge", item: "Elektro-PKW", years: 6 },
  { category: "Fahrzeuge", item: "Motorrad, Motorroller", years: 7 },
  { category: "Fahrzeuge", item: "E-Bike, Pedelec (betrieblich)", years: 7 },
  { category: "Fahrzeuge", item: "Fahrrad (betrieblich)", years: 7 },
  { category: "Fahrzeuge", item: "LKW bis 3,5t", years: 9 },
  { category: "Fahrzeuge", item: "LKW über 3,5t", years: 9 },
  { category: "Fahrzeuge", item: "Anhänger", years: 11 },
  
  // Maschinen & Geräte
  { category: "Maschinen & Geräte", item: "Werkzeugmaschinen (allgemein)", years: 10 },
  { category: "Maschinen & Geräte", item: "Handwerkzeuge (elektrisch)", years: 5 },
  { category: "Maschinen & Geräte", item: "Messgeräte", years: 8 },
  { category: "Maschinen & Geräte", item: "Küchengeräte (gewerblich)", years: 10 },
  { category: "Maschinen & Geräte", item: "Kaffeevollautomat", years: 5 },
  { category: "Maschinen & Geräte", item: "Kühlschrank (gewerblich)", years: 10 },
  
  // Foto & Video
  { category: "Foto & Video", item: "Kamera (Foto/Video)", years: 7 },
  { category: "Foto & Video", item: "Objektive", years: 7 },
  { category: "Foto & Video", item: "Stativ", years: 7 },
  { category: "Foto & Video", item: "Beleuchtung (Foto/Video)", years: 7 },
  { category: "Foto & Video", item: "Drohne", years: 5 },
  
  // Audio & Musik
  { category: "Audio & Musik", item: "Mikrofon", years: 7 },
  { category: "Audio & Musik", item: "Mischpult", years: 10 },
  { category: "Audio & Musik", item: "Lautsprecher (PA)", years: 10 },
  { category: "Audio & Musik", item: "Musikinstrumente", years: 10 },
  
  // Gebäude & Immobilien
  { category: "Gebäude & Immobilien", item: "Gebäude (Massivbau, nach 1924)", years: 50 },
  { category: "Gebäude & Immobilien", item: "Gebäude (gewerblich, Neubau)", years: 33 },
  { category: "Gebäude & Immobilien", item: "Außenanlagen", years: 15 },
  { category: "Gebäude & Immobilien", item: "Einbauküche (vermietet)", years: 10 },
  
  // Sonstiges
  { category: "Sonstiges", item: "Werbeanlagen, Schilder", years: 9 },
  { category: "Sonstiges", item: "Messestände", years: 6 },
  { category: "Sonstiges", item: "Ladeneinrichtung", years: 8 },
  { category: "Sonstiges", item: "Alarmanlage", years: 11 },
];

interface AfaTableDialogProps {
  onSelect?: (years: number) => void;
}

export function AfaTableDialog({ onSelect }: AfaTableDialogProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const filteredItems = afaTable.filter(
    (item) =>
      item.item.toLowerCase().includes(search.toLowerCase()) ||
      item.category.toLowerCase().includes(search.toLowerCase())
  );

  const groupedItems = filteredItems.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, typeof afaTable>);

  const handleSelect = (years: number) => {
    if (onSelect) {
      onSelect(years);
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
          <HelpCircle className="h-3 w-3 mr-1" />
          AfA-Tabelle
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>AfA-Tabelle – Nutzungsdauer</DialogTitle>
          <DialogDescription>
            Offizielle Abschreibungsdauern nach BMF. Klicken Sie auf einen Eintrag, um den Wert zu übernehmen.
          </DialogDescription>
        </DialogHeader>
        
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Suchen (z.B. Laptop, Schreibtisch...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex-1 overflow-y-auto pr-2 space-y-4">
          {Object.entries(groupedItems).map(([category, items]) => (
            <div key={category}>
              <h4 className="font-semibold text-sm text-muted-foreground mb-2 sticky top-0 bg-background py-1">
                {category}
              </h4>
              <div className="grid grid-cols-1 gap-1">
                {items.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSelect(item.years)}
                    className="flex justify-between items-center px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors text-left"
                  >
                    <span>{item.item}</span>
                    <span className="font-medium text-primary">{item.years} Jahre</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          
          {filteredItems.length === 0 && (
            <p className="text-center text-muted-foreground py-8">
              Keine Einträge gefunden. Prüfen Sie die offizielle AfA-Tabelle des BMF.
            </p>
          )}
        </div>

        <div className="border-t pt-4 mt-4">
          <p className="text-xs text-muted-foreground">
            <strong>Hinweis:</strong> Wirtschaftsgüter bis 800€ (netto) können sofort abgeschrieben werden (GWG). 
            Bei Anschaffungen zwischen 250€ und 1.000€ kann alternativ ein Sammelposten gebildet werden (5 Jahre).
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Quelle: BMF AfA-Tabellen. Diese Übersicht ist ein Auszug – für Sonderfälle konsultieren Sie die vollständige Tabelle oder Ihren Steuerberater.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
