// "Live energy flow" header block shared by `/admin/fleet`, the customer
// `/app/dashboard` and — with `scope="site"` and a single row — both per-site
// pages: the flow diagram plus three at-a-glance panels the stat cards below
// don't cover — battery energy in reserve, solar output against installed
// capacity, and what needs attention right now. Pure
// presentational, same as FlowDiagram: everything is derived from the site
// rows the page already fetched, no extra queries, no client state.
import type { ReactNode } from 'react';
import Link from 'next/link';
import type { FleetOverviewRow } from '@/lib/server/db/fleetOverviewCore';
import { t, type Lang } from '@/lib/i18n/strings';
import { FlowDiagram, splitCounts } from './FlowDiagram';
import styles from './fleet-live.module.css';

const LOW_SOC_PCT = 20;
const ATTENTION_ROWS_SHOWN = 5;

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const kw = (w: number) => (w / 1000).toFixed(1);

// `insights` reasons deep-link to the site page's insights section, where each
// finding is spelled out; the rest just open the site.
type Reason = { severity: number; text: string; insights?: boolean };

function attentionReasons(site: FleetOverviewRow, lang: Lang): Reason[] {
  const reasons: Reason[] = [];
  if (site.active_critical_alerts > 0) {
    reasons.push({ severity: 5, text: t(lang, 'fleet_live_reason_critical').replace('{n}', String(site.active_critical_alerts)) });
  }
  if (site.connection_status !== 'online') {
    reasons.push({
      severity: 4,
      text: t(lang, site.connection_status === 'never_synced' ? 'fleet_live_reason_never' : 'fleet_live_reason_offline'),
    });
  }
  if (site.active_alarms > 0) {
    reasons.push({ severity: 3, text: t(lang, 'fleet_live_reason_alarms').replace('{n}', String(site.active_alarms)) });
  }
  if (site.connection_status === 'online' && site.live_soc_pct !== null && site.live_soc_pct < LOW_SOC_PCT) {
    reasons.push({ severity: 2, text: t(lang, 'fleet_live_reason_low_soc').replace('{pct}', String(site.live_soc_pct)) });
  }
  if (site.active_anomalies.length > 0) {
    reasons.push({ severity: 1, text: t(lang, 'fleet_live_reason_insights').replace('{n}', String(site.active_anomalies.length)), insights: true });
  }
  return reasons;
}

