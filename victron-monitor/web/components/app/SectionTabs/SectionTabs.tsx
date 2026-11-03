import { t, type Lang } from '@/lib/i18n/strings';
import { TabLinks, type SectionTab } from './TabLinks';

// Which pages are tabs of one menu item. The menu shows one entry per section; the section's pages show these tabs under the title.
export type Section = 'app-reports' | 'admin-reports' | 'admin-beta' | 'admin-usage';

function tabsFor(section: Section, lang: Lang): SectionTab[] {
  switch (section) {
    case 'app-reports':
      return [
        { href: '/app', label: t(lang, 'tab_reports'), exact: true },
        { href: '/app/upload', label: t(lang, 'tab_import_csv') },
        { href: '/app/branding', label: t(lang, 'nav_branding') },
      ];
    case 'admin-reports':
      return [
        { href: '/admin/reports', label: t(lang, 'tab_reports') },
        { href: '/admin/upload', label: t(lang, 'tab_import_csv') },
      ];
    case 'admin-beta':
      return [
        { href: '/admin/beta', label: t(lang, 'tab_beta_program') },
        { href: '/admin/feedback', label: t(lang, 'tab_feedback') },
      ];
    case 'admin-usage':
      return [
        { href: '/admin/activity', label: t(lang, 'tab_activity') },
        { href: '/admin/analytics', label: t(lang, 'tab_analytics') },
      ];
  }
}

export function SectionTabs({ section, lang }: { section: Section; lang: Lang }) {
  return <TabLinks tabs={tabsFor(section, lang)} />;
}
