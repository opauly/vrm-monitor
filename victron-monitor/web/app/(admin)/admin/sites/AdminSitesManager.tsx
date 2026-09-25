'use client';

import { Fragment, startTransition, useMemo, useState } from 'react';
import { Button, Select, Table } from '@/components/ui';
import { formatDateTime as formatDateTimeShared } from '@/lib/dates';
import type { SiteRecord } from '@/lib/server/db';
import type { AdminCustomerRow } from '@/lib/server/db/admin';
import { t, type Lang } from '@/lib/i18n/strings';
import { AdminSiteEditForm } from './AdminSiteEditForm';
import { reassignSiteAction } from './actions';
import styles from './sites.module.css';

function systemTypeLabel(type: string, lang: Lang): string {
  if (type === 'hybrid') return t(lang, 'system_type_hybrid');
  if (type === 'off_grid') return t(lang, 'system_type_off_grid');
  if (type === 'grid_zero') return t(lang, 'admin_sites_table_type_grid_zero');
  return type;
}

function sourceLabel(source: string, lang: Lang): string {
  if (source === 'vrm_api') return t(lang, 'sites_source_vrm_api');
  if (source === 'csv_upload') return t(lang, 'admin_sites_table_source_csv');
  return source;
}

// Same admin/self-serve distinction `/admin/customers` filters by (its own
// `origin` column) — Oscar's own admin-linked installations vs. real
// signed-up subscribers.
type OriginFilter = 'all' | 'admin' | 'self_serve';

function formatDateTime(iso: string | null): string {
  // Delegates to lib/dates.ts's deterministic formatter (2026-08-19 — a
  // real Next.js hydration error surfaced this exact pattern elsewhere in
  // the admin UI). Kept as a local wrapper only for the null-safe
  // signature every call site in this file already relies on.
  if (!iso) return '—';
  return formatDateTimeShared(iso);
}

export function AdminSitesManager({
  sites,
  customers,
  lang,
}: {
  sites: SiteRecord[];
  customers: AdminCustomerRow[];
  lang: Lang;
}) {
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [reassignTarget, setReassignTarget] = useState<Record<string, string>>({});
  const [reassignBusy, setReassignBusy] = useState<Record<string, boolean>>({});
  const [reassignError, setReassignError] = useState<Record<string, string>>({});

  const customerNameById = new Map(customers.map((c) => [c.id, c.name]));
  const customerOriginById = new Map(customers.map((c) => [c.id, c.origin]));

  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  const filteredSites = useMemo(
    () => sites.filter((s) => originFilter === 'all' || customerOriginById.get(s.customer_id) === originFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- customerOriginById is rebuilt fresh every render from `customers`, not stable across renders
    [sites, originFilter, customers],
  );

  function handleReassign(siteId: string) {
    const target = reassignTarget[siteId];
    if (!target) return;
    setReassignBusy((b) => ({ ...b, [siteId]: true }));
    setReassignError((e) => ({ ...e, [siteId]: '' }));
    startTransition(async () => {
      const result = await reassignSiteAction(siteId, target);
      setReassignBusy((b) => ({ ...b, [siteId]: false }));
      if (result.error) setReassignError((e) => ({ ...e, [siteId]: result.error! }));
    });
  }

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
        <span className={styles.filterCount}>
          {t(lang, 'admin_sites_filter_count').replace('{n}', String(filteredSites.length)).replace('{m}', String(sites.length))}
        </span>
      </div>

      <Table>
        <thead>
          <tr>
            <th>{t(lang, 'admin_sites_col_site')}</th>
            <th>{t(lang, 'admin_sites_col_site_id')}</th>
            <th>{t(lang, 'admin_sites_col_customer')}</th>
            <th>{t(lang, 'admin_sites_col_type')}</th>
            <th>{t(lang, 'admin_sites_col_kwp')}</th>
            <th>{t(lang, 'admin_sites_col_battery')}</th>
            <th>{t(lang, 'admin_sites_col_source')}</th>
            <th>{t(lang, 'admin_sites_col_last_sync')}</th>
            <th>{t(lang, 'admin_common_active')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filteredSites.map((s) => (
            <Fragment key={s.site_id}>
              <tr>
                <td>{s.display_name}</td>
                <td className="mono">{s.site_id}</td>
                <td>{customerNameById.get(s.customer_id) ?? '—'}</td>
                <td>{systemTypeLabel(s.system_type, lang)}</td>
                <td>{s.pv_kwp ?? '—'}</td>
                <td>{s.battery_usable_kwh ?? '—'}</td>
                <td className="mono">{sourceLabel(s.source, lang)}</td>
                <td>
                  {/* `vrm_sync_enabled === false` on an otherwise `vrm_api` site is
                     §9's "installation removed / no longer shared" row — the site
                     kept its data and its source, but syncing has been paused;
                     surfaced here, next to the timestamp/error it explains, rather
                     than as a separate column. */}
                  {s.source === 'vrm_api' ? (
                    <>
                      {formatDateTime(s.vrm_last_synced_at)}
                      {!s.vrm_sync_enabled && <div className={styles.syncPaused}>{t(lang, 'admin_sites_sync_paused')}</div>}
                      {s.vrm_last_sync_error && <div className={styles.syncError}>{s.vrm_last_sync_error}</div>}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  <span className={s.active ? styles.statusActive : styles.statusInactive}>
                    {s.active ? t(lang, 'admin_common_yes') : t(lang, 'admin_common_no')}
                  </span>
                </td>
                <td>
                  <Button type="button" variant="ghost" onClick={() => setEditingSiteId(editingSiteId === s.site_id ? null : s.site_id)}>
                    {t(lang, 'admin_customers_edit_button')}
                  </Button>
                </td>
              </tr>
              {editingSiteId === s.site_id && (
                <tr>
                  <td colSpan={10} className={styles.editRow}>
                    <AdminSiteEditForm site={s} lang={lang} onDone={() => setEditingSiteId(null)} />

                    <div className={styles.reassignRow}>
                      <span className={styles.reassignLabel}>{t(lang, 'admin_sites_reassign_label')}</span>
                      <Select
                        value={reassignTarget[s.site_id] ?? s.customer_id}
                        onChange={(e) => setReassignTarget((prev) => ({ ...prev, [s.site_id]: e.target.value }))}
                        disabled={reassignBusy[s.site_id]}
                      >
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={reassignBusy[s.site_id] || (reassignTarget[s.site_id] ?? s.customer_id) === s.customer_id}
                        onClick={() => handleReassign(s.site_id)}
                      >
                        {t(lang, 'admin_sites_reassign_button')}
                      </Button>
                      {reassignError[s.site_id] && <span className={styles.error}>{reassignError[s.site_id]}</span>}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
