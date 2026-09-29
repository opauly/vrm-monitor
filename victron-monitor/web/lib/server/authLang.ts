import 'server-only';
import { cookies } from 'next/headers';
import type { Lang } from '@/lib/i18n/strings';

/** The `(auth)` route group's own language cookie (2026-09-29) — distinct
 * from `admin_lang`: a visitor on /login, /signup, /activate, /forgot, or
 * /unsubscribe may never have any session at all, admin or otherwise, so
 * this can't be read off `getSessionContext()`. Every `(auth)` page.tsx
 * reads this independently (a layout can't pass props down into its own
 * `children` — each page is its own top-level Server Component render), so
 * this is the one place that decision lives, same "one small function,
 * called everywhere it's needed" shape `formatDateTime()` etc. already use
 * in this codebase rather than duplicating the cookie-read/fallback logic
 * per call site. */
export async function getAuthLang(): Promise<Lang> {
  const store = await cookies();
  return store.get('auth_lang')?.value === 'es' ? 'es' : 'en';
}
