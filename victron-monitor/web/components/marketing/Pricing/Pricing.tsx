'use client';

import { Button, Panel, SectionHead } from '@/components/ui';
import { t, type Lang } from '@/lib/i18n/strings';
import styles from './Pricing.module.css';

export type PricingProps = {
  lang: Lang;
  /** Real `vrm.plans.id` rows for the MONTHLY Starter/Growth tiers, in the
   * current `ONVO_MODE` (PLAN_PHASE16.md §8 Step 5.5 build item 7,
   * `lib/server/db/signup.ts:getFeaturedSelfServePlanIds()`) — fetched by
   * `app/(marketing)/page.tsx` (a Server Component; this one is a client
   * component and has no session-free way to reach the database itself).
   * `null` for a tier that isn't currently seeded/self-serve/active, in
   * which case that card's button falls back to a bare `/signup` link
   * rather than a dead id. */
  starterPlanId: string | null;
  growthPlanId: string | null;
};

function signupHref(planId: string | null): string {
  return planId ? `/signup?plan=${planId}` : '/signup';
}

// Still a client component even with the mode toggle below hidden
// (2026-09-23) — nothing else here needs client state, but re-adding the
// toggle later (see this file's own commented-out block further down)
// shouldn't also require re-adding 'use client' at the same time.
export function Pricing({ starterPlanId, growthPlanId, lang }: PricingProps) {
  return (
    <section id="pricing">
      <div className="wrap">
        <SectionHead eyebrow={t(lang, 'marketing_pricing_eyebrow')} lede={t(lang, 'marketing_pricing_lede')}>
          {t(lang, 'marketing_pricing_title_a')}
          <br />
          {t(lang, 'marketing_pricing_title_b')}
        </SectionHead>

        {/* Subscription-vs-Single-Report toggle, hidden 2026-09-23 (Oscar's
            own call) — every solar-monitoring competitor (Fronius Solar.web,
            Enphase Enlighten, SolarEdge monitoring) is subscription-only,
            with a free trial doing all the "try before you commit" work;
            a $9.99 one-off SKU next to two real subscriptions added a
            choice most visitors didn't need, and its own fulfillment was a
            manual mailto exchange that couldn't back up its "delivered
            within minutes" copy. Commented out, not deleted — the
            underlying capability (a one-off CSV-only report, no ongoing
            relationship, no live connection required) is still real
            product architecture, just not surfaced as its own priced
            marketing card until there's an actual customer segment asking
            for it that the free trial genuinely can't serve. To restore:
            uncomment this block, the `single`-mode JSX further down, the
            `Mode` type, and re-add `useState`/`ModeToggle` to the imports
            above.
        <div className={styles.toggleRow}>
          <ModeToggle
            aria-label="Pricing model"
            value={mode}
            onChange={(next) => setMode(next as Mode)}
            options={[
              { value: 'subscription', label: 'Subscription' },
              { value: 'single', label: 'Single report' },
            ]}
          />
          <span className={styles.hint}>
            Start with a single report, upgrade to a subscription whenever — nothing to migrate.
          </span>
        </div>
        */}

        <>
            <div className={styles.trialBanner}>
              <span className={styles.trialBannerDot} aria-hidden="true" />
              {t(lang, 'marketing_pricing_trial_banner')}
            </div>
            <div className={styles.grid}>
            <Panel variant="price">
              <div className={styles.head}>
                <h3>{t(lang, 'marketing_pricing_starter_name')}</h3>
                <span className={styles.range}>{t(lang, 'marketing_pricing_starter_range')}</span>
              </div>
              <div className={styles.num}>
                $29.99<span className={styles.per}>{t(lang, 'marketing_pricing_per_mo')}</span>
              </div>
              <p className={styles.singleNote} style={{ marginTop: -8, marginBottom: 12 }}>
                {t(lang, 'marketing_pricing_yearly_starter')}
                <span className={styles.yearlySavings}>{t(lang, 'marketing_pricing_yearly_save')}</span>
              </p>
              <ul className={styles.features}>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  {t(lang, 'marketing_pricing_starter_li1')}
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  {t(lang, 'marketing_pricing_starter_li2')}
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  {t(lang, 'marketing_pricing_starter_li3')}
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  {t(lang, 'marketing_pricing_starter_li4')}
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  {t(lang, 'marketing_pricing_starter_li5')}
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  {t(lang, 'marketing_pricing_starter_li6')}
                </li>
              </ul>
              <Button href={signupHref(starterPlanId)} variant="ghost" style={{ justifyContent: 'center' }}>
                {t(lang, 'marketing_cta_get_started')}
              </Button>
            </Panel>

            <Panel variant="price" featured hairline featuredTag={t(lang, 'marketing_pricing_growth_featured_tag')}>
              <div className={styles.head}>
                <h3>{t(lang, 'marketing_pricing_growth_name')}</h3>
                <span className={styles.range}>{t(lang, 'marketing_pricing_growth_range')}</span>
              </div>
              <div className={styles.num}>
                $99.99<span className={styles.per}>{t(lang, 'marketing_pricing_per_mo')}</span>
              </div>
              <p className={styles.singleNote} style={{ marginTop: -8, marginBottom: 12 }}>
                {t(lang, 'marketing_pricing_yearly_growth')}
                <span className={styles.yearlySavings}>{t(lang, 'marketing_pricing_yearly_save')}</span>
              </p>
              <ul className={styles.features}>
                <li className={styles.carry}>{t(lang, 'marketing_pricing_growth_carry')}</li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  {t(lang, 'marketing_pricing_growth_li1')}
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  {t(lang, 'marketing_pricing_growth_li2')}
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  {t(lang, 'marketing_pricing_growth_li3')}
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  {t(lang, 'marketing_pricing_growth_li4')}
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  {t(lang, 'marketing_pricing_growth_li5')}
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  {t(lang, 'marketing_pricing_growth_li6')}
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  {t(lang, 'marketing_pricing_growth_li7')}
                </li>
              </ul>
              <Button href={signupHref(growthPlanId)} style={{ justifyContent: 'center' }}>
                {t(lang, 'marketing_cta_get_started')}
              </Button>
            </Panel>

            <Panel variant="price">
              <div className={styles.head}>
                <h3>{t(lang, 'marketing_pricing_fleet_name')}</h3>
                <span className={styles.range}>{t(lang, 'marketing_pricing_fleet_range')}</span>
              </div>
              <div className={styles.num} style={{ fontSize: 32 }}>
                {t(lang, 'marketing_pricing_custom')}
              </div>
              <ul className={styles.features}>
                <li className={styles.carry}>{t(lang, 'marketing_pricing_fleet_carry')}</li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  {t(lang, 'marketing_pricing_fleet_li1')}
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  {t(lang, 'marketing_pricing_fleet_li2')}
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  {t(lang, 'marketing_pricing_fleet_li3')}
                </li>
              </ul>
              <Button
                href="mailto:proyectos@paulyco.com?subject=VRM%20Monitor%20-%20Fleet%20pricing"
                variant="ghost"
                style={{ justifyContent: 'center' }}
              >
                {t(lang, 'marketing_pricing_talk_to_us')}
              </Button>
            </Panel>
            </div>
        </>

        {/* The "Single report" mode's own card — hidden alongside the
            toggle above, restore both together.
        <div className={styles.single}>
          <div>
            <span className={styles.singleTag}>One-time · no subscription</span>
            <h3 className={styles.singleH3}>Single Report</h3>
            <p className={styles.singleP}>
              Already have a CSV export, or just want to see one system's story before committing to a
              subscription? Upload it once — get back the exact same report a subscriber gets every week, nothing
              held back.
            </p>
            <ul className={styles.features} style={{ marginTop: 20 }}>
              <li>
                <span className={styles.dot} aria-hidden="true" />
                One site, any range up to 6 months of history
              </li>
              <li>
                <span className={styles.dot} aria-hidden="true" />
                All 12 report sections, full health scoring + AI narrative
              </li>
              <li>
                <span className={styles.dot} aria-hidden="true" />
                Delivered within minutes of upload
              </li>
            </ul>
          </div>
          <div className={styles.singleRight}>
            <div className={styles.num}>
              $9.99<span className={styles.per}>/ report</span>
            </div>
            <Button
              href="mailto:proyectos@paulyco.com?subject=VRM%20Monitor%20-%20Single%20report"
              style={{ justifyContent: 'center', width: '100%' }}
            >
              Get a report
            </Button>
            <span className={styles.singleNote}>
              One PDF, delivered once — no automatic re-delivery. Want it weekly instead? Switch to a subscription
              above, anytime.
            </span>
          </div>
        </div>
        */}

        <p className={styles.note}>{t(lang, 'marketing_pricing_note')}</p>
      </div>
    </section>
  );
}
