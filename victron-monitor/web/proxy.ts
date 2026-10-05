// Request entry point. Two jobs:
//
//  1. Content-Security-Policy with a per-request nonce for every dynamic route
//     that handles sessions, forms or card entry (see lib/csp.ts for why only
//     those). Next.js reads the nonce off the CSP header of the incoming
//     request during rendering and stamps it onto its own bootstrap scripts.
//
//  2. Supabase token refresh (PLAN_PHASE14.md §2 Step 3, originally called
//     `middleware.ts`; Next.js 16 renamed that convention to `proxy.ts`) —
//     only for the routes that actually touch a session: `/app`, `/admin`,
//     `/login`, `/activate`. `/signup`, `/forgot` and `/unsubscribe` need the
//     CSP but never read or write a Supabase cookie, so running the Auth
//     round trip there would be per-request latency for nothing.
import { NextRequest, NextResponse } from 'next/server';
import { refreshSupabaseSession } from '@/lib/server/supabase-middleware';
import { nonceCsp } from './lib/csp';

const SESSION_PATH = /^\/(?:app|admin|login|activate)(?:\/|$)/;

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = nonceCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = SESSION_PATH.test(request.nextUrl.pathname)
    ? await refreshSupabaseSession(new NextRequest(request, { headers: requestHeaders }))
    : NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: ['/app/:path*', '/admin/:path*', '/login', '/activate/:path*', '/signup/:path*', '/forgot', '/unsubscribe'],
};
