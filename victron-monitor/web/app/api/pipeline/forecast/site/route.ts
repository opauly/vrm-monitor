// `GET /api/pipeline/forecast/site?siteId=` — the tonight / tomorrow forecast for one
// of the signed-in customer's sites. Same two guards as the other customer routes:
// the site must be THIS customer's (assertOwnsSite) and the plan must include the
// live dashboard (getDashboardAccess).
import { NextResponse } from 'next/server';
import { requireCustomerForRoute } from '@/lib/server/auth';
import { assertOwnsSite, getCustomer, getDashboardAccess, NotAuthorized } from '@/lib/server/db';
import { getSiteForecast, toErrorResponse } from '@/lib/server/pipeline';

// The server may have to rewrite the text or rebuild the forecast first; give it room to finish.
export const maxDuration = 60;

export async function GET(request: Request) {
  const session = await requireCustomerForRoute();
  if (session instanceof NextResponse) return session;

  const siteId = new URL(request.url).searchParams.get('siteId')?.trim();
  if (!siteId) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  try {
    const customer = await getCustomer(session.customerId);
    if (!(await getDashboardAccess(customer))) return NextResponse.json({ error: 'not_entitled' }, { status: 403 });
    await assertOwnsSite(session.customerId, siteId);
    return NextResponse.json(await getSiteForecast(siteId));
  } catch (err) {
    if (err instanceof NotAuthorized) return NextResponse.json({ error: 'not_authorized' }, { status: 403 });
    const res = toErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
