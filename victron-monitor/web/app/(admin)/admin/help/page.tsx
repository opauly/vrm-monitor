import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/server/auth';
import { AdminHelpManager } from './AdminHelpManager';
import styles from './help.module.css';

export const metadata: Metadata = {
  title: 'Help — Admin',
};

// `/admin/help` — admin-side reference, plain English literals throughout
// (no `lib/i18n/strings.ts` keys), matching every other `/admin/**` page's
// convention. Rebuilt 2026-09-19 into a topic switcher (`AdminHelpManager`,
// the only client-side piece — mirrors the customer side's own
// `HelpManager`) covering every admin nav item, not just VRM Fleet.
export default async function AdminHelpPage() {
  await requireAdmin();

  return (
    <div>
      <h1>Help</h1>
      <p className={styles.intro}>Reference for every admin workflow — customers, sites, uploads, reports, activity, analytics, and VRM Fleet.</p>
      <AdminHelpManager />
    </div>
  );
}
