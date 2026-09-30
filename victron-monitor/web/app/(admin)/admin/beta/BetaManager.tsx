'use client';

// Table + invite form + row actions for `/admin/beta` (PLAN_BETA_PROGRAM.md
// § Phase 4) — same shape `../customers/CustomersManager.tsx` establishes:
// row-level actions invoked directly from `onClick` inside `startTransition`,
// an expandable row below the table row for a form (here: "Extend"), and a
// toggleable create-form panel below the table.
import { Fragment, startTransition, useActionState, useEffect, useMemo, useState } from 'react';
import { Button, Field, Input, Select, Table } from '@/components/ui';
import { formatDate as formatDateShared } from '@/lib/dates';
import { planLabel } from '@/lib/plans';
import type { AdminBetaGrantRow } from '@/lib/server/db/admin';
import { t, type Lang } from '@/lib/i18n/strings';
import { InviteBetaForm } from './InviteBetaForm';
import { revokeBetaGrantAction, extendBetaGrantAction, resendBetaInviteAction, type BetaRowActionState } from './actions';
import styles from './beta.module.css';

const TABLE_COLUMN_COUNT = 7;

type TierFilter = 'all' | 'free_lifetime' | 'free_until' | 'discounted';
type StatusFilter = 'all' | 'active' | 'expired' | 'revoked' | 'converted';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return formatDateShared(iso);
}

function tierBadgeClass(status: string): string {
  if (status === 'active') return styles.statusActive;
  if (status === 'converted') return styles.statusActive;
  if (status === 'expired' || status === 'revoked') return styles.statusRevoked;
  return styles.statusNone;
}

function tierDetail(g: AdminBetaGrantRow, lang: Lang): string {
  if (g.tier === 'free_lifetime') return t(lang, 'admin_beta_tier_free_lifetime');
  if (g.tier === 'free_until') return t(lang, 'admin_beta_tier_free_until_detail').replace('{date}', formatDate(g.expires_at));
  const pct = g.price_variant?.replace('beta_pct_', '') ?? '?';
  const interval = g.billing_interval === 'year' ? t(lang, 'admin_beta_interval_year') : t(lang, 'admin_beta_interval_month');
  return t(lang, 'admin_beta_tier_discounted_detail')
    .replace('{pct}', pct)
    .replace('{plan}', planLabel(g.access_plan_key))
    .replace('{interval}', interval.toLowerCase());
}

function inviteStatusLabel(g: AdminBetaGrantRow, lang: Lang): { text: string; className: string } {
  if (!g.authEmail) return { text: t(lang, 'admin_customers_status_not_invited'), className: styles.statusNone };
  if (!g.activatedAt) {
    return {
      text: t(lang, 'admin_customers_status_invited').replace('{date}', formatDate(g.invitedAt)),
      className: styles.statusInvited,
    };
  }
  return {
    text: t(lang, 'admin_customers_status_active_since').replace('{date}', formatDate(g.activatedAt)),
    className: styles.statusActive,
  };
}

