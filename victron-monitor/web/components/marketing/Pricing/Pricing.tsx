'use client';

import { Button, Panel, SectionHead } from '@/components/ui';
import styles from './Pricing.module.css';

export type PricingProps = {
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
export function Pricing({ starterPlanId, growthPlanId }: PricingProps) {
  return (
    <section id="pricing">
      <div className="wrap">
        <SectionHead
          eyebrow="Pricing"
          lede="One flat rate per tier — no per-site math, no surprise bill as you add sites. Reports for every tier; live monitoring from Growth up."
        >
          Subscribe one system,
          <br />
          or a whole fleet.
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
              Every plan starts with a 7-day free trial — cancel before it ends and you won&apos;t be charged.
            </div>
            <div className={styles.grid}>
            <Panel variant="price">
              <div className={styles.head}>
                <h3>Starter</h3>
                <span className={styles.range}>Up to 10 sites</span>
              </div>
              <div className={styles.num}>
                $29.99<span className={styles.per}>/ mo</span>
              </div>
              <p className={styles.singleNote} style={{ marginTop: -8, marginBottom: 12 }}>
                or $299.99 / yr
                <span className={styles.yearlySavings}>Save 17%</span>
              </p>
              <ul className={styles.features}>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  Automatic weekly &amp; Overview reports
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  Up to 100 scheduled reports / mo
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  Health score + AI narrative
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  CSV upload or VRM API auto-sync
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  Spanish / English
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  Automatic email delivery
                </li>
              </ul>
              <Button href={signupHref(starterPlanId)} variant="ghost" style={{ justifyContent: 'center' }}>
                Get started
              </Button>
            </Panel>

            <Panel variant="price" featured hairline featuredTag="Most installers">
              <div className={styles.head}>
                <h3>Growth</h3>
                <span className={styles.range}>Up to 50 sites</span>
              </div>
              <div className={styles.num}>
                $99.99<span className={styles.per}>/ mo</span>
              </div>
              <p className={styles.singleNote} style={{ marginTop: -8, marginBottom: 12 }}>
                or $999.99 / yr
                <span className={styles.yearlySavings}>Save 17%</span>
              </p>
              <ul className={styles.features}>
                <li className={styles.carry}>Everything in Starter, plus</li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  Live dashboard — real-time solar, load &amp; battery
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  Health score updated continuously, not just weekly
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  AI Insights — 4 automated checks per site <em>(Beta)</em>
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  Up to 300 scheduled reports / mo
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  Full white-label branding
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  Per-site report customization
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  Priority support
                </li>
              </ul>
              <Button href={signupHref(growthPlanId)} style={{ justifyContent: 'center' }}>
                Get started
              </Button>
            </Panel>

            <Panel variant="price">
              <div className={styles.head}>
                <h3>Fleet</h3>
                <span className={styles.range}>50+ sites</span>
              </div>
              <div className={styles.num} style={{ fontSize: 32 }}>
                Custom
              </div>
              <ul className={styles.features}>
                <li className={styles.carry}>Everything in Growth, plus</li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  Up to 2,000 scheduled reports / mo
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  Dedicated onboarding
                </li>
                <li>
                  <span className={styles.dot} aria-hidden="true" />
                  Delivery SLA
                </li>
              </ul>
              <Button
                href="mailto:proyectos@paulyco.com?subject=VRM%20Monitor%20-%20Fleet%20pricing"
                variant="ghost"
                style={{ justifyContent: 'center' }}
              >
                Talk to us
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

        <p className={styles.note}>
          Early-access pricing — subscription rates locked in for 12 months for owners and installers who join
          during onboarding.
        </p>
      </div>
    </section>
  );
}
