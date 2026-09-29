import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer, Nav } from '@/components/marketing';
import { t } from '@/lib/i18n/strings';
import styles from '../../legal.module.css';

export const metadata: Metadata = {
  title: 'Términos de Servicio',
  description: t('es', 'marketing_terms_meta_description'),
  alternates: { languages: { 'en-US': '/terms', 'es-CR': '/es/terms', 'x-default': '/terms' } },
};

const lang = 'es' as const;

// Spanish counterpart of app/(marketing)/terms/page.tsx (2026-09-27
// rollout) — same "first draft, not lawyer-reviewed" content as the English
// original; see that file's own header comment.
export default function TermsPageEs() {
  return (
    <>
      <Nav lang={lang} toggle={{ kind: 'href', href: '/terms' }} />
      <div className="wrap">
        <div className={styles.page}>
          <header className={styles.header}>
            <h1>{t(lang, 'marketing_terms_h1')}</h1>
            <p className={styles.updated}>
              {t(lang, 'marketing_legal_updated_label')} {t(lang, 'marketing_terms_last_updated_date')}
            </p>
          </header>

          <div className={styles.draftNotice}>
            <p>
              <strong>{t(lang, 'marketing_terms_draft_label')}</strong> {t(lang, 'marketing_terms_draft_pre')}
              <a href="mailto:proyectos@paulyco.com">proyectos@paulyco.com</a>
              {t(lang, 'marketing_terms_draft_post')}
            </p>
          </div>

          <div className={styles.body}>
            <h2>{t(lang, 'marketing_terms_s1_title')}</h2>
            <p>{t(lang, 'marketing_terms_s1_body')}</p>

            <h2>{t(lang, 'marketing_terms_s2_title')}</h2>
            <p>{t(lang, 'marketing_terms_s2_body')}</p>

            <h2>{t(lang, 'marketing_terms_s3_title')}</h2>
            <p>
              {t(lang, 'marketing_terms_s3_p1_pre')}
              <a href="mailto:proyectos@paulyco.com">proyectos@paulyco.com</a>
              {t(lang, 'marketing_terms_s3_p1_post')}
            </p>
            <p>{t(lang, 'marketing_terms_s3_p2')}</p>

            <h2>{t(lang, 'marketing_terms_s4_title')}</h2>
            <p>{t(lang, 'marketing_terms_s4_p1')}</p>
            <p>
              {t(lang, 'marketing_terms_s4_p2_pre')}
              <strong>{t(lang, 'marketing_terms_s4_p2_onvo')}</strong>
              {t(lang, 'marketing_terms_s4_p2_mid')}
              <a href="https://onvopay.com/policies" target="_blank" rel="noopener noreferrer">
                {t(lang, 'marketing_terms_s4_p2_linktext')}
              </a>{' '}
              {t(lang, 'marketing_terms_s4_p2_post')}
            </p>
            <p>{t(lang, 'marketing_terms_s4_p3')}</p>

            <h2>{t(lang, 'marketing_terms_s5_title')}</h2>
            <p>{t(lang, 'marketing_terms_s5_body')}</p>

            <h2>{t(lang, 'marketing_terms_s6_title')}</h2>
            <p>{t(lang, 'marketing_terms_s6_intro')}</p>
            <ul>
              <li>{t(lang, 'marketing_terms_s6_li1')}</li>
              <li>{t(lang, 'marketing_terms_s6_li2')}</li>
              <li>{t(lang, 'marketing_terms_s6_li3')}</li>
              <li>{t(lang, 'marketing_terms_s6_li4')}</li>
            </ul>
            <p>{t(lang, 'marketing_terms_s6_footer')}</p>

            <h2>{t(lang, 'marketing_terms_s7_title')}</h2>
            <p>
              {t(lang, 'marketing_terms_s7_pre')}
              <Link href="/es/privacy">{t(lang, 'marketing_terms_s7_linktext')}</Link>
              {t(lang, 'marketing_terms_s7_post')}
            </p>

            <h2>{t(lang, 'marketing_terms_s8_title')}</h2>
            <p>{t(lang, 'marketing_terms_s8_body')}</p>

            <h2>{t(lang, 'marketing_terms_s9_title')}</h2>
            <p>{t(lang, 'marketing_terms_s9_body')}</p>

            <h2>{t(lang, 'marketing_terms_s10_title')}</h2>
            <p>{t(lang, 'marketing_terms_s10_body')}</p>

            <h2>{t(lang, 'marketing_terms_s11_title')}</h2>
            <p>{t(lang, 'marketing_terms_s11_body')}</p>

            <h2>{t(lang, 'marketing_terms_s12_title')}</h2>
            <p>{t(lang, 'marketing_terms_s12_body')}</p>

            <h2>{t(lang, 'marketing_terms_s13_title')}</h2>
            <p>
              {t(lang, 'marketing_terms_s13_pre')}
              <a href="mailto:proyectos@paulyco.com">proyectos@paulyco.com</a>
              {t(lang, 'marketing_terms_s13_post')}
            </p>
          </div>

          <Link href="/es" className={styles.backLink}>
            {t(lang, 'marketing_legal_back')}
          </Link>
        </div>
      </div>
      <Footer lang={lang} />
    </>
  );
}
