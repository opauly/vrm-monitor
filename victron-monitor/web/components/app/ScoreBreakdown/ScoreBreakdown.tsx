import type { HealthBreakdownItem, PeriodScore } from '@/lib/healthBreakdown';
import { t, type Lang, type StringKey } from '@/lib/i18n/strings';
import styles from './ScoreBreakdown.module.css';

// "See how this was calculated" for a System/Grid score: the actual
// arithmetic — 100, each reason with what was measured against its limit and
// the points it cost, the result. The points are the ones
// `vrm.compute_daily_health()` stored with the score, so the lines add up to
// the number on screen by construction. A day scored before that was stored
// has no breakdown yet; it falls back to the plain list of reasons.

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function fill(text: string, item: HealthBreakdownItem): string {
  return text
    .replace('{value}', item.value === undefined ? '' : num(item.value))
    .replace('{limit}', item.limit === undefined ? '' : num(item.limit));
}

function describe(lang: Lang, item: HealthBreakdownItem): { title: string; detail: string | null } {
  const titleKey = `score_item_${item.code}` as StringKey;
  const known = t(lang, titleKey) !== titleKey;
  if (!known) return { title: item.code, detail: null };
  const detailKey = (item.estimated ? `score_item_${item.code}_detail_est` : `score_item_${item.code}_detail`) as StringKey;
  const detail = t(lang, detailKey);
  return { title: fill(t(lang, titleKey), item), detail: detail === detailKey ? null : fill(detail, item) };
}

const signed = (points: number) => (points < 0 ? `−${Math.abs(points)}` : points > 0 ? `+${points}` : '0');

function Legend({ lang }: { lang: Lang }) {
  return (
    <ul className={styles.legend}>
      <li className={styles.excellent}>{t(lang, 'score_band_excellent')}</li>
      <li className={styles.good}>{t(lang, 'score_band_good')}</li>
      <li className={styles.watch}>{t(lang, 'score_band_watch')}</li>
      <li className={styles.attention}>{t(lang, 'score_band_attention')}</li>
    </ul>
  );
}

export function ScoreBreakdown({
  lang,
  items,
  notes,
  score,
}: {
  lang: Lang;
  items: HealthBreakdownItem[] | null;
  /** Stored reasons, shown as a plain list when there is no breakdown yet. */
  notes: string | null;
  score: number | null;
}) {
  if (!items) {
    const reasons = (notes ?? '').split(';').map((n) => n.trim()).filter(Boolean);
    return (
      <ul className={styles.plain}>
        {reasons.map((reason, i) => (
          <li key={i}>{reason}</li>
        ))}
      </ul>
    );
  }

  const expected = Math.max(0, Math.min(100, 100 + items.reduce((sum, item) => sum + item.points, 0)));
  const other = score === null ? 0 : score - expected;
  const none = items.every((item) => item.points === 0) && items.length === 0;

  return (
    <div className={styles.breakdown}>
      <div className={styles.line}>
        <span>{t(lang, 'score_breakdown_start')}</span>
        <span className={styles.points}>100</span>
      </div>

      {none && other === 0 && <p className={styles.none}>{t(lang, 'score_breakdown_none')}</p>}

      {items.map((item, i) => {
        const { title, detail } = describe(lang, item);
        return (
          <div key={i} className={styles.line}>
            <div>
              <div className={styles.label}>{title}</div>
              {detail && <div className={styles.why}>{detail}</div>}
            </div>
            <span className={`${styles.points} ${item.points < 0 ? styles.taken : styles.free}`}>{signed(item.points)}</span>
          </div>
        );
      })}

      {other !== 0 && (
        <div className={styles.line}>
          <div className={styles.label}>{t(lang, 'score_breakdown_other')}</div>
          <span className={`${styles.points} ${other < 0 ? styles.taken : styles.free}`}>{signed(other)}</span>
        </div>
      )}

      <div className={`${styles.line} ${styles.total}`}>
        <span>{t(lang, 'score_breakdown_total')}</span>
        <span className={styles.points}>{score === null ? '—' : `${score}/100`}</span>
      </div>
      <Legend lang={lang} />
    </div>
  );
}

/**
 * The same calculation over a period: each reason with how many of the days it
 * applied on and what it cost per day on average, so "Starts at 100" minus the
 * lines gives the period's average score.
 */
export function AggregateBreakdown({ lang, period }: { lang: Lang; period: PeriodScore }) {
  const avg = (points: number) => (points === 0 ? '0' : `${points < 0 ? '−' : '+'}${Math.abs(points).toFixed(1)}`);
  return (
    <div className={styles.breakdown}>
      <div className={styles.line}>
        <span>{t(lang, 'score_breakdown_start')}</span>
        <span className={styles.points}>100</span>
      </div>

      {period.items.length === 0 && <p className={styles.none}>{t(lang, 'score_breakdown_none')}</p>}

      {period.items.map((item) => {
        const { title, detail } = describe(lang, item.latest);
        return (
          <div key={item.code} className={styles.line}>
            <div>
              <div className={styles.label}>{title}</div>
              <div className={styles.why}>
                {t(lang, 'score_period_hit').replace('{n}', String(item.days)).replace('{total}', String(period.days))}
                {detail ? ` · ${detail}` : ''}
              </div>
            </div>
            <span className={`${styles.points} ${item.points < 0 ? styles.taken : styles.free}`}>
              {avg(item.points)} <span className={styles.avg}>{t(lang, 'score_period_avg')}</span>
            </span>
          </div>
        );
      })}

      <div className={`${styles.line} ${styles.total}`}>
        <span>{t(lang, 'score_breakdown_total')}</span>
        <span className={styles.points}>{period.score}/100</span>
      </div>
      <Legend lang={lang} />
    </div>
  );
}
