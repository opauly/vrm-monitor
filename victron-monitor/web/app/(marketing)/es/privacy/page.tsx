import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer, Nav } from '@/components/marketing';
import { t } from '@/lib/i18n/strings';
import styles from '../../legal.module.css';

export const metadata: Metadata = {
  title: 'Política de Privacidad',
  description: t('es', 'marketing_privacy_meta_description'),
  alternates: { languages: { 'en-US': '/privacy', 'es-CR': '/es/privacy', 'x-default': '/privacy' } },
};

const lang = 'es' as const;

// Spanish counterpart of app/(marketing)/privacy/page.tsx (2026-09-27
// rollout) — same "first draft, not lawyer-reviewed" content as the English
// original; see that file's own header comment.
export default function PrivacyPageEs() {
  return (
    <>
      <Nav lang={lang} altHref="/privacy" />
      <div className="wrap">
        <div className={styles.page}>
          <header className={styles.header}>
            <h1>{t(lang, 'marketing_privacy_h1')}</h1>
            <p className={styles.updated}>
              {t(lang, 'marketing_legal_updated_label')} {t(lang, 'marketing_privacy_last_updated_date')}
            </p>
          </header>

          <div className={styles.draftNotice}>
            <p>
              <strong>{t(lang, 'marketing_privacy_draft_label')}</strong> {t(lang, 'marketing_privacy_draft_pre')}
              <a href="mailto:proyectos@paulyco.com">proyectos@paulyco.com</a>
              {t(lang, 'marketing_privacy_draft_post')}
            </p>
          </div>

          <div className={styles.body}>
            <h2>{t(lang, 'marketing_privacy_s1_title')}</h2>
            <p>{t(lang, 'marketing_privacy_s1_body')}</p>

            <h2>{t(lang, 'marketing_privacy_s2_title')}</h2>
            <p>
              <strong>{t(lang, 'marketing_privacy_s2_p1_label')}</strong>
              {t(lang, 'marketing_privacy_s2_p1_body')}
            </p>
            <p>
              <strong>{t(lang, 'marketing_privacy_s2_p2_label')}</strong>
              {t(lang, 'marketing_privacy_s2_p2_body')}
            </p>
            <p>
              <strong>{t(lang, 'marketing_privacy_s2_p3_label')}</strong>
              {t(lang, 'marketing_privacy_s2_p3_body')}
            </p>
            <p>
              <strong>{t(lang, 'marketing_privacy_s2_p4_label')}</strong>
              {t(lang, 'marketing_privacy_s2_p4_body')}
            </p>

            <h2>{t(lang, 'marketing_privacy_s3_title')}</h2>
            <ul>
              <li>{t(lang, 'marketing_privacy_s3_li1')}</li>
              <li>{t(lang, 'marketing_privacy_s3_li2')}</li>
              <li>{t(lang, 'marketing_privacy_s3_li3')}</li>
              <li>{t(lang, 'marketing_privacy_s3_li4')}</li>
            </ul>
            <p>{t(lang, 'marketing_privacy_s3_footer')}</p>

            <h2>{t(lang, 'marketing_privacy_s4_title')}</h2>
            <p>{t(lang, 'marketing_privacy_s4_intro')}</p>
            <ul>
              <li>
                <strong>{t(lang, 'marketing_privacy_s4_onvo_label')}</strong>
                {t(lang, 'marketing_privacy_s4_onvo_body')}
                <a href="https://onvopay.com/policies" target="_blank" rel="noopener noreferrer">
                  {t(lang, 'marketing_privacy_s4_onvo_linktext')}
                </a>
                .
              </li>
              <li>
                <strong>{t(lang, 'marketing_privacy_s4_resend_label')}</strong>
                {t(lang, 'marketing_privacy_s4_resend_body')}
              </li>
              <li>
                <strong>{t(lang, 'marketing_privacy_s4_supabase_label')}</strong>
                {t(lang, 'marketing_privacy_s4_supabase_body')}
              </li>
              <li>
                <strong>{t(lang, 'marketing_privacy_s4_anthropic_label')}</strong>
                {t(lang, 'marketing_privacy_s4_anthropic_body')}
              </li>
              <li>
                <strong>{t(lang, 'marketing_privacy_s4_victron_label')}</strong>
                {t(lang, 'marketing_privacy_s4_victron_body')}
              </li>
            </ul>
            <p>{t(lang, 'marketing_privacy_s4_footer')}</p>

            <h2>{t(lang, 'marketing_privacy_s5_title')}</h2>
            <p>{t(lang, 'marketing_privacy_s5_body')}</p>

            <h2>{t(lang, 'marketing_privacy_s6_title')}</h2>
            <p>
              {t(lang, 'marketing_privacy_s6_pre')}
              <a href="mailto:proyectos@paulyco.com">proyectos@paulyco.com</a>
              {t(lang, 'marketing_privacy_s6_post')}
            </p>

            <h2>{t(lang, 'marketing_privacy_s7_title')}</h2>
            <p>{t(lang, 'marketing_privacy_s7_body')}</p>

            <h2>{t(lang, 'marketing_privacy_s8_title')}</h2>
            <p>{t(lang, 'marketing_privacy_s8_body')}</p>

            <h2>{t(lang, 'marketing_privacy_s9_title')}</h2>
            <p>{t(lang, 'marketing_privacy_s9_body')}</p>

            <h2>{t(lang, 'marketing_privacy_s10_title')}</h2>
            <p>{t(lang, 'marketing_privacy_s10_body')}</p>

            <h2>{t(lang, 'marketing_privacy_s11_title')}</h2>
            <p>
              {t(lang, 'marketing_privacy_s11_pre')}
              <a href="mailto:proyectos@paulyco.com">proyectos@paulyco.com</a>
              {t(lang, 'marketing_privacy_s11_post')}
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
