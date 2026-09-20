import { SITE_URL } from '@/lib/site';

// /llms.txt (2026-09-19) — the emerging llmstxt.org convention: a plain,
// Markdown-formatted summary some AI crawlers/agents check for instead of
// (or before) parsing the full rendered page. Not a standardized ranking
// signal anywhere yet, but cheap to keep accurate, and it's the same
// underlying facts /whats-inside's own FAQPage JSON-LD states, just in
// the flatter shape this format wants (H1 + one-line blockquote summary +
// H2 sections of links, per the spec at https://llmstxt.org/). A route
// handler, not a static `public/llms.txt` file, so it always reflects
// the real `SITE_URL` (lib/site.ts) rather than a hard-coded domain that
// would silently go stale the next time that changes.
export async function GET() {
  const body = `# VRM Monitor

> A live dashboard and a weekly, AI-narrated PDF report for any Victron Energy solar or hybrid system — built by Pauly & Co., a Victron Recommended Software Integrator.

VRM Monitor reads data a Victron Cerbo GX is already generating and already sending to Victron's own VRM Portal — via CSV export or the VRM API — with no changes to an existing Node-RED flow and no re-flashing the Cerbo GX. It turns that data into two things: a live dashboard that refreshes every ~15 minutes, and a branded report delivered automatically by email every week (or every month, for a range past 31 days), with a short AI-written narrative instead of a wall of numbers. One homeowner watching a single system and an installer managing a hundred customer sites read the exact same numbers, computed the exact same way, just at different scale.

Pauly & Co. is a solar design and engineering firm based in Atenas, Costa Rica. It was accepted into Victron Energy's Recommended Software Integrator Program in September 2026 — Victron's own invite-only network of software experts it vets directly to build on the VRM API, Node-RED, and Venus OS.

## Product

- [Home](${SITE_URL}/): Overview, live-dashboard preview, sample report, and pricing (Starter, Growth, Fleet).
- [What's inside](${SITE_URL}/whats-inside): Every report section and live-dashboard signal in detail — health scoring (System and Grid, scored separately), the four AI Insights checks, and frequently asked questions, including what a Victron Recommended Software Integrator is.

## Company

- [Pauly & Co.](https://paulyco.com/): The solar design and engineering firm that builds and operates VRM Monitor.
- [Victron's Software Integrator Program announcement](https://www.victronenergy.com/blog/2024/12/04/introducing-our-new-software-integrator-program/): Victron Energy's own description of the program Pauly & Co. was accepted into.

## Legal

- [Terms of Service](${SITE_URL}/terms)
- [Privacy Policy](${SITE_URL}/privacy)
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}
