import { SectionHead } from '@/components/ui';
import { t, type Lang } from '@/lib/i18n/strings';
import styles from './FlowSteps.module.css';

// Reframed 2026-09-05 (Oscar's own feedback: with the Live Dashboard now
// also on this page, the old 3-step Upload/Process/Deliver flow read as
// report-only, with the dashboard bolted on elsewhere). Same 3 steps, but
// step 3 now forks into the two outputs the pipeline actually has, instead
// of ending at "a PDF lands in your inbox" — one pipeline, watched live or
// read weekly, not two separate stories.
export function FlowSteps({ lang }: { lang: Lang }) {
  const steps = [
    { num: '01', title: t(lang, 'marketing_flow_step1_title'), body: t(lang, 'marketing_flow_step1_body') },
    { num: '02', title: t(lang, 'marketing_flow_step2_title'), body: t(lang, 'marketing_flow_step2_body') },
    { num: '03', title: t(lang, 'marketing_flow_step3_title'), body: t(lang, 'marketing_flow_step3_body') },
  ];

  return (
    <section id="how" className="band">
      <div className="wrap">
        <SectionHead eyebrow={t(lang, 'marketing_flow_eyebrow')} lede={t(lang, 'marketing_flow_lede')}>
          {t(lang, 'marketing_flow_title')}
        </SectionHead>

        <div className={styles.flow}>
          {steps.map((step, i) => (
            <div key={step.num} className={styles.step}>
              {i > 0 && <div className={styles.trace} aria-hidden="true" />}
              <span className={styles.num}>{step.num}</span>
              <h3>{step.title}</h3>
              <p className={styles.body}>{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
