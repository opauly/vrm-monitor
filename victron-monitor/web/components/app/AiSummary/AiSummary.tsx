'use client';

import { useEffect, useState } from 'react';
import { t, type Lang } from '@/lib/i18n/strings';
import type { InsightOut } from '@/lib/server/pipeline';
import styles from './AiSummary.module.css';

// The daily summary at the top of a fleet or site page: a headline, up to three
// findings and one practical suggestion. It is fetched client-side from a tiny
// route (`/api/.../insights/...`) because the server regenerates a stale one on
// demand — the page must not wait for that. If summaries are switched off, or
// anything goes wrong, nothing is rendered: no empty card, no error box.
//
// Every number in the text comes from the system's own stored data; when a model
// wrote the text it is checked against those numbers first (see
// victron/insight_ai.py), otherwise the plain template text is shown. The footer
// says which.

type State = { status: 'loading' } | { status: 'hidden' } | { status: 'ready'; insight: InsightOut };

export function AiSummary({ lang, endpoint }: { lang: Lang; endpoint: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    // A summary that has to be rewritten takes several seconds; if the first try times out the server
    // usually finishes it anyway, so one more try a few seconds later normally finds it ready.
    const load = (attemptsLeft: number): void => {
      fetch(endpoint)
        .then((r) => (r.ok ? (r.json() as Promise<InsightOut>) : Promise.reject(new Error('fetch failed'))))
        .then((insight) => active && setState(insight.enabled && insight.headline ? { status: 'ready', insight } : { status: 'hidden' }))
        .catch(() => {
          if (!active) return;
          if (attemptsLeft > 0) setTimeout(() => load(attemptsLeft - 1), 5000);
          else setState({ status: 'hidden' });
        });
    };
    load(1);
    return () => {
      active = false;
    };
  }, [endpoint]);

  if (state.status === 'hidden') return null;
  if (state.status === 'loading') {
    return (
      <section className={styles.card} aria-busy="true">
        <div className={styles.label}>{t(lang, 'ai_summary_title')}</div>
        <div className={styles.loading}>{t(lang, 'ai_summary_loading')}</div>
      </section>
    );
  }

  const { insight } = state;
  return (
    <section className={styles.card}>
      <div className={styles.label}>
        {t(lang, 'ai_summary_title')}
        {insight.source === 'ai' && <span className={styles.badge}>AI</span>}
      </div>
      <h2 className={styles.headline}>{insight.headline}</h2>
      {insight.points.length > 0 && (
        <ul className={styles.points}>
          {insight.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}
      {insight.suggestion && (
        <p className={styles.suggestion}>
          <span className={styles.suggestionLabel}>{t(lang, 'ai_summary_suggestion')}</span> {insight.suggestion}
        </p>
      )}
      <div className={styles.footer}>
        {t(lang, insight.source === 'ai' ? 'ai_summary_note_ai' : 'ai_summary_note_template')}
        {insight.date ? ` · ${t(lang, 'ai_summary_day').replace('{date}', insight.date)}` : ''}
      </div>
    </section>
  );
}
