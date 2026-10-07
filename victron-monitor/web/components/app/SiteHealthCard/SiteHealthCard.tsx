import type { ReactNode } from 'react';
import { Gauge } from '@/app/(admin)/admin/fleet/Gauge';
import { InfoTooltip } from '@/components/ui';
import { AggregateBreakdown, ScoreBreakdown } from '@/components/app/ScoreBreakdown/ScoreBreakdown';
import { PeriodPane, PeriodSwitch } from '@/components/app/PeriodView/PeriodView';
import { scoreBand, type PeriodScore } from '@/lib/healthBreakdown';
import { gridScoreInfo, systemScoreInfo } from '@/lib/healthScoreInfo';
import { t, type Lang } from '@/lib/i18n/strings';
import type { FleetOverviewRow, PeriodSummary } from '@/lib/server/db/fleetOverviewCore';
import styles from './SiteHealthCard.module.css';

// The scores card beside the live-flow panels on a site page (admin and
// customer share it). Three views behind the page's Today / 7 days / 30 days
// switch: "today" is the latest scored day — a day is scored once it is
// complete, so today's own score doesn't exist yet — and 7 / 30 days average
// the daily scores and show how often each reason applied.

const bandClass = (score: number | null) => {
  if (score === null) return styles.none;
  return styles[scoreBand(score)];
};

const bandLabel = (lang: Lang, score: number) =>
  t(lang, `score_status_${scoreBand(score)}` as 'score_status_excellent' | 'score_status_good' | 'score_status_watch' | 'score_status_attention');

type Gauges = { selfSufficiency: number | null; selfConsumption: number | null; dod: number | null };

function GaugeStack({ lang, gauges }: { lang: Lang; gauges: Gauges }) {
  return (
    <div className={styles.gauges}>
      <Gauge
        pct={gauges.selfSufficiency}
        color="var(--good)"
        label={t(lang, 'admin_fleet_card_self_sufficiency_label')}
        desc={
          gauges.selfSufficiency === null
            ? t(lang, 'admin_fleetsite_gauge_not_enough_data')
            : t(lang, 'admin_fleetsite_gauge_self_suff_desc').replace('{pct}', String(gauges.selfSufficiency))
        }
      />
      <Gauge
        pct={gauges.selfConsumption}
        color="var(--victron-glow)"
        label={t(lang, 'admin_fleet_card_self_consumption_label')}
        desc={
          gauges.selfConsumption === null
            ? t(lang, 'admin_fleetsite_gauge_not_enough_data')
            : t(lang, 'admin_fleetsite_gauge_self_cons_desc').replace('{pct}', String(gauges.selfConsumption))
        }
      />
      <Gauge
        pct={gauges.dod}
        color="var(--signal)"
        label={t(lang, 'admin_fleetsite_gauge_dod_label')}
        desc={
          gauges.dod === null
            ? t(lang, 'admin_fleetsite_gauge_not_enough_data')
            : t(lang, 'admin_fleetsite_gauge_dod_desc').replace('{pct}', String(gauges.dod))
        }
      />
    </div>
  );
}

function ScoreBlock({
  lang,
  label,
  tooltipLabel,
  tooltip,
  score,
  status,
  calculation,
  emptyText,
}: {
  lang: Lang;
  label: string;
  tooltipLabel: string;
  tooltip: ReactNode;
  score: number | null;
  status: string | null;
  /** The opened "how this was calculated" content, or null when there's nothing to open. */
  calculation: ReactNode | null;
  emptyText: string;
}) {
  return (
    <div className={styles.scoreBlock}>
      <div className={styles.scoreLabel}>
        {label}
        <InfoTooltip label={tooltipLabel}>{tooltip}</InfoTooltip>
      </div>
      {score === null ? (
        <div className={styles.none}>{emptyText}</div>
      ) : (
        <>
          <div className={styles.scoreRow}>
            <span className={`${styles.badge} ${bandClass(score)}`}>{score}/100</span>
            {status && <span className={styles.status}>{status}</span>}
          </div>
          {calculation && (
            <details className={styles.details}>
              <summary className={styles.toggle}>{t(lang, 'score_notes_toggle')}</summary>
              {calculation}
            </details>
          )}
        </>
      )}
    </div>
  );
}

