'use client';

// Invite-a-beta-tester form (PLAN_BETA_PROGRAM.md § Phase 4) — the
// `CreateCustomerForm.tsx` fields plus tier, access plan + billing
// interval, site limit, expiry date (free_until only), and a discount %
// select (discounted only). One submit both creates the `vrm.customers`
// row + the `vrm.beta_grants` row and sends the first invite
// (`actions.ts:createBetaInviteAction`), same "one flow, not two steps to
// remember" reasoning `CreateCustomerForm.tsx`'s own header comment gives.
import { useActionState, useEffect, useState } from 'react';
import { Button, Field, Input, Select } from '@/components/ui';
import { slugify } from '@/lib/slug';
import { PLANS, type PlanKey } from '@/lib/plans';
import { COUNTRIES, DEFAULT_COUNTRY } from '@/lib/countries';
import { t, type Lang } from '@/lib/i18n/strings';
import { createBetaInviteAction, type CreateBetaInviteState } from './actions';
import styles from './beta.module.css';

const PLAN_KEYS = Object.keys(PLANS) as PlanKey[];
// Only the two base plans Phase 1's seeding script creates discount rows
// for (tools/seed_beta_discount_prices.py's own PLAN_KEYS) — offering any
// other plan here would always fail server-side re-validation.
const DISCOUNT_PLAN_KEYS: PlanKey[] = ['starter', 'growth'];
const DISCOUNT_PERCENTAGES = [10, 20, 30, 40, 50, 60, 70, 80, 90];
const COUNTRY_CODES = Object.keys(COUNTRIES);

type Tier = 'free_lifetime' | 'free_until' | 'discounted';

