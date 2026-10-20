import { NextResponse } from 'next/server';
import { API_DOCUMENTATION } from '@/lib/api-documentation';

export async function GET() {
  return NextResponse.json(API_DOCUMENTATION, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