function DayPane({ lang, site }: { lang: Lang; site: FleetOverviewRow }) {
  return (
    <div className={styles.pane}>
      <h2 className={styles.title}>
        {site.health_date ? t(lang, 'score_today_title').replace('{date}', site.health_date) : t(lang, 'admin_fleetsite_today_glance')}
      </h2>
      <div className={styles.scores}>
        <ScoreBlock
          lang={lang}
          label={t(lang, 'admin_fleetsite_score_system_label')}
          tooltipLabel={t(lang, 'score_info_system_tooltip_label')}
          tooltip={systemScoreInfo(lang)}
          score={site.system_score}
          status={site.system_status}
          calculation={<ScoreBreakdown lang={lang} items={site.system_breakdown} notes={site.system_notes} score={site.system_score} />}
          emptyText="—"
        />
        <ScoreBlock
          lang={lang}
          label={t(lang, 'admin_fleetsite_kpi_grid')}
          tooltipLabel={t(lang, 'score_info_grid_tooltip_label')}
          tooltip={gridScoreInfo(lang)}
          score={site.grid_score}
          status={site.grid_status}
          calculation={<ScoreBreakdown lang={lang} items={site.grid_breakdown} notes={site.grid_notes} score={site.grid_score} />}
          emptyText={t(lang, 'admin_fleetsite_no_grid_connection')}
        />
      </div>
      <GaugeStack
        lang={lang}
        gauges={{ selfSufficiency: site.self_sufficiency_pct, selfConsumption: site.self_consumption_pct, dod: site.dod_pct }}
      />
      <p className={styles.sub}>{t(lang, 'score_today_note')}</p>
    </div>
  );
}

function PeriodScoreBlockPair({ lang, summary, hasGrid }: { lang: Lang; summary: PeriodSummary; hasGrid: boolean }) {
  const block = (
    label: string,
    tooltipLabel: string,
    tooltip: ReactNode,
    period: PeriodScore | null,
    emptyText: string,
  ) => (
    <ScoreBlock
      lang={lang}
      label={label}
      tooltipLabel={tooltipLabel}
      tooltip={tooltip}
      score={period?.score ?? null}
      status={period ? bandLabel(lang, period.score) : null}
      calculation={period ? <AggregateBreakdown lang={lang} period={period} /> : null}
      emptyText={emptyText}
    />
  );
  return (
    <div className={styles.scores}>
      {block(
        t(lang, 'admin_fleetsite_score_system_label'),
        t(lang, 'score_info_system_tooltip_label'),
        systemScoreInfo(lang),
        summary.system,
        t(lang, 'score_period_none'),
      )}
      {block(
        t(lang, 'admin_fleetsite_kpi_grid'),
        t(lang, 'score_info_grid_tooltip_label'),
        gridScoreInfo(lang),
        summary.grid,
        hasGrid ? t(lang, 'score_period_none') : t(lang, 'admin_fleetsite_no_grid_connection'),
      )}
    </div>
  );
}

function PeriodBody({ lang, summary, hasGrid, titleKey }: { lang: Lang; summary: PeriodSummary; hasGrid: boolean; titleKey: 'score_period_title_week' | 'score_period_title_month' }) {
  const days = summary.system?.days ?? summary.grid?.days ?? 0;
  return (
    <div className={styles.pane}>
      <h2 className={styles.title}>{t(lang, titleKey)}</h2>
      <PeriodScoreBlockPair lang={lang} summary={summary} hasGrid={hasGrid} />
      <GaugeStack lang={lang} gauges={{ selfSufficiency: summary.self_sufficiency_pct, selfConsumption: summary.self_consumption_pct, dod: summary.dod_pct }} />
      {days > 0 && <p className={styles.sub}>{t(lang, 'score_period_days').replace('{n}', String(days))}</p>}
    </div>
  );
}

export function SiteHealthCard({ lang, site }: { lang: Lang; site: FleetOverviewRow }) {
  const hasGrid = site.grid_score !== null || site.system_type !== 'off_grid';
  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <PeriodSwitch lang={lang} />
      </div>
      <PeriodPane period="today">
        <DayPane lang={lang} site={site} />
      </PeriodPane>
      <PeriodPane period="week">
        <PeriodBody lang={lang} summary={site.summary_week} hasGrid={hasGrid} titleKey="score_period_title_week" />
      </PeriodPane>
      <PeriodPane period="month">
        <PeriodBody lang={lang} summary={site.summary_month} hasGrid={hasGrid} titleKey="score_period_title_month" />
      </PeriodPane>
    </div>
  );
}
