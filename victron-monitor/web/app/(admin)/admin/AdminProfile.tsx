import { t, type Lang } from '@/lib/i18n/strings';
import { AdminLangSwitcher } from '@/components/app/AppShell/AdminLangSwitcher';
import { ChangePasswordForm } from '@/app/(portal)/app/profile/ChangePasswordForm';
import styles from '@/app/(portal)/app/profile/profile.module.css';
import { changeAdminPasswordAction } from './profileActions';

// The admin's Profile window (avatar menu): the login, the panel language (it used to sit in the header) and the password.
export function AdminProfile({ email, lang }: { email: string; lang: Lang }) {
  return (
    <div>
      <div className={styles.readonly}>
        <div className={styles.readonlyItem}>
          <span className={styles.readonlyLabel}>{t(lang, 'profile_login_email')}</span>
          <span className={styles.readonlyValue}>{email}</span>
        </div>
        <div className={styles.readonlyItem}>
          <span className={styles.readonlyLabel}>{t(lang, 'profile_admin_language')}</span>
          <div><AdminLangSwitcher lang={lang} /></div>
        </div>
      </div>
      <h3 className={styles.modalHeading}>{t(lang, 'profile_change_password_title')}</h3>
      <ChangePasswordForm lang={lang} action={changeAdminPasswordAction} />
    </div>
  );
}
