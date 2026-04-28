/**
 * API v1 - Documentation Endpoint
 * 
 * Returns OpenAPI 3.0 compatible documentation
 */

import { NextResponse } from 'next/server';

export const API_DOCUMENTATION = {
  openapi: "3.0.3",
  info: {
    title: "Bivaro Buchhaltung API",
    description: "REST API für die Bivaro Buchhaltungssoftware. Ermöglicht den Zugriff auf Kunden, Einnahmen, Ausgaben und Rechnungen.",
    version: "1.0.0",
    contact: {
      name: "Bivaro Support"
    }
  },
  servers: [
    {
      url: "/api/v1",
      description: "API v1"
    }
  ],
  security: [
    { BearerAuth: [] },
    { ApiKeyAuth: [] }
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "API Key als Bearer Token: Authorization: Bearer biv_sk_..."
      },
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "API Key im Header: X-API-Key: biv_sk_..."
      }
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              message: { type: "string" },
              code: { type: "string" },
              timestamp: { type: "string", format: "date-time" }
            }
          }
        }
      },
      PaginationMeta: {
        type: "object",
        properties: {
          page: { type: "integer" },
          pageSize: { type: "integer" },
          total: { type: "integer" },
          hasMore: { type: "boolean" }
        }
      },
      Customer: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          contactPerson: { type: "string", nullable: true },
          email: { type: "string", nullable: true },
          phone: { type: "string", nullable: true },
          address: { type: "string", nullable: true },
          zipCode: { type: "string", nullable: true },
          city: { type: "string", nullable: true },
          taxNumber: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" }
        }
      },
      CustomerInput: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Name des Kunden" },
          contactPerson: { type: "string", description: "Ansprechpartner" },
          email: { type: "string", format: "email" },
          phone: { type: "string" },
          address: { type: "string" },
          zipCode: { type: "string" },
          city: { type: "string" },
          taxNumber: { type: "string" }
        }
      },
      Expense: {
        type: "object",
        properties: {
          id: { type: "integer" },
          description: { type: "string" },
          amount: { type: "number" },
          date: { type: "string", format: "date-time" },
          category: { type: "string", nullable: true },
          taxRelevant: { type: "boolean" },
          taxDeductiblePercentage: { type: "number", nullable: true },
          depreciationYears: { type: "integer", nullable: true },
          receiptFileName: { type: "string", nullable: true }
        }
      },
      ExpenseInput: {
        type: "object",
        required: ["description", "amount"],
        properties: {
          description: { type: "string" },
          amount: { type: "number", minimum: 0 },
          date: { type: "string", format: "date" },
          category: { type: "string" },
          taxRelevant: { type: "boolean", default: true },
          taxDeductiblePercentage: { type: "integer", minimum: 0, maximum: 100 },
          depreciationYears: { type: "integer", minimum: 1 }
        }
      },
      Income: {
        type: "object",
        properties: {
          id: { type: "integer" },
          description: { type: "string" },
          amount: { type: "number" },
          date: { type: "string", format: "date-time" },
          taxRelevant: { type: "boolean" },
          customerId: { type: "integer", nullable: true },
          invoiceId: { type: "integer", nullable: true },
          customer: {
            type: "object",
            nullable: true,
            properties: {
              id: { type: "integer" },
              name: { type: "string" }
            }
          }
        }
      },
      IncomeInput: {
        type: "object",
        required: ["description", "amount"],
        properties: {
          description: { type: "string" },
          amount: { type: "number", minimum: 0 },
          date: { type: "string", format: "date" },
          customerId: { type: "integer" },
          taxRelevant: { type: "boolean", default: true }
        }
      },
      Invoice: {
        type: "object",
        properties: {
          id: { type: "integer" },
          fileName: { type: "string" },
          invoiceNumber: { type: "string", nullable: true },
          invoiceDate: { type: "string", format: "date-time", nullable: true },
          dueDate: { type: "string", format: "date-time", nullable: true },
          totalAmount: { type: "number", nullable: true },
          status: { type: "string", enum: ["DRAFT", "SENT", "PAID"] },
          paidAt: { type: "string", format: "date-time", nullable: true },
          uploadedAt: { type: "string", format: "date-time" },
          customerId: { type: "integer", nullable: true },
          customer: {
            type: "object",
            nullable: true,
            properties: {
              id: { type: "integer" },
              name: { type: "string" }
            }
          }
        }
      }
    },
    parameters: {
      pageParam: {
        name: "page",
        in: "query",
        schema: { type: "integer", default: 1 },
        description: "Seitennummer"
      },
      limitParam: {
        name: "limit",
        in: "query",
        schema: { type: "integer", default: 50, maximum: 100 },
        description: "Ergebnisse pro Seite"
      },
      searchParam: {
        name: "search",
        in: "query",
        schema: { type: "string" },
        description: "Suchbegriff"
      }
    }
  },
  paths: {
    "/customers": {
      get: {
        tags: ["Kunden"],
        summary: "Alle Kunden abrufen",
        parameters: [
          { $ref: "#/components/parameters/pageParam" },
          { $ref: "#/components/parameters/limitParam" },
          { $ref: "#/components/parameters/searchParam" }
        ],
        responses: {
          "200": {
            description: "Liste der Kunden",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Customer" }
                    },
                    meta: { $ref: "#/components/schemas/PaginationMeta" },
                    timestamp: { type: "string" }
                  }
                }
              }
            }
          },
          "401": { description: "Nicht authentifiziert" }
        }
      },
      post: {
        tags: ["Kunden"],
        summary: "Neuen Kunden erstellen",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CustomerInput" }
            }
          }
        },
        responses: {
          "201": {
            description: "Kunde erstellt",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: { $ref: "#/components/schemas/Customer" }
                  }
                }
              }
            }
          },
          "400": { description: "Validierungsfehler" },
          "401": { description: "Nicht authentifiziert" }
        }
      },
      put: {
        tags: ["Kunden"],
        summary: "Kunden aktualisieren",
        parameters: [
          { name: "id", in: "query", required: true, schema: { type: "integer" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CustomerInput" }
            }
          }
        },
        responses: {
          "200": { description: "Kunde aktualisiert" },
          "404": { description: "Kunde nicht gefunden" }
        }
      },
      delete: {
        tags: ["Kunden"],
        summary: "Kunden löschen",
        parameters: [
          { name: "id", in: "query", required: true, schema: { type: "integer" } }
        ],
        responses: {
          "200": { description: "Kunde gelöscht" },
          "404": { description: "Kunde nicht gefunden" }
        }
      }
    },
    "/expenses": {
      get: {
        tags: ["Ausgaben"],
        summary: "Alle Ausgaben abrufen",
        parameters: [
          { $ref: "#/components/parameters/pageParam" },
          { $ref: "#/components/parameters/limitParam" },
          { $ref: "#/components/parameters/searchParam" },
          { name: "category", in: "query", schema: { type: "string" } },
          { name: "startDate", in: "query", schema: { type: "string", format: "date" } },
          { name: "endDate", in: "query", schema: { type: "string", format: "date" } },
          { name: "taxRelevant", in: "query", schema: { type: "boolean" } }
        ],
        responses: {
          "200": { description: "Liste der Ausgaben" }
        }
      },
      post: {
        tags: ["Ausgaben"],
        summary: "Neue Ausgabe erstellen",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ExpenseInput" }
            }
          }
        },
        responses: {
          "201": { description: "Ausgabe erstellt" }
        }
      },
      put: {
        tags: ["Ausgaben"],
        summary: "Ausgabe aktualisieren",
        parameters: [
          { name: "id", in: "query", required: true, schema: { type: "integer" } }
        ],
        responses: {
          "200": { description: "Ausgabe aktualisiert" }
        }
      },
      delete: {
        tags: ["Ausgaben"],
        summary: "Ausgabe löschen",
        parameters: [
          { name: "id", in: "query", required: true, schema: { type: "integer" } }
        ],
        responses: {
          "200": { description: "Ausgabe gelöscht" }
        }
      }
    },
    "/incomes": {
      get: {
        tags: ["Einnahmen"],
        summary: "Alle Einnahmen abrufen",
        parameters: [
          { $ref: "#/components/parameters/pageParam" },
          { $ref: "#/components/parameters/limitParam" },
          { $ref: "#/components/parameters/searchParam" },
          { name: "customerId", in: "query", schema: { type: "integer" } },
          { name: "startDate", in: "query", schema: { type: "string", format: "date" } },
          { name: "endDate", in: "query", schema: { type: "string", format: "date" } }
        ],
        responses: {
          "200": { description: "Liste der Einnahmen" }
        }
      },
      post: {
        tags: ["Einnahmen"],
        summary: "Neue Einnahme erstellen",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/IncomeInput" }
            }
          }
        },
        responses: {
          "201": { description: "Einnahme erstellt" }
        }
      },
      put: {
        tags: ["Einnahmen"],
        summary: "Einnahme aktualisieren",
        parameters: [
          { name: "id", in: "query", required: true, schema: { type: "integer" } }
        ],
        responses: {
          "200": { description: "Einnahme aktualisiert" }
        }
      },
      delete: {
        tags: ["Einnahmen"],
        summary: "Einnahme löschen",
        parameters: [
          { name: "id", in: "query", required: true, schema: { type: "integer" } }
        ],
        responses: {
          "200": { description: "Einnahme gelöscht" }
        }
      }
    },
    "/invoices": {
      get: {
        tags: ["Rechnungen"],
        summary: "Alle Rechnungen abrufen",
        parameters: [
          { $ref: "#/components/parameters/pageParam" },
          { $ref: "#/components/parameters/limitParam" },
          { name: "status", in: "query", schema: { type: "string", enum: ["DRAFT", "SENT", "PAID"] } },
          { name: "customerId", in: "query", schema: { type: "integer" } },
          { name: "invoiceNumber", in: "query", schema: { type: "string" } },
          { name: "startDate", in: "query", schema: { type: "string", format: "date" } },
          { name: "endDate", in: "query", schema: { type: "string", format: "date" } }
        ],
        responses: {
          "200": { description: "Liste der Rechnungen" }
        }
      },
      put: {
        tags: ["Rechnungen"],
        summary: "Rechnungsstatus aktualisieren",
        parameters: [
          { name: "id", in: "query", required: true, schema: { type: "integer" } }
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string", enum: ["DRAFT", "SENT", "PAID"] },
                  paidAt: { type: "string", format: "date-time" },
                  customerId: { type: "integer" }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Rechnung aktualisiert" }
        }
      },
      delete: {
        tags: ["Rechnungen"],
        summary: "Rechnung löschen",
        parameters: [
          { name: "id", in: "query", required: true, schema: { type: "integer" } }
        ],
        responses: {
          "200": { description: "Rechnung gelöscht" }
        }
      }
    }
  },
  tags: [
    { name: "Kunden", description: "Kundenverwaltung" },
    { name: "Ausgaben", description: "Ausgabenverwaltung" },
    { name: "Einnahmen", description: "Einnahmenverwaltung" },
    { name: "Rechnungen", description: "Rechnungsverwaltung" }
  ]
};

export async function GET() {
  return NextResponse.json(API_DOCUMENTATION, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