export function InviteBetaForm({ lang, onDone }: { lang: Lang; onDone: () => void }) {
  const [state, formAction, pending] = useActionState<CreateBetaInviteState, FormData>(createBetaInviteAction, {});
  const [name, setName] = useState('');
  const [tier, setTier] = useState<Tier>('free_lifetime');
  const [accessPlanKey, setAccessPlanKey] = useState<PlanKey>('growth');
  const [siteLimit, setSiteLimit] = useState<string>(String(PLANS.growth.sites ?? ''));
  const [billingInterval, setBillingInterval] = useState<'month' | 'year'>('month');
  const [discountPct, setDiscountPct] = useState<number>(30);

  const slugPreview = name.trim() ? (() => {
    try {
      return slugify(name);
    } catch {
      return '—';
    }
  })() : '—';

  useEffect(() => {
    // Same "stay open on a partial success so the invite-send warning is
    // readable" rule CreateCustomerForm.tsx's own effect follows.
    if (state.success && !state.inviteWarning) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone intentionally excluded, see CreateCustomerForm.tsx's own precedent
  }, [state.success, state.inviteWarning]);

  function handleTierChange(value: string) {
    const next = value as Tier;
    setTier(next);
    if (next === 'discounted' && !DISCOUNT_PLAN_KEYS.includes(accessPlanKey)) {
      setAccessPlanKey('growth');
    }
  }

  function handleAccessPlanChange(value: string) {
    const key = value as PlanKey;
    setAccessPlanKey(key);
    const limit = PLANS[key]?.sites;
    setSiteLimit(limit === null || limit === undefined ? '' : String(limit));
  }

  if (state.success) {
    return (
      <div className={styles.form}>
        <p className={styles.success}>{t(lang, 'admin_beta_invite_created_success')}</p>
        {state.inviteWarning && <p className={styles.warning}>{state.inviteWarning}</p>}
        <div className={styles.formActions}>
          <Button type="button" onClick={onDone}>
            {t(lang, 'admin_common_close')}
          </Button>
        </div>
      </div>
    );
  }

  const planChoices = tier === 'discounted' ? DISCOUNT_PLAN_KEYS : PLAN_KEYS;

  return (
    <form action={formAction} className={styles.form}>
      <div className={styles.fieldRow}>
        <Field label={t(lang, 'admin_customers_field_name')} htmlFor="ib-name" required>
          <Input id="ib-name" name="name" required disabled={pending} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t(lang, 'admin_customers_field_slug_preview')} htmlFor="ib-slug-preview">
          <Input id="ib-slug-preview" value={slugPreview} disabled readOnly />
        </Field>
      </div>

      <div className={styles.fieldRow}>
        <Field label={t(lang, 'admin_customers_field_account_type')} htmlFor="ib-account-type">
          <Select id="ib-account-type" name="accountType" defaultValue="installer" disabled={pending}>
            <option value="owner">{t(lang, 'admin_customers_account_type_owner')}</option>
            <option value="installer">{t(lang, 'admin_customers_account_type_installer')}</option>
          </Select>
        </Field>
        <Field label={t(lang, 'admin_customers_field_dashboard_language')} htmlFor="ib-ui-language">
          <Select id="ib-ui-language" name="uiLanguage" defaultValue="en" disabled={pending}>
            <option value="en">{t(lang, 'lang_en')}</option>
            <option value="es">{t(lang, 'lang_es')}</option>
          </Select>
        </Field>
      </div>

      <Field label={t(lang, 'admin_beta_field_tier')} htmlFor="ib-tier">
        <Select id="ib-tier" name="tier" value={tier} onChange={(e) => handleTierChange(e.target.value)} disabled={pending}>
          <option value="free_lifetime">{t(lang, 'admin_beta_tier_free_lifetime')}</option>
          <option value="free_until">{t(lang, 'admin_beta_tier_free_until')}</option>
          <option value="discounted">{t(lang, 'admin_beta_tier_discounted')}</option>
        </Select>
      </Field>

      <div className={styles.fieldRow}>
        <Field label={t(lang, 'admin_beta_field_access_plan')} htmlFor="ib-access-plan">
          <Select id="ib-access-plan" name="accessPlanKey" value={accessPlanKey} onChange={(e) => handleAccessPlanChange(e.target.value)} disabled={pending}>
            {planChoices.map((key) => (
              <option key={key} value={key}>
                {PLANS[key].label}
              </option>
            ))}
          </Select>
        </Field>
        {tier === 'discounted' ? (
          <Field label={t(lang, 'admin_beta_field_billing_interval')} htmlFor="ib-billing-interval">
            <Select
              id="ib-billing-interval"
              name="billingInterval"
              value={billingInterval}
              onChange={(e) => setBillingInterval(e.target.value as 'month' | 'year')}
              disabled={pending}
            >
              <option value="month">{t(lang, 'admin_beta_interval_month')}</option>
              <option value="year">{t(lang, 'admin_beta_interval_year')}</option>
            </Select>
          </Field>
        ) : (
          <Field
            label={t(lang, 'admin_customers_field_site_limit')}
            htmlFor="ib-site-limit"
            optional
            optionalLabel={t(lang, 'admin_customers_site_limit_optional')}
          >
            <Input
              id="ib-site-limit"
              name="siteLimit"
              type="number"
              min="0"
              step="1"
              value={siteLimit}
              onChange={(e) => setSiteLimit(e.target.value)}
              disabled={pending}
            />
          </Field>
        )}
      </div>

      {tier === 'free_until' && (
        <Field label={t(lang, 'admin_beta_field_expires_at')} htmlFor="ib-expires-at" required>
          <Input id="ib-expires-at" name="expiresAt" type="date" required disabled={pending} />
        </Field>
      )}

      {tier === 'discounted' && (
        <>
          <input type="hidden" name="siteLimit" value="" />
          <Field label={t(lang, 'admin_beta_field_discount_pct')} htmlFor="ib-discount-pct">
            <Select
              id="ib-discount-pct"
              name="discountPct"
              value={discountPct}
              onChange={(e) => setDiscountPct(Number(e.target.value))}
              disabled={pending}
            >
              {DISCOUNT_PERCENTAGES.map((pct) => (
                <option key={pct} value={pct}>
                  {pct}%
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}

      <div className={styles.fieldRow}>
        <Field label={t(lang, 'admin_customers_field_login_email')} htmlFor="ib-auth-email" required>
          <Input id="ib-auth-email" name="authEmail" type="email" required disabled={pending} />
        </Field>
        <Field label={t(lang, 'admin_customers_field_country')} htmlFor="ib-country">
          <Select id="ib-country" name="country" defaultValue={DEFAULT_COUNTRY} disabled={pending}>
            {COUNTRY_CODES.map((code) => (
              <option key={code} value={code}>
                {COUNTRIES[code]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className={styles.fieldRow}>
        <Field label={t(lang, 'admin_customers_field_contact_name')} htmlFor="ib-contact-name" optional>
          <Input id="ib-contact-name" name="contactName" disabled={pending} />
        </Field>
        <Field label={t(lang, 'admin_customers_field_contact_email')} htmlFor="ib-contact-email" optional>
          <Input id="ib-contact-email" name="contactEmail" type="email" disabled={pending} />
        </Field>
      </div>

      {state.error && <p className={styles.error}>{state.error}</p>}

      <div className={styles.formActions}>
        <Button type="submit" disabled={pending}>
          {pending ? t(lang, 'admin_common_creating') : t(lang, 'admin_beta_invite_button')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          {t(lang, 'admin_common_cancel')}
        </Button>
      </div>
    </form>
  );
}
