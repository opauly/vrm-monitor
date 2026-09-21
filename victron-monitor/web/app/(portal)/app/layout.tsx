import type { ReactNode } from 'react';
import { AppShell, type AppNavItem } from '@/components/app';
import { requireCustomerAllowPending } from '@/lib/server/auth';
import { t } from '@/lib/i18n/strings';

// First statement of the layout, per PLAN_PHASE14.md §1.2 rule 4 —
// this is what actually keeps a signed-out visitor or a wrong-role (admin)
// session out of everything under `/app/*`; the fact that this same layout
// also happens to build the nav is incidental. Every page under
// `app/(portal)/app/**` inherits this without repeating the check, because
// Next.js always renders a route's layouts before its page.
//
// `requireCustomerAllowPending()`, NOT `requireCustomer()` (PLAN_PHASE16.md
// §6.4): this layout wraps EVERY page under `/app/**`, including
// `/app/billing` itself — if the pending-account gate ran here too, a
// pending customer visiting `/app/billing` directly would be redirected to
// `/app/billing` by the layout that renders `/app/billing`, an infinite
// redirect loop. The actual gate still applies: each individual page under
// this layout makes its own `provisioningState` decision (see e.g.
// `app/(portal)/app/page.tsx`'s own "never inferred from layout nesting"
// comment) — most now via `requireCustomerAllowPending()` plus an explicit
// `PendingSubscriptionUpsell` branch (2026-09-21, `lib/server/auth.ts:
// requireCustomer()`'s own comment has the full list and why), a few still
// via plain `requireCustomer()`'s own redirect where no page body would
// make sense pending (e.g. a site's own drill-down page).
export default async function PortalLayout({ children }: { children: ReactNode }) {
  const session = await requireCustomerAllowPending();

  const navItems: AppNavItem[] = [
    { href: '/app', label: t(session.uiLanguage, 'nav_reports') },
    { href: '/app/upload', label: t(session.uiLanguage, 'nav_upload') },
    { href: '/app/sites', label: t(session.uiLanguage, 'nav_my_sites') },
    // Shown to every customer regardless of tier — navigation-level gating
    // is UX, never the control (AppShellProps' own comment); the page
    // itself (requireCustomerAllowPending() + getDashboardAccess()) decides
    // real content vs. one of two upsells (pending-subscription vs.
    // tier), same as /app/branding below.
    { href: '/app/dashboard', label: t(session.uiLanguage, 'nav_dashboard') },
    { href: '/app/branding', label: t(session.uiLanguage, 'nav_branding') },
    { href: '/app/billing', label: t(session.uiLanguage, 'nav_billing') },
    { href: '/app/profile', label: t(session.uiLanguage, 'nav_profile') },
    { href: '/app/help', label: t(session.uiLanguage, 'nav_help') },
  ];

  return (
    <AppShell role="customer" email={session.email} navItems={navItems} lang={session.uiLanguage}>
      {children}
    </AppShell>
  );
}
