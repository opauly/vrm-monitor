'use client';

// The (auth) route group's own language toggle (2026-09-29) — Nav's other
// mode, `{ kind: 'href' }`, is a plain Link to a sibling page's own URL
// (marketing's /es pairs). Auth pages have no such pair: /login is one
// route, not two, since these routes are already dynamically rendered per
// request (unlike the marketing homepage's ISR-cached one, there's no
// caching conflict to avoid here — see Nav.tsx's own comment on why
// marketing had to go the URL-pair route instead). Same cookie-write +
// router.refresh() shape AdminLangSwitcher.tsx already uses for /admin,
// just a different cookie name (`auth_lang`, not `admin_lang` — a visitor
// here may never have an admin session, or any session at all).
import { useRouter } from 'next/navigation';
import type { Lang } from '@/lib/i18n/strings';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function CookieLangToggle({
  lang,
  cookieName,
  label,
  displayText,
  className,
}: {
  lang: Lang;
  cookieName: string;
  /** aria-label — always the full "Site language" phrase, not the button's own short/long visible text. */
  label: string;
  /** The button's own visible text — "EN"/"ES" for Nav's pill, "English"/"Español" for MobileMenu's full-word row. */
  displayText: string;
  className?: string;
}) {
  const router = useRouter();
  const next: Lang = lang === 'es' ? 'en' : 'es';

  function handleClick() {
    document.cookie = `${cookieName}=${next}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
    router.refresh();
  }

  return (
    <button type="button" className={className} onClick={handleClick} aria-label={label}>
      {displayText}
    </button>
  );
}
