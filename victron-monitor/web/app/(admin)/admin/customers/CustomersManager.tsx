'use client';

// Table + create/edit forms + invite actions for `/admin/customers`
// (PLAN_PHASE14.md §2 Step 7). Row-level actions (send/resend invite,
// activate/deactivate) are plain Server Actions invoked directly from
// `onClick` inside `startTransition` — the same "invoked directly ...
// wrapped in startTransition" shape
// `app/(portal)/app/sites/SiteForm.tsx:handleGeocodeClick` already
// establishes for a non-`<form>` server action call, not a new pattern.
import { Fragment, startTransition, useMemo, useState } from 'react';
import { Button, Select, Table } from '@/components/ui';
import { formatDate as formatDateShared } from '@/lib/dates';
import type { AdminCustomerRow } from '@/lib/server/db/admin';
import { planLabel } from '@/lib/plans';
import { countryLabel } from '@/lib/countries';
import { t, type Lang } from '@/lib/i18n/strings';
import { CreateCustomerForm } from './CreateCustomerForm';
import { EditCustomerForm } from './EditCustomerForm';
import { CustomerBillingPanel } from './CustomerBillingPanel';
import { resendInviteAction, sendInviteAction, setActiveAction, disconnectVrmLinkAction } from './actions';
import styles from './customers.module.css';

// One extra column for every extra <td> the row below renders — kept as a
// constant so the two expandable rows' `colSpan` (Edit, Billing) can never
// silently drift out of sync with `<thead>`'s own column count again.
const TABLE_COLUMN_COUNT = 11;

type OriginFilter = 'all' | 'admin' | 'self_serve';
type ProvisioningFilter = 'all' | 'active' | 'pending_subscription';

// PLAN_PHASE16.md §4.5's own vocabulary comment on `vrm.customers
// .billing_status` — 'none' | 'trialing' | 'active' | 'past_due' |
// 'incomplete' | 'unpaid' | 'canceled', no CHECK constraint (an
// unrecognized value must render, not crash this table).
function billingStatusBadgeClass(status: string | null): string {
  if (status === 'active' || status === 'trialing') return styles.statusActive;
  if (status === 'past_due' || status === 'unpaid' || status === 'incomplete') return styles.statusRevoked;
  return styles.statusNone;
}

function authStatusLabel(c: AdminCustomerRow, lang: Lang): { text: string; className: string } {
  if (!c.auth_user_id) return { text: t(lang, 'admin_customers_status_not_invited'), className: styles.statusNone };
  if (!c.activated_at) {
    return {
      text: t(lang, 'admin_customers_status_invited').replace('{date}', formatDate(c.invited_at)),
      className: styles.statusInvited,
    };
  }
  return {
    text: t(lang, 'admin_customers_status_active_since').replace('{date}', formatDate(c.activated_at)),
    className: styles.statusActive,
  };
}

// The VRM link column (PLAN_PHASE15.md §8 Step 6) — three states, same
// `vrm_token_revoked_at`-set-by-either-path reasoning
// `lib/server/db/types.ts:CustomerRecord.vrm_token_revoked_at`'s own
// comment gives: a deliberate disconnect and a broken token both land in
// "Token revocado <date>" here, because from this table's point of view
// both mean the same thing — no live connection right now — and
// `vrm_token_last_error` (surfaced instead on the customer's own
// `/app`/`/app/sites` banner, not repeated here) is what distinguishes WHY
// for anyone who needs to know.
function vrmLinkStatusLabel(c: AdminCustomerRow, lang: Lang): { text: string; className: string; connected: boolean } {
  if (c.vrm_token_revoked_at) {
    return {
      text: t(lang, 'admin_customers_vrm_token_revoked').replace('{date}', formatDate(c.vrm_token_revoked_at)),
      className: styles.statusRevoked,
      connected: false,
    };
  }
  if (c.vrm_token_added_at) {
    return {
      text: t(lang, 'admin_customers_vrm_connected')
        .replace('{email}', c.vrm_account_email ?? '—')
        .replace('{date}', formatDate(c.vrm_token_added_at)),
      className: styles.statusActive,
      connected: true,
    };
  }
  return { text: t(lang, 'admin_customers_vrm_not_connected'), className: styles.statusNone, connected: false };
}

