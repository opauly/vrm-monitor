'use client';

// Per-customer billing detail/actions for `/admin/customers`
// (PLAN_PHASE16.md §0.6 Q11, §8 Step 6). Rendered in the same "expandable
// row below the table row" slot `EditCustomerForm.tsx` already occupies for
// "Edit" — a second, independent toggle (`billingOpenId` in
// `CustomersManager.tsx`), not nested inside the edit form, since editing a
// customer's name/plan/site_limit and acting on their ONVO subscription are
// two different kinds of action with two different blast radii.
//
// Three actions, all real `vrm_api` calls through the SAME endpoints
// `/app/billing` itself uses (`actions.ts`'s own header comment) — NO card
// field anywhere here, ever (Q11: "no card entry by Oscar, ever"):
//   - Refresh — a plain reconcile, safe to click any time.
//   - Cancel (period end / immediate) — a real, confirm-gated mutation.
//   - Promote to active — only shown for a `pending_subscription` customer,
//     confirm-gated, and may legitimately be a no-op (see its own handler).
import { startTransition, useState } from 'react';
import { Button } from '@/components/ui';
import type { AdminCustomerRow } from '@/lib/server/db/admin';
import { t, type Lang } from '@/lib/i18n/strings';
import { billingCancelAction, billingRefreshAction, promoteToActiveAction } from './actions';
import styles from './customers.module.css';

type Message = { kind: 'success' | 'error' | 'info'; text: string };

export function CustomerBillingPanel({ customer, lang }: { customer: AdminCustomerRow; lang: Lang }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  function run(successText: string, fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) {
    setBusy(true);
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      setBusy(false);
      if (result.error) {
        setMessage({ kind: 'error', text: result.error });
      } else if (result.message) {
        setMessage({ kind: 'info', text: result.message });
      } else {
        setMessage({ kind: 'success', text: successText });
      }
    });
  }

  const messageClassName =
    message?.kind === 'error' ? styles.error : message?.kind === 'info' ? styles.warning : styles.success;

  return (
    <div>
      <h3>{t(lang, 'admin_customers_billing_heading').replace('{name}', customer.name)}</h3>
      <p className={styles.subtle}>
        {t(lang, 'admin_customers_billing_label_plan')} {customer.plan} · {t(lang, 'admin_customers_billing_label_status')}{' '}
        {customer.billing_status ?? 'none'} · {t(lang, 'admin_customers_billing_label_origin')}{' '}
        {customer.origin === 'self_serve' ? t(lang, 'admin_customers_origin_self_serve') : t(lang, 'admin_customers_origin_admin')} ·{' '}
        {t(lang, 'admin_customers_billing_label_provisioning')}{' '}
        {customer.provisioning_state === 'pending_subscription'
          ? t(lang, 'admin_customers_pending_signup')
          : t(lang, 'admin_common_active')}
      </p>

      <div className={styles.actionsCell} style={{ marginTop: 10 }}>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => run(t(lang, 'admin_customers_msg_refreshed'), () => billingRefreshAction(customer.id))}
        >
          {t(lang, 'admin_customers_billing_refresh_button')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (!window.confirm(t(lang, 'admin_customers_confirm_cancel_period').replace('{name}', customer.name))) return;
            run(t(lang, 'admin_customers_msg_cancel_scheduled'), () => billingCancelAction(customer.id, 'at_period_end'));
          }}
        >
          {t(lang, 'admin_customers_billing_cancel_period_button')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (!window.confirm(t(lang, 'admin_customers_confirm_cancel_immediate').replace('{name}', customer.name))) return;
            run(t(lang, 'admin_customers_msg_cancelled_immediately'), () => billingCancelAction(customer.id, 'immediate'));
          }}
        >
          {t(lang, 'admin_customers_billing_cancel_immediate_button')}
        </Button>
        {customer.provisioning_state === 'pending_subscription' && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(t(lang, 'admin_customers_confirm_promote').replace('{name}', customer.name))) return;
              run(t(lang, 'admin_customers_msg_promoted'), () => promoteToActiveAction(customer.id));
            }}
          >
            {t(lang, 'admin_customers_billing_promote_button')}
          </Button>
        )}
      </div>

      {message && <p className={messageClassName}>{message.text}</p>}
    </div>
  );
}
