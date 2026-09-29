'use client';

import { useState } from 'react';
import { ModeToggle, Panel, SectionHead } from '@/components/ui';
import { FIXED_MODULE_ICONS, REPORT_MODULE_ICONS } from '@/lib/reportModuleThumbnails';
import { t, type Lang } from '@/lib/i18n/strings';
import styles from './ModuleGrid.module.css';

type Mode = 'detallado' | 'overview';

// Client component: the whole grid's text depends on `mode`, not just the
// toggle itself, so the interactive boundary is the section, matching how
// the template's [data-only] CSS hid/showed content inside the whole
// .cards-wrap rather than inside an isolated widget. React state replaces
// the template's data-mode attribute + [data-only] CSS pair directly — no
// DOM nodes for the inactive mode exist at all, rather than existing and
// being display:none'd, which is a strictly smaller DOM than the original
// for no behavioral difference a visitor or a screen reader would notice.
//
// Grouped into 5 native <details> sections (2026-09-05, Oscar's own
// feedback — 16 flat cards was too much to scan at once), same collapsible
// pattern the admin Fleet Dashboard's rollup cards already use: no client
// state needed for the grouping itself, keyboard-operable and accessible
// for free. All five start collapsed — no single group is privileged over
// the others — and every card's `mode`-dependent text still updates live
// even while its group is collapsed, since <details> only hides content
// visually, it doesn't unmount it.
export function ModuleGrid({ lang }: { lang: Lang }) {
  const [mode, setMode] = useState<Mode>('detallado');
  const detailed = mode === 'detallado';

  return (
    <section id="modules">
      <div className="wrap">
        <SectionHead eyebrow={t(lang, 'marketing_modules_eyebrow')} lede={t(lang, 'marketing_modules_lede')}>
          {t(lang, 'marketing_modules_title_a')}
          <br />
          {t(lang, 'marketing_modules_title_b')}
        </SectionHead>

        <div className={styles.toggleRow}>
          <ModeToggle
            aria-label={t(lang, 'marketing_modules_toggle_aria')}
            value={mode}
            onChange={(next) => setMode(next as Mode)}
            options={[
              { value: 'detallado', label: t(lang, 'marketing_modules_toggle_detailed') },
              { value: 'overview', label: t(lang, 'marketing_modules_toggle_overview') },
            ]}
          />
          <span className={styles.hint}>{t(lang, 'marketing_modules_toggle_hint')}</span>
        </div>

        <p className={styles.groupHint}>{t(lang, 'marketing_modules_group_hint')}</p>

        <div className={styles.groups}>
          <details className={styles.group}>
            <summary className={styles.groupSummary}>
              <h3>{t(lang, 'marketing_modules_group1_title')}</h3>
              <span className={styles.groupCount}>{t(lang, 'marketing_modules_group1_count')}</span>
            </summary>
            <div className={styles.groupGrid}>
              <Panel className={styles.moduleCard} variant="card" interactive led>
                <span className={styles.icon} aria-hidden="true">{FIXED_MODULE_ICONS.kpi}</span>
                <span className={styles.tag}>{t(lang, 'marketing_modules_tag_scoring')}</span>
                <h3>{t(lang, 'marketing_modules_kpi_title')}</h3>
                <p className={styles.body}>{t(lang, 'marketing_modules_kpi_body')}</p>
              </Panel>

              <Panel className={styles.moduleCard} variant="card" interactive led>
                <span className={styles.icon} aria-hidden="true">{FIXED_MODULE_ICONS.narrative}</span>
                <span className={styles.tag}>{t(lang, 'marketing_modules_tag_narrative')}</span>
                <h3>{t(lang, 'marketing_modules_narrative_title')}</h3>
                <p className={styles.body}>
                  {detailed ? t(lang, 'marketing_modules_narrative_body_detailed') : t(lang, 'marketing_modules_narrative_body_overview')}
                </p>
              </Panel>

              <Panel className={styles.moduleCard} variant="card" interactive led>
                <span className={styles.icon} aria-hidden="true">{REPORT_MODULE_ICONS.savings}</span>
                <span className={styles.tag}>{t(lang, 'marketing_modules_tag_savings')}</span>
                <h3>{t(lang, 'marketing_modules_savings_title')}</h3>
                <p className={styles.body}>{t(lang, 'marketing_modules_savings_body')}</p>
              </Panel>
            </div>
          </details>

          <details className={styles.group}>
            <summary className={styles.groupSummary}>
              <h3>{t(lang, 'marketing_modules_group2_title')}</h3>
              <span className={styles.groupCount}>{t(lang, 'marketing_modules_group2_count')}</span>
            </summary>
            <div className={styles.groupGrid}>
              <Panel className={styles.moduleCard} variant="card" interactive led>
                <span className={styles.icon} aria-hidden="true">{FIXED_MODULE_ICONS.bar_chart}</span>
                <span className={styles.adapts}>{t(lang, 'marketing_modules_tag_adapts')}</span>
                <h3>{detailed ? t(lang, 'marketing_modules_bar_title_detailed') : t(lang, 'marketing_modules_bar_title_overview')}</h3>
                <p className={styles.body}>
                  {detailed ? t(lang, 'marketing_modules_bar_body_detailed') : t(lang, 'marketing_modules_bar_body_overview')}
                </p>
              </Panel>

              <Panel className={styles.moduleCard} variant="card" interactive led>
                <span className={styles.icon} aria-hidden="true">{REPORT_MODULE_ICONS.energy_mix}</span>
                <span className={styles.tag}>{t(lang, 'marketing_modules_tag_energy_mix')}</span>
                <h3>{t(lang, 'marketing_modules_energy_mix_title')}</h3>
                <p className={styles.body}>{t(lang, 'marketing_modules_energy_mix_body')}</p>
              </Panel>

              <Panel className={styles.moduleCard} variant="card" interactive led>
                <span className={styles.icon} aria-hidden="true">{REPORT_MODULE_ICONS.solar_performance}</span>
                <span className={styles.tag}>{t(lang, 'marketing_modules_tag_performance')}</span>
                <h3>{t(lang, 'marketing_modules_solar_performance_title')}</h3>
                <p className={styles.body}>{t(lang, 'marketing_modules_solar_performance_body')}</p>
              </Panel>

              <Panel className={styles.moduleCard} variant="card" interactive led>
                <span className={styles.icon} aria-hidden="true">{REPORT_MODULE_ICONS.trend}</span>
                <span className={styles.fixedBadge}>{t(lang, 'marketing_modules_badge_always_weekly')}</span>
                <h3>{t(lang, 'marketing_modules_trend_title')}</h3>
                <p className={styles.body}>{t(lang, 'marketing_modules_trend_body')}</p>
              </Panel>

              <Panel className={styles.moduleCard} variant="card" interactive led>
                <span className={styles.icon} aria-hidden="true">{REPORT_MODULE_ICONS.weather}</span>
                <span className={styles.tag}>{t(lang, 'marketing_modules_tag_weather')}</span>
                <h3>{t(lang, 'marketing_modules_weather_title')}</h3>
                <p className={styles.body}>{t(lang, 'marketing_modules_weather_body')}</p>
              </Panel>
            </div>
          </details>

          <details className={styles.group}>
            <summary className={styles.groupSummary}>
              <h3>{t(lang, 'marketing_modules_group3_title')}</h3>
              <span className={styles.groupCount}>{t(lang, 'marketing_modules_group3_count')}</span>
            </summary>
            <div className={styles.groupGrid}>
              <Panel className={styles.moduleCard} variant="card" interactive led>
                <span className={styles.icon} aria-hidden="true">{REPORT_MODULE_ICONS.battery_health}</span>
                <span className={styles.tag}>{t(lang, 'marketing_modules_tag_battery')}</span>
                <h3>{t(lang, 'marketing_modules_battery_health_title')}</h3>
                <p className={styles.body}>{t(lang, 'marketing_modules_battery_health_body')}</p>
              </Panel>

              <Panel className={styles.moduleCard} variant="card" interactive led>
                <span className={styles.icon} aria-hidden="true">{REPORT_MODULE_ICONS.soc_chart}</span>
                <span className={styles.adapts}>{t(lang, 'marketing_modules_tag_adapts')}</span>
                <h3>{t(lang, 'marketing_modules_soc_title')}</h3>
                <p className={styles.body}>
                  {detailed ? t(lang, 'marketing_modules_soc_body_detailed') : t(lang, 'marketing_modules_soc_body_overview')}
                </p>
              </Panel>
            </div>
          </details>

          <details className={styles.group}>
            <summary className={styles.groupSummary}>
              <h3>{t(lang, 'marketing_modules_group4_title')}</h3>
              <span className={styles.groupCount}>{t(lang, 'marketing_modules_group4_count')}</span>
            </summary>
            <div className={styles.groupGrid}>
              <Panel className={styles.moduleCard} variant="card" interactive led>
                <span className={styles.icon} aria-hidden="true">{REPORT_MODULE_ICONS.grid_quality}</span>
                <span className={styles.tag}>{t(lang, 'marketing_modules_tag_grid')}</span>
                <h3>{t(lang, 'marketing_modules_grid_quality_title')}</h3>
                <p className={styles.body}>{t(lang, 'marketing_modules_grid_quality_body')}</p>
              </Panel>

              <Panel className={styles.moduleCard} variant="card" interactive led>
                <span className={styles.icon} aria-hidden="true">{REPORT_MODULE_ICONS.events}</span>
                <span className={styles.tag}>{t(lang, 'marketing_modules_tag_events')}</span>
                <h3>{t(lang, 'marketing_modules_events_title')}</h3>
                <p className={styles.body}>{t(lang, 'marketing_modules_events_body')}</p>
              </Panel>

              {/* PLAN_PHASE18.md §7 (2026-08-29) — critical_alerts is the one
                 module below in the default report for everyone; the other
                 three (in "Optional add-ons" below) are opt-in and depend on
                 hardware most systems don't have, so both get said outright
                 rather than implied. */}
              <Panel className={styles.moduleCard} variant="card" interactive led>
                <span className={styles.icon} aria-hidden="true">{REPORT_MODULE_ICONS.critical_alerts}</span>
                <span className={styles.tag}>{t(lang, 'marketing_modules_tag_safety')}</span>
                <h3>{t(lang, 'marketing_modules_critical_alerts_title')}</h3>
                <p className={styles.body}>{t(lang, 'marketing_modules_critical_alerts_body')}</p>
              </Panel>
            </div>
          </details>

          <details className={styles.group}>
            <summary className={styles.groupSummary}>
              <h3>{t(lang, 'marketing_modules_group5_title')}</h3>
              <span className={styles.groupCount}>{t(lang, 'marketing_modules_group5_count')}</span>
            </summary>
            <div className={styles.groupGrid}>
              <Panel className={styles.moduleCard} variant="card" interactive led>
                <span className={styles.icon} aria-hidden="true">{REPORT_MODULE_ICONS.grid_meter_detail}</span>
                <span className={styles.conditional}>{t(lang, 'marketing_modules_conditional_meter')}</span>
                <h3>{t(lang, 'marketing_modules_grid_meter_title')}</h3>
                <p className={styles.body}>{t(lang, 'marketing_modules_grid_meter_body')}</p>
              </Panel>

              <Panel className={styles.moduleCard} variant="card" interactive led>
                <span className={styles.icon} aria-hidden="true">{REPORT_MODULE_ICONS.generator_runtime}</span>
                <span className={styles.conditional}>{t(lang, 'marketing_modules_conditional_generator')}</span>
                <h3>{t(lang, 'marketing_modules_generator_title')}</h3>
                <p className={styles.body}>{t(lang, 'marketing_modules_generator_body')}</p>
              </Panel>

              <Panel className={styles.moduleCard} variant="card" interactive led>
                <span className={styles.icon} aria-hidden="true">{REPORT_MODULE_ICONS.tank_level}</span>
                <span className={styles.conditional}>{t(lang, 'marketing_modules_conditional_tank')}</span>
                <h3>{t(lang, 'marketing_modules_tank_title')}</h3>
                <p className={styles.body}>{t(lang, 'marketing_modules_tank_body')}</p>
              </Panel>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
