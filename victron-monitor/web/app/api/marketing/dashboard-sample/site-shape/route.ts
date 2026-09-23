// `GET /api/marketing/dashboard-sample/site-shape` — feeds the REAL
// `ShapeChart.tsx` component when it's embedded on the public marketing
// site (`components/marketing/DashboardPreview/DashboardPreview.tsx`),
// same component and same JSON contract `/api/admin/pipeline/vrm-fleet/
// site-shape` and `/api/pipeline/vrm-fleet/site-shape` already serve —
// this is the third, public variant. Deliberately no auth gate and no
// `siteId` lookup: unlike those two routes, there is no real site or
// customer behind this data at all, so there's nothing to authorize or
// look up — `marketingSampleShape()` is fully fabricated (see that file's
// own header comment) and returned unconditionally to anyone who asks,
// same as the fabricated JSON `sample_report.png`'s own PDF was rendered
// from. `siteId` is accepted but ignored (`ShapeChart` always sends one).
import { NextResponse } from 'next/server';
import { marketingSampleShape } from '@/lib/server/marketingSampleData';
import type { SiteShapeRange } from '@/lib/server/pipeline';

const VALID_RANGES: SiteShapeRange[] = ['today', 'week', 'month'];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const range = url.searchParams.get('range');
  if (!range || !VALID_RANGES.includes(range as SiteShapeRange)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  return NextResponse.json(marketingSampleShape(range as SiteShapeRange));
}
