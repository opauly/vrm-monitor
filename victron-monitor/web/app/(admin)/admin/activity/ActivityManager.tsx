'use client';

// Shared Origin filter for `/admin/activity`'s four cross-customer tables
// (PLAN_PHASE14.md §2 Step 7 / PLAN_PHASE16.md §8 Step 6 tables) — same
// admin/self-serve distinction `/admin/customers` filters by (its own
// `origin` column): Oscar's own admin-linked installations vs. real
// signed-up subscribers. One control here governs all four tables rather
// than four separate ones, since they're all views of the same
// cross-customer activity log at different granularities.
//
// A row with no resolvable customer (a rejected/forged billing webhook, an
// unverified signup) always stays visible regardless of the filter — it
// can't be classified by origin, and hiding it would defeat the one thing
// this page exists to surface (PLAN_PHASE16.md §7's "the only evidence an
// attempt happened").
import { useMemo, useState } from 'react';
import { Input, Select } from '@/components/ui';
import type { IngestionLogRecord, ReportRunRecord } from '@/lib/server/db';
import type { BillingEventRecord } from '@/lib/server/db/types';
import type { AdminCustomerRow, AdminSignupRow } from '@/lib/server/db/admin';
import { t, type Lang } from '@/lib/i18n/strings';
import { ActivityTable } from './ActivityTable';
import { BillingEventsTable } from './BillingEventsTable';
import { RecentSignupsPanel } from './RecentSignupsPanel';
import { ReportRunsTable } from './ReportRunsTable';
import styles from './activity.module.css';

type OriginFilter = 'all' | 'admin' | 'self_serve';

export function ActivityManager({
  customers,
  customerIdBySite,
  ingestions,
  billingEvents,
  signups,
  reportRuns,
  customerNameBySite,
  customerNameById,
  displayNameBySite,
  lang,
}: {
  customers: AdminCustomerRow[];
  customerIdBySite: Record<string, string>;
  ingestions: IngestionLogRecord[];
  billingEvents: BillingEventRecord[];
  signups: AdminSignupRow[];
  reportRuns: ReportRunRecord[];
  customerNameBySite: Record<string, string>;
  customerNameById: Record<string, string>;
  displayNameBySite: Record<string, string>;
  lang: Lang;
}) {
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  const originById = useMemo(() => new Map(customers.map((c) => [c.id, c.origin])), [customers]);

  function matchesOrigin(customerId: string | null | undefined): boolean {
    if (originFilter === 'all' || !customerId) return true;
    return originById.get(customerId) === originFilter;
  }

  // Live-filters all four tables at once as the admin types (2026-09-26,
  // Oscar's own request) — one search box for the whole page, same "one
  // control governs every table" precedent the Origin filter above already
  // sets, since they're all views of the same cross-customer log. Each
  // table matches against whatever text is actually meaningful for it
  // (there's no one shared shape across ingestion logs, billing events,
  // signups, and report runs to search generically).
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  function matchesQuery(...fields: (string | null | undefined)[]): boolean {
    if (!normalizedQuery) return true;
    return fields.filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery);
  }

  const filteredIngestions = useMemo(
    () =>
      ingestions.filter(
        (log) =>
          matchesOrigin(customerIdBySite[log.site_id]) &&
          matchesQuery(customerNameBySite[log.site_id], displayNameBySite[log.site_id], log.filename),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matchesOrigin/matchesQuery are rebuilt fresh every render from stable inputs already listed
    [ingestions, customerIdBySite, customerNameBySite, displayNameBySite, originById, originFilter, normalizedQuery],
  );
  const filteredBillingEvents = useMemo(
    () =>
      billingEvents.filter(
        (ev) => matchesOrigin(ev.customer_id) && matchesQuery(ev.customer_id ? customerNameById[ev.customer_id] : null, ev.event_type),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [billingEvents, customerNameById, originById, originFilter, normalizedQuery],
  );
  const filteredSignups = useMemo(
    () => signups.filter((s) => matchesOrigin(s.customer_id) && matchesQuery(s.email, s.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signups, originById, originFilter, normalizedQuery],
  );
  const filteredReportRuns = useMemo(
    () =>
      reportRuns.filter(
        (run) =>
          matchesOrigin(run.customer_id) &&
          matchesQuery(customerNameById[run.customer_id], displayNameBySite[run.site_id], run.trigger),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reportRuns, customerNameById, displayNameBySite, originById, originFilter, normalizedQuery],
  );

  return (
    <div>
      <div className={styles.filtersRow}>
        <label className={styles.filterLabel}>
          {t(lang, 'admin_customers_filter_origin')}
          <Select value={originFilter} onChange={(e) => setOriginFilter(e.target.value as OriginFilter)}>
            <option value="all">{t(lang, 'admin_common_all')}</option>
            <option value="admin">{t(lang, 'admin_customers_origin_admin')}</option>
            <option value="self_serve">{t(lang, 'admin_customers_origin_self_serve')}</option>
          </Select>
        </label>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(lang, 'admin_search_placeholder')}
          className={styles.searchBox}
        />
      </div>

      <ActivityTable ingestions={filteredIngestions} customerNameBySite={customerNameBySite} displayNameBySite={displayNameBySite} lang={lang} />

      <h2 style={{ marginTop: 36 }}>{t(lang, 'admin_activity_section_billing_title')}</h2>
      <p className="mono page-desc">
        {t(lang, 'admin_activity_billing_desc_1')}
        <code>vrm.billing_events</code>
        {t(lang, 'admin_activity_billing_desc_2')}
      </p>
      <BillingEventsTable events={filteredBillingEvents} customerNameById={customerNameById} lang={lang} />

      <h2 style={{ marginTop: 36 }}>{t(lang, 'admin_activity_section_signups_title')}</h2>
      <p className="mono page-desc">
        {t(lang, 'admin_activity_signups_desc_1')} <code>/signup</code> {t(lang, 'admin_activity_signups_desc_2')}
        <code>vrm.signup_requests</code>
        {t(lang, 'admin_activity_signups_desc_3')}
      </p>
      <RecentSignupsPanel signups={filteredSignups} customerNameById={customerNameById} lang={lang} />

      <h2 style={{ marginTop: 36 }}>{t(lang, 'admin_activity_section_reports_title')}</h2>
      <p className="mono page-desc">
        <code>vrm.report_runs</code>
        {t(lang, 'admin_activity_reports_desc_1')} <code>workflow_dispatch</code> {t(lang, 'admin_activity_reports_desc_2')}
      </p>
      <ReportRunsTable runs={filteredReportRuns} customerNameById={customerNameById} displayNameBySite={displayNameBySite} lang={lang} />
    </div>
  );
}
