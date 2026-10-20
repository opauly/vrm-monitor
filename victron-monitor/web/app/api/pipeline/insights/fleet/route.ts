// `GET /api/pipeline/insights/fleet` — the daily AI summary for the signed-in
// customer's own sites. The customer id comes from the session, never the request.
import { NextResponse } from 'next/server';
import { requireCustomerForRoute } from '@/lib/server/auth';
import { assertOwnsProperty, getCustomer, getDashboardAccess, NotAuthorized } from '@/lib/server/db';
import { getFleetInsight, toErrorResponse } from '@/lib/server/pipeline';

// The server may have to rewrite the text or rebuild the forecast first; give it room to finish.
export const maxDuration = 60;

export async function GET(request: Request) {
  const session = await requireCustomerForRoute();
  if (session instanceof NextResponse) return session;

  try {
    const customer = await getCustomer(session.customerId);
    if (!(await getDashboardAccess(customer))) return NextResponse.json({ error: 'not_entitled' }, { status: 403 });
    // `?property=<id>`: the summary of one of this customer's properties; one that is not theirs is refused.
    const propertyId = new URL(request.url).searchParams.get('property');
    if (propertyId && !/^[0-9a-f-]{36}$/i.test(propertyId)) return NextResponse.json({ error: 'not_authorized' }, { status: 403 });
    if (propertyId) await assertOwnsProperty(session.customerId, propertyId);
    return NextResponse.json(await getFleetInsight(session.customerId, session.uiLanguage === 'es' ? 'es' : 'en', propertyId));
  } catch (err) {
    if (err instanceof NotAuthorized) return NextResponse.json({ error: 'not_authorized' }, { status: 403 });
    const res = toErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