export function FleetLiveSection({
  sites,
  lang,
  loadLabel,
  siteHrefBase,
  scope = 'fleet',
  aside,
}: {
  sites: FleetOverviewRow[];
  lang: Lang;
  loadLabel?: string;
  /** Prefix each site's own page lives under, e.g. `/admin/fleet/`. */
  siteHrefBase: string;
  /** `site`: `sites` is the one site whose page this is — wording drops the
   * "across all sites" framing and the attention panel lists its reasons
   * instead of linking to itself. */
  scope?: 'fleet' | 'site';
  /** Optional extra card (site pages: health scores + energy sources), shown as a
   * third column on wide screens and below the block otherwise. */
  aside?: ReactNode;
}) {
  const single = scope === 'site';
  // A stale site's last snapshot still has real (once-live) readings sitting
  // in its row — gating on `connection_status === 'online'` (the same
  // ~45-minute freshness `_connectionStatus()` computes) keeps these
  // fleet-wide "live" totals actually live, instead of quietly summing
  // months-old readings as if they were current.
  const onlineSites = sites.filter((s) => s.connection_status === 'online');
  const solarSites = onlineSites.filter((s) => s.live_pv_power_w !== null);
  const loadSites = onlineSites.filter((s) => s.live_load_power_w !== null);
  const batterySites = onlineSites.filter((s) => s.live_battery_power_w !== null);
  const meteredSites = onlineSites.filter((s) => s.has_grid_meter);
  const socSites = onlineSites.filter((s) => s.live_soc_pct !== null);

  const totalSolar = sum(solarSites.map((s) => s.live_pv_power_w ?? 0));
  const totalLoad = sum(loadSites.map((s) => s.live_load_power_w ?? 0));
  const totalBattery = sum(batterySites.map((s) => s.live_battery_power_w ?? 0));
  const totalGrid = sum(meteredSites.map((s) => s.live_grid_power_w ?? 0));
  const avgSoc = socSites.length > 0 ? Math.round((sum(socSites.map((s) => s.live_soc_pct ?? 0)) / socSites.length) * 10) / 10 : null;

  const siteCount = String(sites.length);
  const ofSites = (n: number) => t(lang, 'admin_fleet_flow_note_of_sites').replace('{n}', String(n)).replace('{m}', siteCount);

  // Battery reserve: only sites that report a SOC AND have a known usable
  // size can say how many kWh are actually in the bank — a site missing
  // either would otherwise count as an empty (or full) battery of unknown
  // size, so it is left out and the note says how many were counted.
  const reserveSites = onlineSites.filter((s) => s.live_soc_pct !== null && s.battery_usable_kwh !== null && s.battery_usable_kwh > 0);
  const reserveCapacityKwh = sum(reserveSites.map((s) => s.battery_usable_kwh ?? 0));
  const reserveStoredKwh = sum(reserveSites.map((s) => ((s.battery_usable_kwh ?? 0) * (s.live_soc_pct ?? 0)) / 100));
  const reservePct = reserveCapacityKwh > 0 ? (reserveStoredKwh / reserveCapacityKwh) * 100 : null;

  // Solar vs installed: same rule — only sites with both a live PV reading
  // and a configured kWp, so the ratio compares like with like.
  const capacitySites = onlineSites.filter((s) => s.live_pv_power_w !== null && s.pv_kwp !== null && s.pv_kwp > 0);
  const installedKwp = sum(capacitySites.map((s) => s.pv_kwp ?? 0));
  const solarNowW = sum(capacitySites.map((s) => s.live_pv_power_w ?? 0));
  const solarPct = installedKwp > 0 ? (solarNowW / 1000 / installedKwp) * 100 : null;

  const attention = sites
    .map((site) => ({ site, reasons: attentionReasons(site, lang) }))
    .filter((entry) => entry.reasons.length > 0)
    .sort(
      (a, b) =>
        Math.max(...b.reasons.map((r) => r.severity)) - Math.max(...a.reasons.map((r) => r.severity)) ||
        b.reasons.length - a.reasons.length ||
        a.site.display_name.localeCompare(b.site.display_name),
    );

  return (
    <div className={styles.section}>
      <h2 className={styles.title}>{t(lang, 'fleet_live_title')}</h2>
      <p className={styles.sub}>{t(lang, single ? 'site_live_sub' : 'fleet_live_sub')}</p>

      <div className={`${styles.grid} ${aside ? styles.withAside : ''}`}>
        <div className={styles.flow}>
          <FlowDiagram
            lang={lang}
            solarW={solarSites.length > 0 ? totalSolar : null}
            solarNote={single ? undefined : ofSites(solarSites.length)}
            loadW={loadSites.length > 0 ? totalLoad : null}
            loadLabel={loadLabel ?? t(lang, 'site_live_load_label')}
            batteryW={batterySites.length > 0 ? totalBattery : null}
            batteryNote={single ? (avgSoc === null ? undefined : `${avgSoc}%`) : t(lang, 'admin_fleet_flow_battery_note')}
            batterySplit={single ? undefined : splitCounts(batterySites.map((s) => s.live_battery_power_w))}
            socPct={avgSoc}
            gridW={totalGrid}
            hasGridMeter={meteredSites.length > 0}
            gridSplit={single ? undefined : splitCounts(meteredSites.map((s) => s.live_grid_power_w))}
            gridNote={single ? undefined : ofSites(meteredSites.length)}
          />
        </div>

        <div className={styles.side}>
          <div className={styles.card}>
            <div className={styles.label}>{t(lang, 'fleet_live_reserve_title')}</div>
            {reservePct === null ? (
              <>
                <div className={styles.empty}>—</div>
                {single && <div className={styles.note}>{t(lang, 'site_live_reserve_unknown')}</div>}
              </>
            ) : (
              <>
                <div className={styles.value}>
                  {t(lang, 'fleet_live_reserve_value')
                    .replace('{stored}', reserveStoredKwh.toFixed(1))
                    .replace('{total}', reserveCapacityKwh.toFixed(1))}
                </div>
                <div className={styles.bar} role="img" aria-label={`${Math.round(reservePct)}%`}>
                  <div
                    className={styles.barFill}
                    style={{ width: `${Math.min(reservePct, 100)}%`, background: reservePct < LOW_SOC_PCT ? 'var(--signal)' : 'var(--good)' }}
                  />
                </div>
                <div className={styles.note}>
                  {t(lang, single ? 'site_live_reserve_note' : 'fleet_live_reserve_note')
                    .replace('{pct}', String(Math.round(reservePct)))
                    .replace('{n}', String(reserveSites.length))
                    .replace('{m}', siteCount)}
                </div>
              </>
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.label}>{t(lang, 'fleet_live_solar_title')}</div>
            {solarPct === null ? (
              <>
                <div className={styles.empty}>—</div>
                {single && <div className={styles.note}>{t(lang, 'site_live_solar_unknown')}</div>}
              </>
            ) : (
              <>
                <div className={styles.value}>
                  {t(lang, 'fleet_live_solar_value').replace('{now}', kw(solarNowW)).replace('{installed}', installedKwp.toFixed(1))}
                </div>
                <div className={styles.bar} role="img" aria-label={`${Math.round(solarPct)}%`}>
                  <div className={styles.barFill} style={{ width: `${Math.min(solarPct, 100)}%`, background: 'var(--signal)' }} />
                </div>
                <div className={styles.note}>
                  {t(lang, single ? 'site_live_solar_note' : 'fleet_live_solar_note')
                    .replace('{pct}', String(Math.round(solarPct)))
                    .replace('{n}', String(capacitySites.length))
                    .replace('{m}', siteCount)}
                </div>
              </>
            )}
          </div>

          <div className={`${styles.card} ${styles.attentionCard}`}>
            <div className={styles.label}>{t(lang, 'fleet_live_attention_title')}</div>
            {attention.length === 0 ? (
              <div className={styles.note}>{t(lang, single ? 'site_live_attention_none' : 'fleet_live_attention_none')}</div>
            ) : (
              <ul className={styles.attentionList}>
                {attention.slice(0, single ? attention.length : ATTENTION_ROWS_SHOWN).map(({ site, reasons }) => {
                  const siteHref = single ? '' : `${siteHrefBase}${encodeURIComponent(site.site_id)}`;
                  const ordered = [...reasons].sort((x, y) => y.severity - x.severity);
                  return (
                    <li key={site.site_id} className={styles.attentionRow}>
                      {!single && (
                        <Link href={siteHref} className={styles.attentionLink}>
                          {site.display_name}
                        </Link>
                      )}
                      <span className={`${styles.attentionReasons} ${single ? styles.reasonsAlone : ''}`}>
                        {ordered.map((r, i) => (
                          <span key={r.text}>
                            {i > 0 && ' · '}
                            {r.insights ? (
                              <Link href={`${siteHref}#insights`} className={styles.reasonLink}>
                                {r.text}
                              </Link>
                            ) : (
                              r.text
                            )}
                          </span>
                        ))}
                      </span>
                    </li>
                  );
                })}
                {!single && attention.length > ATTENTION_ROWS_SHOWN && (
                  <li className={styles.note}>{t(lang, 'fleet_live_attention_more').replace('{n}', String(attention.length - ATTENTION_ROWS_SHOWN))}</li>
                )}
              </ul>
            )}
            {attention.some((entry) => entry.reasons.some((r) => r.insights)) && (
              <div className={styles.note}>{t(lang, 'fleet_live_insights_hint')}</div>
            )}
          </div>
        </div>

        {aside && <div className={styles.aside}>{aside}</div>}
      </div>
    </div>
  );
}
