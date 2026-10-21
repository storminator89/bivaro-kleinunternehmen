import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRaw, getHeapStatistics } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  getHeapStatistics: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: queryRaw } }))
vi.mock('node:v8', () => ({ getHeapStatistics }))

import { GET } from '@/app/api/health/route'

const mebibyte = 1024 * 1024

function mockMemory(used: number, total: number, limit: number) {
  vi.spyOn(process, 'memoryUsage').mockReturnValue({
    rss: total * mebibyte,
    heapUsed: used * mebibyte,
    heapTotal: total * mebibyte,
    external: 0,
    arrayBuffers: 0,
  })
  getHeapStatistics.mockReturnValue({ heap_size_limit: limit * mebibyte })
}

beforeEach(() => {
  vi.clearAllMocks()
  queryRaw.mockResolvedValue([{ result: 1 }])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('health route memory capacity', () => {
  it('keeps a mostly occupied small allocation healthy and preserves existing memory fields', async () => {
    mockMemory(57, 61, 4144)

    const response = await GET()
    const health = await response.json()

    expect(response.status).toBe(200)
    expect(health.status).toBe('healthy')
    expect(health.checks.database.status).toBe('up')
    expect(health.checks.memory).toEqual({
      used: 57, total: 61, percentage: 93, limit: 4144, limitPercentage: 1,
    })
    expect(queryRaw).toHaveBeenCalledOnce()
    expect(response.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate')
  })

  it('degrades when usage exceeds 90% of the actual heap limit', async () => {
    mockMemory(950, 980, 1000)

    const response = await GET()
    const health = await response.json()

    expect(response.status).toBe(200)
    expect(health.status).toBe('degraded')
    expect(health.checks.database.status).toBe('up')
    expect(health.checks.memory.limitPercentage).toBe(95)
  })

  it('keeps a database failure unhealthy with HTTP 503 even under memory pressure', async () => {
    mockMemory(950, 980, 1000)
    queryRaw.mockRejectedValue(new Error('Database unavailable'))

    const response = await GET()
    const health = await response.json()

    expect(response.status).toBe(503)
    expect(health.status).toBe('unhealthy')
    expect(health.checks.database).toEqual({ status: 'down' })
    expect(health.checks.memory.limitPercentage).toBe(95)
  })
})
