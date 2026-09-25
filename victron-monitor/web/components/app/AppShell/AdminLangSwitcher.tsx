'use client';

// Admin has no `vrm.customers` row to persist a language choice on (that's
// what `/app/profile`'s selector writes to for customers) — this writes a
// plain, non-sensitive `admin_lang` cookie directly from the client instead,
// then `router.refresh()`s so the Server Components above (this shell's own
// nav labels, by way of `lib/server/auth.ts:getSessionContext()` reading
// that same cookie) re-render with the new choice on the next request.
import { useRouter } from 'next/navigation';
import type { Lang } from '@/lib/i18n/strings';
import styles from './AppShell.module.css';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function AdminLangSwitcher({ lang }: { lang: Lang }) {
  const router = useRouter();

  function setLang(next: Lang) {
    if (next === lang) return;
    document.cookie = `admin_lang=${next}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
    router.refresh();
  }

  return (
    <div className={styles.langSwitcher} role="group" aria-label="Admin panel language">
      <button
        type="button"
        className={lang === 'en' ? styles.langActive : styles.langOption}
        aria-pressed={lang === 'en'}
        onClick={() => setLang('en')}
      >
        EN
      </button>
      <button
        type="button"
        className={lang === 'es' ? styles.langActive : styles.langOption}
        aria-pressed={lang === 'es'}
        onClick={() => setLang('es')}
      >
        ES
      </button>
    </div>
  );
}