function formatDate(iso: string | null): string {
  // Delegates to lib/dates.ts's deterministic formatter (2026-08-19 — a
  // real Next.js hydration error surfaced this exact pattern elsewhere in
  // the admin UI). Kept as a local wrapper only for the null-safe
  // signature every call site in this file already relies on.
  if (!iso) return '—';
  return formatDateShared(iso);
}

export function CustomersManager({ customers, lang }: { customers: AdminCustomerRow[]; lang: Lang }) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [billingOpenId, setBillingOpenId] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});

  // Origin/provisioning filters (PLAN_PHASE16.md §8 Step 6: "so Oscar can
  // see who came in off the street and who never finished") — plain
  // client-side filtering over the already-fetched `customers` prop, same
  // scale assumption every other admin list in this file already makes
  // (this product has tens of customers, not thousands).
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  const [provisioningFilter, setProvisioningFilter] = useState<ProvisioningFilter>('all');

  const filteredCustomers = useMemo(
    () =>
      customers.filter((c) => {
        if (originFilter !== 'all' && c.origin !== originFilter) return false;
        if (provisioningFilter !== 'all' && c.provisioning_state !== provisioningFilter) return false;
        return true;
      }),
    [customers, originFilter, provisioningFilter],
  );

  // Active customers are what you're managing day to day; a deactivated one
  // is closed-out business — split into its own table below so it doesn't
  // compete for attention in the main list (Oscar's own request,
  // 2026-08-30), same "top table is where you look first" idea the fleet
  // page's own layout follows.
  const activeCustomers = useMemo(() => filteredCustomers.filter((c) => c.active), [filteredCustomers]);
  const deactivatedCustomers = useMemo(() => filteredCustomers.filter((c) => !c.active), [filteredCustomers]);

  function runRowAction(id: string, fn: () => Promise<{ ok?: boolean; error?: string } | void>) {
    setRowBusy((b) => ({ ...b, [id]: true }));
    setRowError((e) => ({ ...e, [id]: '' }));
    startTransition(async () => {
      const result = await fn();
      setRowBusy((b) => ({ ...b, [id]: false }));
      if (result && 'error' in result && result.error) {
        setRowError((e) => ({ ...e, [id]: result.error! }));
      }
    });
  }

  function renderCustomerRow(c: AdminCustomerRow) {
    const vrmLink = vrmLinkStatusLabel(c, lang);
    const auth = authStatusLabel(c, lang);
    return (
      <Fragment key={c.id}>
        <tr>
          <td>
            {c.name}
            <div className={styles.subtle}>
              {c.slug} · {countryLabel(c.country)}
            </div>
          </td>
          <td>{c.account_type === 'installer' ? t(lang, 'admin_customers_type_installer') : t(lang, 'admin_customers_type_owner')}</td>
          <td>{planLabel(c.plan)}</td>
          <td>
            {c.siteCount}
            {c.site_limit !== null ? ` / ${c.site_limit}` : ''}
          </td>
          <td>{c.lastUploadAt ? formatDate(c.lastUploadAt) : '—'}</td>
          <td>
            <span className={auth.className}>{auth.text}</span>
            {rowError[c.id] && <div className={styles.rowError}>{rowError[c.id]}</div>}
          </td>
          <td>
            <span className={vrmLink.className}>{vrmLink.text}</span>
          </td>
          <td>
            <span className={c.active ? styles.statusActive : styles.statusNone}>
              {c.active ? t(lang, 'admin_common_yes') : t(lang, 'admin_common_no')}
            </span>
          </td>
          <td>
            <span className={billingStatusBadgeClass(c.billing_status)}>{c.billing_status ?? 'none'}</span>
            <div className={styles.subtle}>
              {c.nextRenewalAt
                ? t(lang, 'admin_customers_renews').replace('{date}', formatDate(c.nextRenewalAt))
                : t(lang, 'admin_customers_no_renewal')}
              {c.cancelPending ? ` · ${t(lang, 'admin_customers_cancel_pending')}` : ''}
            </div>
          </td>
          <td>
            <span className={styles.subtle}>
              {c.origin === 'self_serve' ? t(lang, 'admin_customers_origin_self_serve') : t(lang, 'admin_customers_origin_admin')}
            </span>
            {c.provisioning_state === 'pending_subscription' && (
              <div className={styles.statusInvited}>{t(lang, 'admin_customers_pending_signup')}</div>
            )}
          </td>
          <td className={styles.actionsCell}>
            <Button type="button" variant="ghost" onClick={() => setEditingId(editingId === c.id ? null : c.id)}>
              {t(lang, 'admin_customers_edit_button')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setBillingOpenId(billingOpenId === c.id ? null : c.id)}
            >
              {t(lang, 'admin_customers_billing_button')}
            </Button>
            {c.auth_user_id ? (
              <Button
                type="button"
                variant="ghost"
                disabled={rowBusy[c.id]}
                onClick={() => runRowAction(c.id, () => resendInviteAction(c.id))}
              >
                {t(lang, 'admin_customers_resend_invite')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                disabled={rowBusy[c.id]}
                onClick={() => runRowAction(c.id, () => sendInviteAction(c.id))}
              >
                {t(lang, 'admin_customers_send_invite')}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={rowBusy[c.id]}
              onClick={() => runRowAction(c.id, () => setActiveAction(c.id, !c.active))}
            >
              {c.active ? t(lang, 'admin_customers_deactivate') : t(lang, 'admin_customers_activate')}
            </Button>
            {vrmLink.connected && (
              <Button
                type="button"
                variant="ghost"
                disabled={rowBusy[c.id]}
                onClick={() => {
                  if (!window.confirm(t(lang, 'admin_customers_confirm_disconnect_vrm').replace('{name}', c.name))) return;
                  runRowAction(c.id, () => disconnectVrmLinkAction(c.id));
                }}
              >
                {t(lang, 'admin_customers_disconnect_vrm')}
              </Button>
            )}
          </td>
        </tr>
        {editingId === c.id && (
          <tr>
            <td colSpan={TABLE_COLUMN_COUNT} className={styles.editRow}>
              <EditCustomerForm customer={c} lang={lang} onDone={() => setEditingId(null)} />
            </td>
          </tr>
        )}
        {billingOpenId === c.id && (
          <tr>
            <td colSpan={TABLE_COLUMN_COUNT} className={styles.editRow}>
              <CustomerBillingPanel customer={c} lang={lang} />
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  const tableHead = (
    <thead>
      <tr>
        <th>{t(lang, 'admin_customers_col_name')}</th>
        <th>{t(lang, 'admin_customers_col_type')}</th>
        <th>{t(lang, 'admin_customers_col_plan')}</th>
        <th>{t(lang, 'admin_customers_col_sites')}</th>
        <th>{t(lang, 'admin_customers_col_last_upload')}</th>
        <th>{t(lang, 'admin_customers_col_access')}</th>
        <th>{t(lang, 'admin_customers_col_vrm')}</th>
        <th>{t(lang, 'admin_customers_col_active')}</th>
        <th>{t(lang, 'admin_customers_col_billing')}</th>
        <th>{t(lang, 'admin_customers_col_origin')}</th>
        <th />
      </tr>
    </thead>
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
        <label className={styles.filterLabel}>
          {t(lang, 'admin_customers_filter_provisioning')}
          <Select value={provisioningFilter} onChange={(e) => setProvisioningFilter(e.target.value as ProvisioningFilter)}>
            <option value="all">{t(lang, 'admin_common_all')}</option>
            <option value="active">{t(lang, 'admin_customers_provisioning_active')}</option>
            <option value="pending_subscription">{t(lang, 'admin_customers_pending_signup')}</option>
          </Select>
        </label>
        <span className={styles.filterCount}>
          {t(lang, 'admin_customers_filter_count').replace('{n}', String(filteredCustomers.length)).replace('{m}', String(customers.length))}
        </span>
      </div>

      <Table>
        {tableHead}
        <tbody>{activeCustomers.map(renderCustomerRow)}</tbody>
      </Table>

      {deactivatedCustomers.length > 0 && (
        <>
          <h2 className={styles.deactivatedHeading}>
            {t(lang, 'admin_customers_deactivated_heading').replace('{n}', String(deactivatedCustomers.length))}
          </h2>
          <Table>
            {tableHead}
            <tbody>{deactivatedCustomers.map(renderCustomerRow)}</tbody>
          </Table>
        </>
      )}

      <div className={styles.actionsRow}>
        {!creating && (
          <Button type="button" onClick={() => setCreating(true)}>
            {t(lang, 'admin_customers_new_button')}
          </Button>
        )}
      </div>

      {creating && (
        <div className={styles.panel}>
          <h3>{t(lang, 'admin_customers_new_button')}</h3>
          <CreateCustomerForm lang={lang} onDone={() => setCreating(false)} />
        </div>
      )}
    </div>
  );
}
