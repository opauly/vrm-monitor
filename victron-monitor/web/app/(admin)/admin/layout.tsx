import type { ReactNode } from 'react';
import { AppShell, type AppNavItem } from '@/components/app';
import { requireAdmin } from '@/lib/server/auth';
import { t } from '@/lib/i18n/strings';

// First statement of the layout — see the matching comment in
// app/(portal)/app/layout.tsx; same reasoning, admin side.
//
// Nav labels went through three phases: Spanish by original product
// decision (PLAN_PHASE14.md §1.10 / PLAN_PHASE13.md §0.3 Q2, ported from
// `pages/06_vrm_monitor.py`'s tab names), then English-only inline literals
// (2026-08-19, "now let's use English only across all account types" —
// `lib/i18n/strings.ts` didn't have admin-specific keys yet so there was
// nothing to route through), and now (2026-09-24, Oscar's own request: "I
// want admin panel to have the option to switch languages, English by
// default") real `admin_nav_*` keys in `STRINGS`, driven by `session.
// uiLanguage` — which for admin comes from the `admin_lang` cookie
// (`AdminLangSwitcher`, rendered in `AppShell`'s account corner), not a
// `vrm.customers` row, since admin has none. Defaults to English exactly
// like before when that cookie is unset. Routes below don't exist until
// Step 7 (customers/sites) or Step 5-7 (upload/reports/activity) and 404
// until then — same precedent as Nav's "Log in" link in Step 2 and
// AppShell's own /app links here.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireAdmin();
  const lang = session.uiLanguage;

  // "VRM Fleet" is `personal: true` (2026-08-19, Oscar's own request) — the
  // one tab here that isn't subscriber data: every other route reads/writes
  // `vrm.customers`/`vrm.sites` scoped to a `customer_id`, while VRM Fleet
  // is Oscar's own VRM account, unrelated to any subscriber until he
  // explicitly links an installation to one. `AppShell` renders it in a
  // separated, highlighted group so that distinction is visible, not just
  // documented here.
  //
  // Merged 2026-08-31 (Oscar's own request — two tabs over the same site
  // set was confusing): "Fleet Health" and "VRM Fleet" used to be separate
  // top-level tabs, one for monitoring already-linked sites and one for
  // linking new ones. Now there is one nav entry, landing on the live
  // dashboard (`/admin/fleet`) — linking a new installation is still
  // `/admin/vrm-fleet`, reached via a "Manage installations" link on that
  // dashboard rather than its own top-level tab.
  const navItems: AppNavItem[] = [
    { href: '/admin/customers', label: t(lang, 'admin_nav_customers') },
    { href: '/admin/sites', label: t(lang, 'admin_nav_sites') },
    { href: '/admin/upload', label: t(lang, 'admin_nav_upload') },
    { href: '/admin/reports', label: t(lang, 'admin_nav_reports') },
    { href: '/admin/activity', label: t(lang, 'admin_nav_activity') },
    { href: '/admin/analytics', label: t(lang, 'admin_nav_analytics') },
    { href: '/admin/fleet', label: t(lang, 'admin_nav_fleet'), personal: true },
    { href: '/admin/help', label: t(lang, 'admin_nav_help') },
  ];

  return (
    <AppShell role="admin" email={session.email} navItems={navItems} lang={lang}>
      {children}
    </AppShell>
  );
}
