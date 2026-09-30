import Link from 'next/link';
import { t, type Lang } from '@/lib/i18n/strings';
import { daysUntil } from '@/lib/dates';
import styles from './BillingBanners.module.css';

/** The subset of `BillingStatusOut` (`lib/server/pipeline.ts`) this banner
 * needs — deliberately narrow, not the whole type, so `/app/page.tsx` can
 * pass a `getBillingStatus()` read straight through and `BillingManager.tsx`
 * can pass its own live `status` state without either caller needing to
 * know this component exists beyond these four fields. */
export type BillingBannerStatus = {
  billing_status: string | null;
  over_limit: boolean;
  active_sites: number;
  site_limit: number | null;
  /** PLAN_BETA_PROGRAM.md §5 Phase 5 — both existing callers already pass
   * a full `BillingStatusOut` (`getBillingStatus()`'s own return type),
   * which has carried this field since Phase 2, so neither call site
   * needed a change to satisfy this. */
  beta: { tier: string; status: string; expires_at: string | null } | null;
};

export type BillingBannersProps = {
  status: BillingBannerStatus;
  lang: Lang;
};

// Customer-facing failure banners (PLAN_PHASE16.md §7, §8 Step 6) —
// rendered on both `/app` (the portal home) and `/app/billing` (Step 5's
// own `over_limit` banner, moved here so both pages share one component
// instead of drifting apart — see `BillingManager.tsx`'s own note on why
// it now imports this instead of rendering its own `<div className=
// {styles.banner}>` inline). A plain Server Component, same shape as
// `VrmConnectionBanner.tsx` — nothing here is interactive.
//
// Two independent conditions, both can show at once (a customer can be
// simultaneously `past_due` AND over their (now-lower) site limit if a
// downgrade landed while a renewal was already failing):
//   - `billing_status === 'past_due'` — §7's "Renewal fails" row: entitled
//     through Q8's grace window, but the customer needs to know their card
//     needs attention before that window runs out.
//   - `over_limit` — §7's "Downgrade puts customer over site_limit" row:
//     every existing site keeps working, only NEW site creation is blocked
//     (`canAddSite()`, unchanged by this banner).
export function BillingBanners({ status, lang }: BillingBannersProps) {
  const showPastDue = status.billing_status === 'past_due';
  const showOverLimit = status.over_limit;

  // PLAN_BETA_PROGRAM.md §5 Phase 5 — a free-tier grant approaching its
  // expiry, mirroring the "ending soon" email (§ Phase 3) as an on-page
  // reminder. `free_lifetime` has no `expires_at` at all (never a real
  // date to warn about); a grant already past its expiry is
  // `billing_status='beta_ended'` by the time anything reads this (§5 row
  // 3/4), not `status: 'active'` any more, so a negative day count here
  // would mean this rendered from stale data — guarded out rather than
  // shown as "-1 days left."
  const betaExpiresAt =
    status.beta?.status === 'active' && (status.beta.tier === 'free_lifetime' || status.beta.tier === 'free_until')
      ? status.beta.expires_at
      : null;
  const daysLeft = betaExpiresAt ? daysUntil(betaExpiresAt) : null;
  const showBetaEnding = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;

  if (!showPastDue && !showOverLimit && !showBetaEnding) return null;

  return (
    <div className={styles.wrap}>
      {showPastDue && (
        <div className={styles.banner} role="alert">
          <p>
            {t(lang, 'billing_past_due_banner')} <Link href="/app/billing">{t(lang, 'billing_past_due_banner_link')}</Link>
          </p>
        </div>
      )}
      {showOverLimit && (
        <div className={styles.banner} role="alert">
          <p>
            {t(lang, 'billing_status_over_limit_banner')
              .replace('{active}', String(status.active_sites))
              .replace('{limit}', status.site_limit === null ? '—' : String(status.site_limit))}
          </p>
        </div>
      )}
      {showBetaEnding && (
        <div className={styles.banner} role="alert">
          <p>{t(lang, 'billing_beta_ending_banner').replace('{days}', String(daysLeft))}</p>
        </div>
      )}
    </div>
  );
}