function ExtendGrantForm({ grant, lang, onDone }: { grant: AdminBetaGrantRow; lang: Lang; onDone: () => void }) {
  const boundAction = extendBetaGrantAction.bind(null, grant.id, grant.customer_id);
  const [state, formAction, pending] = useActionState<BetaRowActionState, FormData>(boundAction, {});

  useEffect(() => {
    if (state.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone intentionally excluded, see CustomersManager.tsx's own precedent
  }, [state.ok]);

  return (
    <form action={formAction} className={styles.form}>
      <Field label={t(lang, 'admin_beta_field_expires_at')} htmlFor={`ext-expires-${grant.id}`} required>
        <Input id={`ext-expires-${grant.id}`} name="expiresAt" type="date" required disabled={pending} />
      </Field>
      {state.error && <p className={styles.error}>{state.error}</p>}
      <div className={styles.formActions}>
        <Button type="submit" disabled={pending}>
          {pending ? t(lang, 'admin_common_saving') : t(lang, 'admin_common_save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          {t(lang, 'admin_common_cancel')}
        </Button>
      </div>
    </form>
  );
}

export function BetaManager({ grants, lang }: { grants: AdminBetaGrantRow[]; lang: Lang }) {
  const [creating, setCreating] = useState(false);
  const [extendingId, setExtendingId] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();

  const filteredGrants = useMemo(
    () =>
      grants.filter((g) => {
        if (tierFilter !== 'all' && g.tier !== tierFilter) return false;
        if (statusFilter !== 'all' && g.status !== statusFilter) return false;
        if (normalizedQuery) {
          const haystack = [g.customerName, g.customerSlug, g.authEmail].filter(Boolean).join(' ').toLowerCase();
          if (!haystack.includes(normalizedQuery)) return false;
        }
        return true;
      }),
    [grants, tierFilter, statusFilter, normalizedQuery],
  );

  function runRowAction(id: string, fn: () => Promise<BetaRowActionState | void>) {
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

  function renderRow(g: AdminBetaGrantRow) {
    const invite = inviteStatusLabel(g, lang);
    const canExtend = g.tier === 'free_until' && (g.status === 'active' || g.status === 'expired');
    return (
      <Fragment key={g.id}>
        <tr>
          <td>
            {g.customerName}
            <div className={styles.subtle}>{g.customerSlug}</div>
          </td>
          <td>{tierDetail(g, lang)}</td>
          <td>
            <span className={tierBadgeClass(g.status)}>{t(lang, `admin_beta_status_${g.status}` as const)}</span>
          </td>
          <td>
            <span className={invite.className}>{invite.text}</span>
            {rowError[g.id] && <div className={styles.rowError}>{rowError[g.id]}</div>}
          </td>
          <td>{planLabel(g.plan)}</td>
          <td>
            <span className={styles.subtle}>{g.billingStatus ?? 'none'}</span>
          </td>
          <td className={styles.actionsCell}>
            <Button
              type="button"
              variant="ghost"
              disabled={rowBusy[g.id]}
              onClick={() => runRowAction(g.id, () => resendBetaInviteAction(g.customer_id))}
            >
              {t(lang, 'admin_customers_resend_invite')}
            </Button>
            {canExtend && (
              <Button type="button" variant="ghost" onClick={() => setExtendingId(extendingId === g.id ? null : g.id)}>
                {t(lang, 'admin_beta_extend_button')}
              </Button>
            )}
            {g.status === 'active' && (
              <Button
                type="button"
                variant="ghost"
                disabled={rowBusy[g.id]}
                onClick={() => {
                  if (!window.confirm(t(lang, 'admin_beta_confirm_revoke').replace('{name}', g.customerName))) return;
                  runRowAction(g.id, () => revokeBetaGrantAction(g.id, g.customer_id, g.activatedAt));
                }}
              >
                {t(lang, 'admin_beta_revoke_button')}
              </Button>
            )}
          </td>
        </tr>
        {extendingId === g.id && (
          <tr>
            <td colSpan={TABLE_COLUMN_COUNT} className={styles.editRow}>
              <ExtendGrantForm grant={g} lang={lang} onDone={() => setExtendingId(null)} />
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  return (
    <div>
      <div className={styles.filtersRow}>
        <label className={styles.filterLabel}>
          {t(lang, 'admin_beta_filter_tier')}
          <Select value={tierFilter} onChange={(e) => setTierFilter(e.target.value as TierFilter)}>
            <option value="all">{t(lang, 'admin_common_all')}</option>
            <option value="free_lifetime">{t(lang, 'admin_beta_tier_free_lifetime')}</option>
            <option value="free_until">{t(lang, 'admin_beta_tier_free_until')}</option>
            <option value="discounted">{t(lang, 'admin_beta_tier_discounted')}</option>
          </Select>
        </label>
        <label className={styles.filterLabel}>
          {t(lang, 'admin_beta_filter_status')}
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">{t(lang, 'admin_common_all')}</option>
            <option value="active">{t(lang, 'admin_beta_status_active')}</option>
            <option value="expired">{t(lang, 'admin_beta_status_expired')}</option>
            <option value="revoked">{t(lang, 'admin_beta_status_revoked')}</option>
            <option value="converted">{t(lang, 'admin_beta_status_converted')}</option>
          </Select>
        </label>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(lang, 'admin_search_placeholder')}
          className={styles.searchBox}
        />
        <span className={styles.filterCount}>
          {t(lang, 'admin_customers_filter_count').replace('{n}', String(filteredGrants.length)).replace('{m}', String(grants.length))}
        </span>
      </div>

      {filteredGrants.length === 0 ? (
        <p className={styles.empty}>{t(lang, 'admin_search_no_results')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t(lang, 'admin_beta_col_customer')}</th>
              <th>{t(lang, 'admin_beta_col_tier')}</th>
              <th>{t(lang, 'admin_beta_col_status')}</th>
              <th>{t(lang, 'admin_customers_col_access')}</th>
              <th>{t(lang, 'admin_beta_col_current_plan')}</th>
              <th>{t(lang, 'admin_customers_col_billing')}</th>
              <th />
            </tr>
          </thead>
          <tbody>{filteredGrants.map(renderRow)}</tbody>
        </Table>
      )}

      <div className={styles.actionsRow}>
        {!creating && (
          <Button type="button" onClick={() => setCreating(true)}>
            {t(lang, 'admin_beta_invite_button')}
          </Button>
        )}
      </div>

      {creating && (
        <div className={styles.panel}>
          <h3>{t(lang, 'admin_beta_invite_button')}</h3>
          <InviteBetaForm lang={lang} onDone={() => setCreating(false)} />
        </div>
      )}
    </div>
  );
}
