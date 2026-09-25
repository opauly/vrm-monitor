import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/server/auth';
import { t } from '@/lib/i18n/strings';
import { AdminHelpManager } from './AdminHelpManager';
import styles from './help.module.css';

export const metadata: Metadata = {
  title: 'Help — Admin',
};

// `/admin/help` — topic switcher (`AdminHelpManager`, the only client-side
// piece — mirrors the customer side's own `HelpManager`) covering every
// admin nav item, not just VRM Fleet. Rebuilt 2026-09-19 from three static
// Panels into this shape; made bilingual 2026-09-24 along with the rest of
// the admin panel.
export default async function AdminHelpPage() {
  const session = await requireAdmin();
  const lang = session.uiLanguage;

  return (
    <div>
      <h1>{t(lang, 'admin_help_title')}</h1>
      <p className={styles.intro}>{t(lang, 'admin_help_intro')}</p>
      <AdminHelpManager lang={lang} />
    </div>
  );
}
