import { Button } from '@/components/ui';
import { t, type Lang } from '@/lib/i18n/strings';
import { Readout } from '../Readout/Readout';
import styles from './Hero.module.css';

export function Hero({ lang }: { lang: Lang }) {
  return (
    <header className={styles.hero}>
      <div className={`wrap ${styles.grid}`}>
        <div>
          {/* No eyebrow here (reverted 2026-09-20) — briefly promoted from
              StatsBanner's own IntegratorBadge pill up into this headline
              (2026-09-19), but StatsBanner renders directly above Hero, so
              the two stacked back to back into the same credential stated
              twice in a row. The pill is the stronger mark of the two
              (clickable, links to Victron's real announcement, names
              "Costa Rica") — it stays the single instance instead. */}
          <h1 className={styles.h1}>
            {t(lang, 'marketing_hero_h1_a')}
            <em className={styles.em}>{t(lang, 'marketing_hero_h1_a_em')}</em>.
            <br />
            {t(lang, 'marketing_hero_h1_b')}
            <em className={styles.em}>{t(lang, 'marketing_hero_h1_b_em')}</em>.
          </h1>
          <p className={`lede ${styles.lede}`}>{t(lang, 'marketing_hero_lede')}</p>
          <div className={styles.ctas}>
            {/* PLAN_PHASE16.md §8 Step 5.5 — replaces the old `#cta` anchor
                into the now-deleted `AccessForm`; the real self-serve
                signup flow lives at /signup instead (Oscar's explicit
                decision to retire the request-access form).
                Both CTAs point at /signup now (2026-09-08, Oscar's
                decision) — the sample report is still reachable without
                committing via Nav's own "Sample report" link (in the "How
                it works" dropdown, /whats-inside#preview), so this isn't
                removing that path, just no longer giving it its own
                hero-level button. Second button's label changed to
                match its real destination (Pricing's own "every plan
                starts with a 7-day free trial" line) rather than promising
                a sample and delivering a signup form. */}
            <Button href="/signup" arrow>
              {t(lang, 'marketing_cta_get_started')}
            </Button>
            <Button href="/signup" variant="ghost">
              {t(lang, 'marketing_cta_start_trial')}
            </Button>
          </div>
          <span className={styles.note}>{t(lang, 'marketing_hero_note')}</span>
        </div>

        <Readout lang={lang} />
      </div>
    </header>
  );
}
