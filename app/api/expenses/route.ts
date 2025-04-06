import { NextResponse, NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  try {
    // Prüfen, ob es sich um einen multipart/form-data-Request handelt
    const contentType = request.headers.get('content-type') || '';
    
    if (contentType.includes('multipart/form-data')) {
      // Formular mit Datei verarbeiten
      const formData = await request.formData();
      const description = formData.get('description') as string;
      const amount = formData.get('amount') as string;
      const category = formData.get('category') as string;
      const taxRelevant = formData.get('taxRelevant') === 'true';
      const receipt = formData.get('receipt') as File | null;
      
      if (!description || !amount) {
        return NextResponse.json({ error: 'Fehlende Pflichtfelder' }, { status: 400 });
      }
      
      let receiptFileName = null;
      let storedReceiptFileName = null;
      
      // Wenn eine Datei hochgeladen wurde, speichern wir sie
      if (receipt) {
        // Dateityp prüfen
        const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
        if (!validTypes.includes(receipt.type)) {
          return NextResponse.json(
            { error: 'Nur PDF, JPG und PNG-Dateien werden unterstützt' },
            { status: 400 }
          );
        }
        
        // Datei in temporäres Verzeichnis speichern
        const tempDir = os.tmpdir();
        const bytes = await receipt.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const filePath = join(tempDir, receipt.name);
        await writeFile(filePath, buffer);
        
        // Generiere einen eindeutigen Dateinamen für die dauerhafte Speicherung
        const uniqueFileName = `${uuidv4()}_${receipt.name.replace(/\s+/g, '_')}`;
        const uploadDir = path.join(process.cwd(), 'public/uploads');
        const permanentFilePath = path.join(uploadDir, uniqueFileName);
        
        // Stelle sicher, dass das Verzeichnis existiert
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        
        // Kopiere die Datei in das dauerhafte Verzeichnis
        fs.copyFileSync(filePath, permanentFilePath);
        
        // Originalname und gespeicherten Namen speichern
        receiptFileName = receipt.name;
        storedReceiptFileName = uniqueFileName;
        
        // Bereinigen (temporäre Datei löschen)
        try {
          fs.unlinkSync(filePath);
        } catch (error) {
          console.error('Fehler beim Löschen der temporären Datei:', error);
        }
      }
      
      // Ausgabe in der Datenbank speichern
      const expense = await prisma.expense.create({
        data: {
          description,
          amount: parseFloat(amount),
          category: category || null,
          taxRelevant,
          taxDeductiblePercentage: formData.get('taxDeductiblePercentage') ? parseInt(formData.get('taxDeductiblePercentage') as string) : 100,
          receiptFileName,
          storedReceiptFileName,
        },
      });
      
      return NextResponse.json(expense);
    } else {
      // Verarbeite regulären JSON-Request ohne Datei
      const { description, amount, category, taxRelevant, taxDeductiblePercentage } = await request.json();
      
      if (!description || !amount) {
        return NextResponse.json({ error: 'Fehlende Pflichtfelder' }, { status: 400 });
      }
      
      const expense = await prisma.expense.create({
        data: {
          description,
          amount: parseFloat(amount.toString()),
          category: category || null,
          taxRelevant: taxRelevant !== undefined ? taxRelevant : true,
          taxDeductiblePercentage: taxDeductiblePercentage || 100,
        },
      });
      
      return NextResponse.json(expense);
    }
  } catch (error) {
    console.error('Fehler beim Erstellen der Ausgabe:', error);
    return NextResponse.json(
      { error: 'Fehler beim Erstellen der Ausgabe: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}

export async function GET() {
  const expenses = await prisma.expense.findMany({
    orderBy: {
      date: 'desc',
    },
  });
  return NextResponse.json(expenses);
}

// Neue Methode zum Aktualisieren einer Ausgabe
export async function PUT(request: Request) {
  const { id, description, amount, category, taxRelevant, taxDeductiblePercentage, receiptUrl } = await request.json();

  if (!id || !description || !amount) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const updatedExpense = await prisma.expense.update({
      where: { id: Number(id) },
      data: {
        description,
        amount: parseFloat(amount.toString()),
        category: category || null,
        taxRelevant: taxRelevant !== undefined ? taxRelevant : true,
        taxDeductiblePercentage: taxDeductiblePercentage || 100,
        receiptUrl: receiptUrl || null,
      },
    });
    return NextResponse.json(updatedExpense);
  } catch (error) {
    return NextResponse.json({ error: 'Ausgabe nicht gefunden' }, { status: 404 });
  }
}

// Neue Methode zum Löschen einer Ausgabe
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'ID ist erforderlich' }, { status: 400 });
  }

  try {
    await prisma.expense.delete({
      where: { id: Number(id) },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Ausgabe nicht gefunden' }, { status: 404 });
  }
}
