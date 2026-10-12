// `GET /api/admin/pipeline/insights/fleet` — the daily AI summary across EVERY site, for the admin.
import { NextResponse } from 'next/server';
import { requireAdminForRoute } from '@/lib/server/auth';
import { getFleetInsight, toErrorResponse } from '@/lib/server/pipeline';

export async function GET() {
  const session = await requireAdminForRoute();
  if (session instanceof NextResponse) return session;

  try {
    return NextResponse.json(await getFleetInsight(null, session.uiLanguage === 'es' ? 'es' : 'en'));
  } catch (err) {
    const res = toErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
