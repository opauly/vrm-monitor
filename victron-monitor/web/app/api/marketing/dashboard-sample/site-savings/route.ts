// `GET /api/marketing/dashboard-sample/site-savings` — the savings-estimate
// counterpart of `./site-shape/route.ts`'s own header comment; see that
// file for why this is public and unauthenticated. Feeds `ShapeChart.tsx`'s
// savings panel a fabricated figure that scales with the requested range
// (today/7-day/30-day totals, not one repeated number — see
// `marketingSampleData.ts`'s own header comment), ignoring siteId.
import { NextResponse } from 'next/server';
import { marketingSampleSavings } from '@/lib/server/marketingSampleData';
import type { SiteShapeRange } from '@/lib/server/pipeline';

const VALID_RANGES: SiteShapeRange[] = ['today', 'week', 'month'];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const range = url.searchParams.get('range');
  if (!range || !VALID_RANGES.includes(range as SiteShapeRange)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  return NextResponse.json(marketingSampleSavings(range as SiteShapeRange));
}
