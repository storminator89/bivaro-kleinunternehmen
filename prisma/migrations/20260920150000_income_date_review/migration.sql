-- Existing manual incomes predate the strict business-date contract. Preserve
-- every stored value and leave the historical date decision to a human review.
-- The NOT EXISTS guard makes this safe if the migration is replayed manually.
INSERT INTO "AuditLog" (
    "userId",
    "action",
    "entityType",
    "entityId",
    "entityName",
    "newValues",
    "metadata"
)
SELECT
    i."userId",
    'REVIEW',
    'Income',
    CAST(i."id" AS TEXT),
    'Prüfhinweis: ' || i."description",
    json_object(
        'originalDate', CASE
            WHEN typeof(i."date") IN ('integer', 'real') THEN strftime('%Y-%m-%dT%H:%M:%fZ', i."date" / 1000.0, 'unixepoch')
            ELSE i."date"
        END,
        'originalDateRaw', i."date",
        'guessedDate', NULL
    ),
    json_object(
        'operation', 'income.legacy-date-review',
        'reason', 'Manuelle Einnahme bestand vor der strikten Datumsprüfung; historisches Zahlungsdatum bitte prüfen.',
        'originalDate', CASE
            WHEN typeof(i."date") IN ('integer', 'real') THEN strftime('%Y-%m-%dT%H:%M:%fZ', i."date" / 1000.0, 'unixepoch')
            ELSE i."date"
        END,
        'originalDateRaw', i."date",
        'guessedDate', NULL
    )
FROM "Income" i
WHERE i."invoiceId" IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM "AuditLog" a
      WHERE a."userId" = i."userId"
        AND a."action" = 'REVIEW'
        AND a."entityType" = 'Income'
        AND a."entityId" = CAST(i."id" AS TEXT)
        AND a."metadata" LIKE '%income.legacy-date-review%'
  )
;
