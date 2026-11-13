import Image from 'next/image';
import { SectionHead } from '@/components/ui';
import { t, type Lang } from '@/lib/i18n/strings';
import styles from './PhoneAlerts.module.css';

// The phone-notification pitch, as its own section (2026-11-12): push is the feature an installer feels first — it is what
// reaches them before the customer calls — and it used to be one line in two bullet lists. The right-hand column is a
// static mock of three real notification wordings (an alert, a storm heads-up, the morning summary), not a screenshot, so
// it stays sharp in both languages and in both themes; the names are the sample fleet the dashboard preview already uses.
// Growth and Fleet only (`vrm.plan_limits.live_dashboard`), and the tag says so.
const POINTS = ['li1', 'li2', 'li3', 'li4'] as const;
const SAMPLES = ['n1', 'n2', 'n3'] as const;

export function PhoneAlerts({ lang }: { lang: Lang }) {
  return (
    <section id="phone">
      <div className="wrap">
        <div className={styles.grid}>
          <div>
            <SectionHead eyebrow={t(lang, 'marketing_phone_eyebrow')} lede={t(lang, 'marketing_phone_lede')}>
              {t(lang, 'marketing_phone_title_a')}
              <br />
              {t(lang, 'marketing_phone_title_b')}
            </SectionHead>
            <span className={styles.tag}>{t(lang, 'marketing_phone_tag')}</span>
            <ul className={styles.points}>
              {POINTS.map((p) => (
                <li key={p}>
                  <h3>{t(lang, `marketing_phone_${p}_title`)}</h3>
                  <p>{t(lang, `marketing_phone_${p}_body`)}</p>
                </li>
              ))}
            </ul>
            <p className={styles.note}>{t(lang, 'marketing_phone_note')}</p>
          </div>

          <div className={styles.phone} role="img" aria-label={t(lang, 'marketing_phone_aria')}>
            <span className={styles.sampleLabel} aria-hidden="true">
              {t(lang, 'marketing_phone_sample_label')}
            </span>
            {SAMPLES.map((n) => (
              <div key={n} className={styles.notif} aria-hidden="true">
                <Image src="/icons/icon-192.png" alt="" width={40} height={40} className={styles.appIcon} />
                <div className={styles.notifText}>
                  <div className={styles.notifHead}>
                    <b>{t(lang, `marketing_phone_${n}_title`)}</b>
                    <span>{t(lang, `marketing_phone_${n}_time`)}</span>
                  </div>
                  <p>{t(lang, `marketing_phone_${n}_body`)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
