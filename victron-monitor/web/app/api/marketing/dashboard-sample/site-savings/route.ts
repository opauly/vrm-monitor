// `GET /api/marketing/dashboard-sample/site-savings` — the savings-estimate
// counterpart of `./site-shape/route.ts`'s own header comment; see that
// file for why this is public and unauthenticated. Feeds `ShapeChart.tsx`'s
// savings panel the same fabricated `MARKETING_SAMPLE_SAVINGS` figure
// regardless of range or siteId.
import { NextResponse } from 'next/server';
import { MARKETING_SAMPLE_SAVINGS } from '@/lib/server/marketingSampleData';
import type { SiteShapeRange } from '@/lib/server/pipeline';

const VALID_RANGES: SiteShapeRange[] = ['today', 'week', 'month'];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const range = url.searchParams.get('range');
  if (!range || !VALID_RANGES.includes(range as SiteShapeRange)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  return NextResponse.json(MARKETING_SAMPLE_SAVINGS);
}
