import Image from 'next/image';
import Link from 'next/link';
import { NavAuthArea } from './NavAuthArea';
import styles from './Nav.module.css';

// public/pauly_logo.png is 567x156 (landing-page/assets/pauly_logo.png,
// copied not moved — see PLAN_PHASE14.md §6.2). Referenced by URL string
// rather than a static `import` from public/, which is the conventional
// Next.js pattern for public/ assets (static import is for files colocated
// with components); explicit width/height here reproduces the aspect ratio
// next/image would otherwise infer from an imported module.
const LOGO_WIDTH = 567;
const LOGO_HEIGHT = 156;

// Server Component — nothing HERE reads client state (the auth-aware
// corner is its own small Client Component, `NavAuthArea`, so this stays a
// Server Component otherwise). Most nav links are anchors to in-page
// section ids (`/#how`, `/#dashboard`, ...) — an absolute path, not a bare
// `#how`, since `Nav` now renders on `/login`/`/signup`/etc. too
// (2026-08-21): a bare hash from one of those routes would just scroll the
// current (sectionless) page to nowhere, while `/#how` correctly navigates
// to the marketing page and scrolls there, from anywhere. "What's inside"
// is the one exception (2026-09-19) — it points at its own real page,
// `/whats-inside`, not an anchor; the home page keeps a short teaser
// under the same `#modules` id for anyone who lands there directly.
// Rendered via `next/link` rather than a plain `<a>` — eslint's
// `@next/next/no-html-link-for-pages` is right that a same-origin path
// belongs on `Link`, hash suffix or not; `Link` still performs a normal
// scroll-to-element after navigating, same as a plain anchor would.
//
// Collapsed from 5 flat top-level links into 3 (2026-09-20, Oscar's own
// audit): the old flat list mixed two different kinds of link with no
// visual distinction — 4 anchors back to this same home page plus one real
// separate page (`/whats-inside`) — which read as arbitrary from the
// visitor's side. "How it works" is now a hover/focus dropdown bundling
// every home-page anchor (itself, Sample report, Live dashboard); Pricing
// stays its own top-level link rather than folded into the dropdown too —
// it's the highest-intent link on the page, and burying it one extra click
// deep would cost more than the dropdown saves. "Sample report" now points
// into `/whats-inside#preview` rather than `/#preview` — `ReportPreview`
// itself moved off the home page onto that page in the same pass (see
// `app/(marketing)/whats-inside/page.tsx`'s own header comment).
// CSS-only dropdown (no client state needed): `.dropdown` is stretched to
// the nav's full height via `align-self: stretch`, so `.dropdownMenu`'s
// `top: 100%` lines up flush with the trigger's own hover/focus area —
// zero gap for the pointer to fall through while moving from the link down
// into the menu.
//
// The "Log in"/"Sign up" pair (PLAN_PHASE14.md §2 Step 2 /
// PLAN_PHASE16.md §8 Step 5.5) moved into `NavAuthArea` (2026-09-08) — a
// visitor who already has a session sees an account menu instead, rather
// than buttons for an action they've already taken. See that component's
// own header comment for why this couldn't just be decided here.
export function Nav() {
  return (
    <nav className={styles.nav}>
      <div className={`wrap ${styles.inner}`}>
        <div className={styles.brand}>
          <Image
            src="/pauly_logo.png"
            alt="Pauly & Co."
            width={LOGO_WIDTH}
            height={LOGO_HEIGHT}
            className={styles.logoImg}
            priority
          />
          <span className={styles.divider} aria-hidden="true" />
          VRM Monitor
        </div>
        <div className={styles.links}>
          <div className={styles.dropdown}>
            <Link href="/#how" className={styles.dropdownTrigger}>
              How it works
              <span className={styles.caret} aria-hidden="true">
                &#9662;
              </span>
            </Link>
            <div className={styles.dropdownMenu}>
              <Link href="/#how">Overview</Link>
              <Link href="/whats-inside#preview">Sample report</Link>
              <Link href="/#dashboard">Live dashboard</Link>
            </div>
          </div>
          <Link href="/whats-inside">What&apos;s inside</Link>
          <Link href="/#pricing">Pricing</Link>
          <NavAuthArea />
        </div>
      </div>
    </nav>
  );
}
