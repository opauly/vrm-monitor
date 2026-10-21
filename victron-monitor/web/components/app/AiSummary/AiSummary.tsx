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

// A summary is kept for CACHE_MS after it arrives, per view (the endpoint says which: the whole fleet, one customer, one property),
// so flipping between filters and back shows the same text instantly instead of waiting for it again. The server keeps its own
// copy too (a summary is rebuilt only when something real changed), this just saves the round trip. Memory first, then
// sessionStorage so a page reload inside the window is instant as well. Both are best effort: without them it simply fetches.
const CACHE_MS = 15 * 60 * 1000;
const memory = new Map<string, { at: number; insight: InsightOut }>();

function cachedInsight(endpoint: string): InsightOut | null {
  const now = Date.now();
  const hit = memory.get(endpoint);
  if (hit && now - hit.at < CACHE_MS) return hit.insight;
  try {
    const raw = window.sessionStorage.getItem(`ai-summary:${endpoint}`);
    if (raw) {
      const stored = JSON.parse(raw) as { at: number; insight: InsightOut };
      if (now - stored.at < CACHE_MS) {
        memory.set(endpoint, stored);
        return stored.insight;
      }
    }
  } catch {
    /* storage unavailable: just fetch */
  }
  return null;
}

function rememberInsight(endpoint: string, insight: InsightOut): void {
  const entry = { at: Date.now(), insight };
  memory.set(endpoint, entry);
  try {
    window.sessionStorage.setItem(`ai-summary:${endpoint}`, JSON.stringify(entry));
  } catch {
    /* storage unavailable or full */
  }
}

const LOADING_LINES = ['ai_summary_loading_1', 'ai_summary_loading_2', 'ai_summary_loading_3', 'ai_summary_loading_4'] as const;

function Loading({ lang }: { lang: Lang }) {
  // A different line every couple of seconds, so a slow summary reads as "working", not "stuck".
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % LOADING_LINES.length), 2200);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className={styles.loading} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      {t(lang, LOADING_LINES[index])}
    </div>
  );
}

export function AiSummary({ lang, endpoint }: { lang: Lang; endpoint: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  // The view changed (a filter was clicked): drop the old view's text at once — it is about something else now — and show this view's
  // remembered summary, or the loading line while the new one is fetched. Adjusting state during render, as React's docs recommend.
  const [trackedEndpoint, setTrackedEndpoint] = useState<string | null>(null);
  if (trackedEndpoint !== endpoint) {
    setTrackedEndpoint(endpoint);
    setState({ status: 'loading' });
  }

  useEffect(() => {
    let active = true;
    const remembered = cachedInsight(endpoint);
    if (remembered) {
      // Next tick, not synchronously: the first render must match the server's (loading) or React complains on hydration.
      void Promise.resolve().then(() => {
        if (active) setState(remembered.enabled && remembered.headline ? { status: 'ready', insight: remembered } : { status: 'hidden' });
      });
      return () => {
        active = false;
      };
    }
    // A summary that has to be rewritten takes several seconds; if the first try times out the server
    // usually finishes it anyway, so one more try a few seconds later normally finds it ready.
    const load = (attemptsLeft: number): void => {
      fetch(endpoint)
        .then((r) => (r.ok ? (r.json() as Promise<InsightOut>) : Promise.reject(new Error('fetch failed'))))
        .then((insight) => {
          if (!active) return;
          rememberInsight(endpoint, insight);
          setState(insight.enabled && insight.headline ? { status: 'ready', insight } : { status: 'hidden' });
        })
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
        <Loading lang={lang} />
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
