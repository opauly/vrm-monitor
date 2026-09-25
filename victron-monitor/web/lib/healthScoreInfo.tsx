import { t, type Lang } from '@/lib/i18n/strings';

// Shared copy for the System/Grid score InfoTooltips — one definition,
// four call sites (customer dashboard + admin fleet, each with a fleet
// rollup card and a per-site detail block), so the explanation can't
// drift out of sync with `vrm.compute_daily_health()`/
// `monitoring.compute_daily_health()`'s actual logic (see
// victron-monitor/sql/vrm_compute_daily_health.sql) the way four
// hand-copied strings eventually would. Functions of `lang` (not static
// JSX, 2026-09-24) — this content used to be English-only even on the
// already-bilingual customer dashboard, missed when that page's own
// strings were keyed through `t()`.
export function systemScoreInfo(lang: Lang) {
  return (
    <>
      <p>{t(lang, 'score_info_system_p1')}</p>
      <p>{t(lang, 'score_info_system_p2')}</p>
    </>
  );
}

export function gridScoreInfo(lang: Lang) {
  return (
    <>
      <p>{t(lang, 'score_info_grid_p1')}</p>
      <p>{t(lang, 'score_info_grid_p2')}</p>
    </>
  );
}
