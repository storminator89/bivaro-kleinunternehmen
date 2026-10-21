import { NextResponse } from 'next/server'
import { getHeapStatistics } from 'node:v8'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded'
  timestamp: string
  version: string
  uptime: number
  checks: {
    database: {
      status: 'up' | 'down'
      latency?: number
    }
    memory: {
      used: number
      total: number
      percentage: number
      limit: number
      limitPercentage: number
    }
  }
}

export async function GET() {
  const startTime = Date.now()
  
  const health: HealthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '0.1.0',
    uptime: process.uptime(),
    checks: {
      database: {
        status: 'down'
      },
      memory: {
        used: 0,
        total: 0,
        percentage: 0,
        limit: 0,
        limitPercentage: 0
      }
    }
  }

  // Database health check
  try {
    const dbStart = Date.now()
    await prisma.$queryRaw`SELECT 1`
    health.checks.database = {
      status: 'up',
      latency: Date.now() - dbStart
    }
  } catch {
    health.checks.database = { status: 'down' }
    health.status = 'unhealthy'
  }

  // Memory check
  const memUsage = process.memoryUsage()
  const heapLimit = getHeapStatistics().heap_size_limit
  health.checks.memory = {
    used: Math.round(memUsage.heapUsed / 1024 / 1024),
    total: Math.round(memUsage.heapTotal / 1024 / 1024),
    percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
    limit: Math.round(heapLimit / 1024 / 1024),
    limitPercentage: Math.round((memUsage.heapUsed / heapLimit) * 100)
  }

  // heapTotal is currently allocated space; warn against V8's actual heap limit.
  if (health.checks.memory.limitPercentage > 90) {
    health.status = health.status === 'healthy' ? 'degraded' : health.status
  }

  const statusCode = health.status === 'healthy' ? 200 : 
                     health.status === 'degraded' ? 200 : 503

  return NextResponse.json(health, {
    status: statusCode,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Response-Time': `${Date.now() - startTime}ms`
    }
  })
}
