import { NextResponse } from 'next/server';
import { API_DOCUMENTATION } from '@/app/api/v1/docs/route';

export async function GET() {
  return NextResponse.json(API_DOCUMENTATION, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
