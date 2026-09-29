import Image from 'next/image';
import { Button, Eyebrow } from '@/components/ui';
import { t, type Lang } from '@/lib/i18n/strings';
import styles from './ReportPreview.module.css';

// public/sample_report.png is 1819x2573 (landing-page/assets/sample_report.png,
// copied not moved — see PLAN_PHASE14.md §6.2).
//
// 2026-09-22 (Oscar's own audit, /whats-inside): title changed from "What
// lands in the inbox." to "The weekly report, in detail." — matching the
// "[SECTION], in detail." pattern that page's own live-dashboard section
// already uses, now that this component's only call site is that page (not
// the home page). Dropped the "Not a mockup —" opening too — flagged as
// misleading (it invites the question "then why say so unless something
// ELSE here isn't real"); the very next clause already says what this
// actually is (the real pipeline, an invented household) without needing a
// denial first.
const SHOT_WIDTH = 1819;
const SHOT_HEIGHT = 2573;

export function ReportPreview({ lang }: { lang: Lang }) {
  return (
    <section id="preview" className="band">
      <div className={`wrap ${styles.grid}`}>
        <div>
          <Eyebrow>{t(lang, 'marketing_report_eyebrow')}</Eyebrow>
          <h2>{t(lang, 'marketing_report_title')}</h2>
          <p style={{ marginTop: 16 }}>{t(lang, 'marketing_report_body')}</p>
          <ul className={styles.miniList}>
            <li>
              {t(lang, 'marketing_report_li_format_label')} <b>{t(lang, 'marketing_report_li_format_value')}</b>
            </li>
            <li>
              {t(lang, 'marketing_report_li_cadence_label')} <b>{t(lang, 'marketing_report_li_cadence_value')}</b>
            </li>
            <li>
              {t(lang, 'marketing_report_li_languages_label')} <b>{t(lang, 'marketing_report_li_languages_value')}</b>
            </li>
            <li>
              {t(lang, 'marketing_report_li_delivery_label')} <b>{t(lang, 'marketing_report_li_delivery_value')}</b>
            </li>
          </ul>
          <span className={styles.badge}>
            <span className={styles.badgeDot} aria-hidden="true" />
            {t(lang, 'marketing_report_badge')}
          </span>
        </div>

        <div className={styles.frame}>
          <div className={styles.chrome}>
            <span className={styles.dot} style={{ background: '#E4664B' }} />
            <span className={styles.dot} style={{ background: '#F2A93B' }} />
            <span className={styles.dot} style={{ background: '#3FBF8F' }} />
            <span className={styles.fname}>weekly-report_casa-modelo_2026-08-09.pdf</span>
          </div>
          <div className={styles.shotWrap}>
            <Image
              src="/sample_report.png"
              alt={t(lang, 'marketing_report_image_alt')}
              width={SHOT_WIDTH}
              height={SHOT_HEIGHT}
              className={styles.shot}
              sizes="(max-width: 920px) 100vw, 55vw"
            />
          </div>
          <div className={styles.shotFoot}>
            <span>{t(lang, 'marketing_report_page_of')}</span>
            {/* Was a mailto ("Request the full sample" — PLAN_PHASE16.md §8
                Step 5.5's original reasoning: not a signup, so not
                /signup). Changed 2026-09-08 (Oscar's decision): now that
                self-serve /signup + a 7-day free trial exists, asking
                someone to email in for a sample is the obsolete path —
                they can see their own real report faster by signing up
                directly. Fleet's own "Talk to us" stays mailto (hand-
                negotiated, no self-serve checkout to send it to) —
                Single Report's own "Get a report" mailto button no
                longer exists to compare against at all; that whole tier
                is hidden as of 2026-09-23, see Pricing.tsx's own comment. */}
            <Button href="/signup" variant="ghost" style={{ padding: '9px 16px' }}>
              {t(lang, 'marketing_cta_start_trial')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
