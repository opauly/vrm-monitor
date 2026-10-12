// `GET /api/pipeline/insights/fleet` — the daily AI summary for the signed-in
// customer's own sites. The customer id comes from the session, never the request.
import { NextResponse } from 'next/server';
import { requireCustomerForRoute } from '@/lib/server/auth';
import { getCustomer, getDashboardAccess } from '@/lib/server/db';
import { getFleetInsight, toErrorResponse } from '@/lib/server/pipeline';

export async function GET() {
  const session = await requireCustomerForRoute();
  if (session instanceof NextResponse) return session;

  try {
    const customer = await getCustomer(session.customerId);
    if (!(await getDashboardAccess(customer))) return NextResponse.json({ error: 'not_entitled' }, { status: 403 });
    return NextResponse.json(await getFleetInsight(session.customerId, session.uiLanguage === 'es' ? 'es' : 'en'));
  } catch (err) {
    const res = toErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
