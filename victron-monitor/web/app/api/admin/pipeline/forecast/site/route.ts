// `GET /api/admin/pipeline/forecast/site?siteId=` — a site's tonight / tomorrow
// forecast for the admin (no ownership check; `requireAdminForRoute()` is the gate).
import { NextResponse } from 'next/server';
import { requireAdminForRoute } from '@/lib/server/auth';
import { getSiteForecast, toErrorResponse } from '@/lib/server/pipeline';

export async function GET(request: Request) {
  const session = await requireAdminForRoute();
  if (session instanceof NextResponse) return session;

  const siteId = new URL(request.url).searchParams.get('siteId')?.trim();
  if (!siteId) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  try {
    return NextResponse.json(await getSiteForecast(siteId));
  } catch (err) {
    const res = toErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
