'use client';

// `/admin/activity`'s "Recent signups" panel (PLAN_PHASE16.md §3.7, §7,
// §8 Step 6) — reads `vrm.signup_requests` directly, newest first. Per the
// coder brief: "the only place a signup spam wave is visible before it
// shows up in the Resend bill." Placed on THIS page, next to billing
// events, rather than on `/admin/customers` — both are the same kind of
// concern (abuse/forgery visibility a human would otherwise never see),
// and `/admin/customers` is already the page that lists what a signup
// eventually BECOMES (a `vrm.customers` row with `origin='self_serve'`),
// not what it started as.
//
// `consumed_at` set = the visitor actually clicked their verification link
// and (per §5.5) is a real, if not-yet-paying, `vrm.customers` row now —
// `customer_id` links straight to it. Unconsumed = still just an email
// address that asked for a link; `expires_at` (24h, §3.7) is shown so a
// stale, never-clicked row reads as "expired," not "broken."
import type { AccountType } from '@/lib/server/db/types';
import type { AdminSignupRow } from '@/lib/server/db/admin';
import { formatDateTime } from '@/lib/dates';
import { Table } from '@/components/ui';
import { t, type Lang } from '@/lib/i18n/strings';
import styles from './activity.module.css';

function accountTypeLabel(accountType: AccountType, lang: Lang): string {
  return accountType === 'installer' ? t(lang, 'admin_customers_type_installer') : t(lang, 'admin_customers_type_owner');
}

export function RecentSignupsPanel({
  signups,
  customerNameById,
  lang,
}: {
  signups: AdminSignupRow[];
  customerNameById: Record<string, string>;
  lang: Lang;
}) {
  if (signups.length === 0) {
    return <p className={styles.empty}>{t(lang, 'admin_activity_no_signups')}</p>;
  }

  return (
    <Table>
      <thead>
        <tr>
          <th>{t(lang, 'admin_activity_col_email')}</th>
          <th>{t(lang, 'admin_activity_col_name')}</th>
          <th>{t(lang, 'admin_customers_col_type')}</th>
          <th>{t(lang, 'admin_activity_col_requested')}</th>
          <th>{t(lang, 'admin_activity_col_status')}</th>
        </tr>
      </thead>
      <tbody>
        {signups.map((s) => {
          const expired = s.expired;
          return (
            <tr key={s.id}>
              <td className="mono">{s.email}</td>
              <td>{s.name}</td>
              <td>{accountTypeLabel(s.account_type, lang)}</td>
              <td>{formatDateTime(s.created_at)}</td>
              <td>
                {s.consumed_at ? (
                  <span className={styles.appliedBadge}>
                    {t(lang, 'admin_activity_verified_label').replace('{date}', formatDateTime(s.consumed_at))}
                    {s.customer_id && ` → ${customerNameById[s.customer_id] ?? s.customer_id}`}
                  </span>
                ) : expired ? (
                  <span className={styles.subtleBadge}>{t(lang, 'admin_activity_expired_unverified')}</span>
                ) : (
                  <span className={styles.subtleBadge}>{t(lang, 'admin_activity_awaiting_verification')}</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
