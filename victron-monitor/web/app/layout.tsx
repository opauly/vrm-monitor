import type { Metadata } from 'next';
import { fontVariables } from './fonts';
import { SITE_URL } from '@/lib/site';
import { PostHogProvider } from '@/components/analytics/PostHogProvider';
import '../styles/tokens.css';
import '../styles/base.css';

// `metadataBase` set 2026-09-19 — `SITE_URL` (lib/site.ts) resolved the
// "which domain" question weeks ago (`monitor.paulyco.com`, overridable
// via the `SITE_URL` env var for local dev); what's still pending is the
// DNS/Vercel-domain wiring to actually make that hostname serve this app
// instead of falling through to the main paulyco.com site (a known,
// separate, non-code gap — see the top-level README's own domain note if
// added, or ask Oscar). Setting this now regardless: it's what turns
// every page's relative `openGraph.images` path into a correct absolute
// URL, canonical links, etc. — all of which should already point at the
// real intended domain, not `localhost` or whatever origin happened to
// serve a given request, even while that domain's DNS catches up.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'VRM Monitor',
    template: '%s · VRM Monitor',
  },
  description:
    'VRM Monitor turns the Victron VRM export nobody opens into a branded, AI-narrated report your customers actually read — automatically, every week.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  // Font variable classNames go on <html> (not <body>) so every CSS Module
  // in the tree — including ones rendered inside <head>-adjacent contexts —
  // can resolve --font-big-shoulders / --font-plex-sans / --font-plex-mono.
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
