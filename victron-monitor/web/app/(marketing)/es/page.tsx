import type { Metadata } from 'next';
import {
  CapabilitiesTeaser,
  FlowSteps,
  Footer,
  Hero,
  IntegratorSection,
  Nav,
  Pricing,
  StatsBanner,
} from '@/components/marketing';
import { getFeaturedSelfServePlanIds } from '@/lib/server/db/signup';
import { getMarketingStats } from '@/lib/server/db/marketingStats';
import { SITE_URL } from '@/lib/site';
import { t } from '@/lib/i18n/strings';

const lang = 'es' as const;

// Spanish counterpart of app/(marketing)/page.tsx (2026-09-27 rollout) —
// its own literal route, not a cookie-switched render of the same URL, so
// this page keeps its own ISR cache entry independent of the English one
// (see the English page's own comment on why `revalidate` and cookie-based
// language don't mix). Content and structure otherwise mirror that file
// exactly; see it for the reasoning behind each section's presence/order.
export const metadata: Metadata = {
  title: { absolute: t(lang, 'marketing_home_title') },
  description: t(lang, 'marketing_home_description'),
  alternates: { canonical: '/es', languages: { 'en-US': '/', 'es-CR': '/es', 'x-default': '/' } },
  openGraph: {
    title: t(lang, 'marketing_home_title'),
    description: t(lang, 'marketing_home_description'),
    images: [{ url: '/sample_report.png', width: 1819, height: 2573, alt: 'A sample VRM Monitor weekly report' }],
  },
};

export const revalidate = 86400;

const SOFTWARE_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'VRM Monitor',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  url: `${SITE_URL}/es`,
  description:
    'Un panel en vivo y un reporte semanal en PDF narrado por IA para cualquier sistema solar o híbrido de Victron Energy, construido por Pauly & Co., un Integrador de Software Recomendado por Victron.',
  provider: {
    '@type': 'Organization',
    name: 'Pauly & Co.',
    url: 'https://paulyco.com',
  },
  offers: [
    { '@type': 'Offer', name: 'Starter', price: '29.99', priceCurrency: 'USD', description: 'Hasta 10 sitios, reportes semanales y de resumen automáticos.' },
    { '@type': 'Offer', name: 'Growth', price: '99.99', priceCurrency: 'USD', description: 'Hasta 50 sitios, agrega el panel en vivo y AI Insights.' },
  ],
};

export default async function MarketingPageEs() {
  const [featuredPlans, stats] = await Promise.all([getFeaturedSelfServePlanIds(), getMarketingStats()]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_JSON_LD) }}
      />
      <Nav lang={lang} altHref="/" />
      {stats && (
        <StatsBanner
          sitesMonitored={stats.sitesMonitored}
          installedKwp={stats.installedKwp}
          kwhTracked={stats.kwhTracked}
          lang={lang}
        />
      )}
      <Hero lang={lang} />
      <IntegratorSection lang={lang} />
      <FlowSteps lang={lang} />
      <CapabilitiesTeaser lang={lang} />
      <Pricing starterPlanId={featuredPlans.starter} growthPlanId={featuredPlans.growth} lang={lang} />
      <Footer lang={lang} />
    </>
  );
}
