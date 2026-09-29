import { Panel, SectionHead } from '@/components/ui';
import { t, type Lang } from '@/lib/i18n/strings';
import styles from './IntegratorSection.module.css';

// Pauly & Co was accepted into Victron Energy's "Recommended Software
// Integrator" program on 2026-09-01 (Costa Rica) — a real, Victron-reviewed
// credential, not a self-declared badge. Links out to Victron's own public
// announcement rather than rendering any Victron logo/badge graphic here:
// no such asset has been provided yet, and that's a trademark, not
// something to improvise (see IntegratorBadge for the compact version of
// the same claim, in the Hero).
const ANNOUNCEMENT_URL =
  'https://www.victronenergy.com/blog/2024/12/04/introducing-our-new-software-integrator-program/';

export function IntegratorSection({ lang }: { lang: Lang }) {
  const points = [
    { title: t(lang, 'marketing_integrator_point1_title'), body: t(lang, 'marketing_integrator_point1_body') },
    { title: t(lang, 'marketing_integrator_point2_title'), body: t(lang, 'marketing_integrator_point2_body') },
    { title: t(lang, 'marketing_integrator_point3_title'), body: t(lang, 'marketing_integrator_point3_body') },
  ];

  return (
    <section id="integrator" className="band">
      <div className="wrap">
        <SectionHead eyebrow={t(lang, 'marketing_integrator_eyebrow')} lede={t(lang, 'marketing_integrator_lede')}>
          {t(lang, 'marketing_integrator_title')}
        </SectionHead>

        <div className={styles.grid}>
          {points.map((point) => (
            <Panel key={point.title} variant="card">
              <h3>{point.title}</h3>
              <p className={styles.body}>{point.body}</p>
            </Panel>
          ))}
        </div>

        <a className={styles.link} href={ANNOUNCEMENT_URL} target="_blank" rel="noopener noreferrer">
          {t(lang, 'marketing_integrator_link')}
        </a>
      </div>
    </section>
  );
}
