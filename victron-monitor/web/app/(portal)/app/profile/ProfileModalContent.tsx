import Link from 'next/link';
import { t, type Lang } from '@/lib/i18n/strings';
import { planLabel } from '@/lib/plans';
import type { CustomerRecord } from '@/lib/server/db';
import { ProfileForm } from './ProfileForm';
import { ChangePasswordForm } from './ChangePasswordForm';
import styles from './profile.module.css';

// The Profile window of the avatar menu: the same editable information and password forms as `/app/profile`, plus the read-only
// facts, without that page's VRM-connection and billing cards (a link goes to them). Rendered by the portal layout, which already
// has the customer and the site count.
function memberSince(createdAt: string, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(lang === 'es' ? 'es-CR' : 'en-US', { year: 'numeric', month: 'long' }).format(new Date(createdAt));
  } catch {
    return createdAt;
  }
}

export function ProfileModalContent({ customer, email, siteCount, lang }: { customer: CustomerRecord; email: string; siteCount: number; lang: Lang }) {
  const sitesLabel = customer.site_limit === null ? `${siteCount} (${t(lang, 'profile_sites_unlimited')})` : `${siteCount} / ${customer.site_limit}`;
  return (
    <div>
      <h3 className={styles.modalHeading}>{t(lang, 'profile_basic_info_title')}</h3>
      <ProfileForm customer={customer} lang={lang} />

      <div className={styles.readonly}>
        <div className={styles.readonlyItem}>
          <span className={styles.readonlyLabel}>{t(lang, 'profile_login_email')}</span>
          <span className={styles.readonlyValue}>{email}</span>
        </div>
        <div className={styles.readonlyItem}>
          <span className={styles.readonlyLabel}>{t(lang, 'profile_plan')}</span>
          <span className={styles.readonlyValue}>{planLabel(customer.plan)}</span>
        </div>
        <div className={styles.readonlyItem}>
          <span className={styles.readonlyLabel}>{t(lang, 'profile_sites_used')}</span>
          <span className={styles.readonlyValue}>{sitesLabel}</span>
        </div>
        <div className={styles.readonlyItem}>
          <span className={styles.readonlyLabel}>{t(lang, 'profile_member_since')}</span>
          <span className={styles.readonlyValue}>{memberSince(customer.created_at, lang)}</span>
        </div>
      </div>

      <h3 className={styles.modalHeading}>{t(lang, 'profile_change_password_title')}</h3>
      <ChangePasswordForm lang={lang} />

      <p className={styles.modalMore}>
        <Link href="/app/profile">{t(lang, 'profile_modal_more')} →</Link>
      </p>
    </div>
  );
}
