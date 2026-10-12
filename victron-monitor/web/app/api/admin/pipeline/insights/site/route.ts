// `GET /api/admin/pipeline/insights/site?siteId=` — a site's daily AI summary for
// the admin. No ownership check (an admin may read every site); `requireAdminForRoute()`
// is the gate, like every other `app/api/admin/pipeline/*` route.
import { NextResponse } from 'next/server';
import { requireAdminForRoute } from '@/lib/server/auth';
import { getSiteInsight, toErrorResponse } from '@/lib/server/pipeline';

export async function GET(request: Request) {
  const session = await requireAdminForRoute();
  if (session instanceof NextResponse) return session;

  const siteId = new URL(request.url).searchParams.get('siteId')?.trim();
  if (!siteId) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  try {
    return NextResponse.json(await getSiteInsight(siteId, session.uiLanguage === 'es' ? 'es' : 'en'));
  } catch (err) {
    const res = toErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
