// `GET /api/admin/pipeline/insights/fleet` — the daily AI summary across EVERY site, for the admin.
import { NextResponse } from 'next/server';
import { requireAdminForRoute } from '@/lib/server/auth';
import { getFleetInsight, toErrorResponse } from '@/lib/server/pipeline';

// The server may have to rewrite the text or rebuild the forecast first; give it room to finish.
export const maxDuration = 60;

export async function GET(request: Request) {
  const session = await requireAdminForRoute();
  if (session instanceof NextResponse) return session;

  try {
    // `?property=<id>`: one property's sites instead of every site.
    const params = new URL(request.url).searchParams;
    const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
    // `?customer=<id>`: that customer's sites (the admin's own fleet account by default on the page); none = every site.
    return NextResponse.json(await getFleetInsight(uuid(params.get('customer')), session.uiLanguage === 'es' ? 'es' : 'en', uuid(params.get('property'))));
  } catch (err) {
    const res = toErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
