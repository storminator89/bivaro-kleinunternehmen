import { describe, expect, it } from 'vitest'
import { calculateInvoiceAmounts, calculateInvoiceTaxGroups } from '../invoice-calculation'

describe('calculateInvoiceAmounts', () => {
  it('uses deterministic decimal multiplication and rounds each line net', () => {
    const result = calculateInvoiceAmounts([
      { quantity: 100, unitPrice: 0.3333, taxRate: 0 },
      { quantity: 0.333, unitPrice: 100.1234, taxRate: 0 },
    ])
    expect(result.lines).toEqual([
      { netAmount: 33.33, taxAmount: 0 },
      { netAmount: 33.34, taxAmount: 0 },
    ])
    expect(result.netAmount).toBe(66.67)
    expect(result.grossAmount).toBe(66.67)
  })

  it('rounds one tax value per category and rate group', () => {
    const result = calculateInvoiceAmounts([
      { quantity: 1, unitPrice: 0.03, taxRate: 19, taxCategory: 'S' },
      { quantity: 1, unitPrice: 0.03, taxRate: 19, taxCategory: 'S' },
    ])
    expect(result.lines.map(line => line.taxAmount)).toEqual([0.01, 0.01])
    expect(result.taxAmount).toBe(0.01)
    expect(result.grossAmount).toBe(0.07)
    expect(calculateInvoiceTaxGroups([
      { quantity: 1, unitPrice: 0.03, taxRate: 19, taxCategory: 'S' },
      { quantity: 1, unitPrice: 0.03, taxRate: 19, taxCategory: 'S' },
    ])).toEqual([{ category: 'S', rate: 19, basisAmount: 0.06, taxAmount: 0.01 }])
  })

  it('does not accumulate binary floating point artifacts in repeated values', () => {
    const result = calculateInvoiceAmounts(Array.from({ length: 1000 }, () => ({ quantity: 1, unitPrice: 0.01, taxRate: 19 })))
    expect(result.netAmount).toBe(10)
    expect(result.taxAmount).toBe(1.9)
    expect(result.grossAmount).toBe(11.9)
    expect(calculateInvoiceTaxGroups(Array.from({ length: 1000 }, () => ({ quantity: 1, unitPrice: 0.01, taxRate: 19 })))).toEqual([{ category: 'S', rate: 19, basisAmount: 10, taxAmount: 1.9 }])
  })

  it('keeps categories with the same rate in separate tax groups', () => {
    const groups = calculateInvoiceTaxGroups([
      { quantity: 1, unitPrice: 0.08, taxRate: 0, taxCategory: 'E' },
      { quantity: 1, unitPrice: 0.08, taxRate: 0, taxCategory: 'Z' },
    ])
    expect(groups).toEqual([
      { category: 'E', rate: 0, basisAmount: 0.08, taxAmount: 0 },
      { category: 'Z', rate: 0, basisAmount: 0.08, taxAmount: 0 },
    ])
  })

  it('rejects invalid or negative numeric input', () => {
    expect(() => calculateInvoiceAmounts([{ quantity: 0, unitPrice: 10 }])).toThrow(/Menge/)
    expect(() => calculateInvoiceAmounts([{ quantity: 1, unitPrice: -1 }])).toThrow(/Einzelpreis/)
    expect(() => calculateInvoiceAmounts([{ quantity: 1, unitPrice: Number.NaN }])).toThrow(/Einzelpreis/)
  })
})
