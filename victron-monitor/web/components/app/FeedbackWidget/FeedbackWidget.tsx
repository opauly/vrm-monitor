'use client';

// The feedback widget (PLAN_BETA_PROGRAM.md § Phase 6) — a header button
// (rendered by AppShell.tsx for every customer, never for admin) that
// opens a small modal. This app has no shared modal primitive yet
// (`app/(portal)/app/billing/CancelDialog.tsx`'s own comment: its
// confirm box is inline-in-page-flow, not a floating overlay) — this is
// the first real floating overlay, built locally rather than as a new
// shared primitive nothing else needs yet.
//
// Calls `submitFeedbackAction` directly (a Server Action, imported via the
// `@/app/...` alias — same cross-boundary shape `components/marketing/
// DashboardPreview.tsx` already uses for a Server Component; this is the
// first case of a CLIENT component doing it, which works the same way
// Next.js Server Actions always do regardless of where the calling
// component lives).
import { useActionState, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { usePathname } from 'next/navigation';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { t, type Lang } from '@/lib/i18n/strings';
import { uploadFileToSignedUrl } from '@/lib/uploadClient';
import { FEEDBACK_SCREENSHOT_ALLOWED_EXTENSIONS, FEEDBACK_SCREENSHOT_MAX_BYTES } from '@/lib/uploadLimits';
import { submitFeedbackAction, type SubmitFeedbackState } from '@/app/(portal)/app/feedback/actions';
import styles from './FeedbackWidget.module.css';

export type FeedbackWidgetSite = { site_id: string; display_name: string };

export type FeedbackWidgetProps = {
  lang: Lang;
  /** The customer's own sites, server-fetched by `app/(portal)/app/
   * layout.tsx` (PLAN_BETA_PROGRAM.md § Phase 6: "the options list is
   * passed from the layout") — never refetched here. Empty for a
   * brand-new customer with no sites yet; the site field is simply
   * omitted in that case. */
  sites: FeedbackWidgetSite[];
};

type Kind = 'bug' | 'suggestion';

/** `/app/dashboard/abc-123` -> `'abc-123'` — the one dynamic route this
 * widget bothers to parse, per the plan's own wording ("pre-filled from
 * /app/dashboard/[site_id] via usePathname()"). `null` everywhere else,
 * which just leaves the site select on its own default (no site). */
function siteIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/app\/dashboard\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function FeedbackWidget({ lang, sites }: FeedbackWidgetProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>('bug');
  const [state, formAction, pending] = useActionState<SubmitFeedbackState, FormData>(submitFeedbackAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  // Phase 7 (optional, droppable per §8 Q4) — same "sign, then upload,
  // then pass the resulting path on submit" shape
  // `app/(portal)/app/branding/BrandingForm.tsx:handleFileChange()`
  // already establishes; only the endpoint/limits differ.
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null);
  const [screenshotName, setScreenshotName] = useState<string | null>(null);
  const [screenshotUploading, setScreenshotUploading] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);

  // `useActionState`'s own `state` has no reset short of dispatching the
  // action again — it would otherwise stay `{success: true}` forever after
  // the FIRST submission, permanently stuck on the success screen with no
  // form left to resubmit through on a later open. `showSuccess` is the
  // actual render decision, decoupled from `state` and cleared by
  // `close()`; `seenSuccess` is a one-shot edge detector so a stale
  // `state.success` (still true from the last submission, unrelated to
  // this NEW open) doesn't immediately flip `showSuccess` back on when the
  // widget reopens.
  //
  // The edge check runs directly in the render body (the same "adjust
  // state during render" idiom `BillingManager.tsx`'s own `trackedFirstRun`
  // uses), not inside a `useEffect` — a bare `setState` call in an effect
  // body is exactly what the newer `react-hooks/set-state-in-effect` rule
  // flags. `formRef.current?.reset()` below stays in a real `useEffect`
  // instead, since resetting an actual DOM node is the kind of "update an
  // external system" work effects are for.
  const [showSuccess, setShowSuccess] = useState(false);
  const [seenSuccess, setSeenSuccess] = useState(false);
  if (state.success && !seenSuccess) {
    setSeenSuccess(true);
    setShowSuccess(true);
    setScreenshotPath(null);
    setScreenshotName(null);
    setScreenshotError(null);
  }

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  function close() {
    setOpen(false);
    setKind('bug');
    setScreenshotPath(null);
    setScreenshotName(null);
    setScreenshotError(null);
    setShowSuccess(false);
    setSeenSuccess(false);
  }

  async function handleScreenshotChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setScreenshotError(null);
    setScreenshotPath(null);

    if (file.size > FEEDBACK_SCREENSHOT_MAX_BYTES) {
      setScreenshotError(t(lang, 'feedback_screenshot_too_large'));
      e.target.value = '';
      return;
    }
    const lowerName = file.name.toLowerCase();
    if (!FEEDBACK_SCREENSHOT_ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
      setScreenshotError(t(lang, 'feedback_screenshot_unsupported_type'));
      e.target.value = '';
      return;
    }

    setScreenshotName(file.name);
    setScreenshotUploading(true);
    try {
      const signRes = await fetch('/api/feedback/screenshot-sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, sizeBytes: file.size }),
      });
      if (!signRes.ok) {
        setScreenshotError(t(lang, 'feedback_screenshot_upload_error'));
        setScreenshotName(null);
        return;
      }
      const { uploadUrl, path } = (await signRes.json()) as { uploadUrl: string; path: string };
      await uploadFileToSignedUrl(uploadUrl, file);
      setScreenshotPath(path);
    } catch {
      setScreenshotError(t(lang, 'feedback_screenshot_upload_error'));
      setScreenshotName(null);
    } finally {
      setScreenshotUploading(false);
    }
  }

  function removeScreenshot() {
    setScreenshotPath(null);
    setScreenshotName(null);
    setScreenshotError(null);
  }

  const currentSiteId = siteIdFromPathname(pathname);

  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)}>
        {t(lang, 'feedback_button')}
      </button>

      {open && (
        <div className={styles.overlay} role="presentation" onClick={close}>
          <div
            className={styles.panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-widget-title"
            onClick={(e) => e.stopPropagation()}
          >
            {showSuccess ? (
              <>
                <h2 id="feedback-widget-title">{t(lang, 'feedback_success_title')}</h2>
                <p>{t(lang, 'feedback_success_body')}</p>
                <div className={styles.formActions}>
                  <Button type="button" onClick={close}>
                    {t(lang, 'feedback_close_button')}
                  </Button>
                </div>
              </>
            ) : (
              <form ref={formRef} action={formAction} className={styles.form}>
                <h2 id="feedback-widget-title">{t(lang, 'feedback_widget_title')}</h2>

                <input type="hidden" name="pagePath" value={pathname} />
                <input type="hidden" name="screenshotPath" value={screenshotPath ?? ''} />

                <Field label={t(lang, 'feedback_field_kind')} htmlFor="fb-kind">
                  <Select id="fb-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)} disabled={pending}>
                    <option value="bug">{t(lang, 'feedback_kind_bug')}</option>
                    <option value="suggestion">{t(lang, 'feedback_kind_suggestion')}</option>
                  </Select>
                </Field>

                {kind === 'bug' && (
                  <Field label={t(lang, 'feedback_field_severity')} htmlFor="fb-severity">
                    <Select id="fb-severity" name="severity" defaultValue="medium" disabled={pending}>
                      <option value="low">{t(lang, 'feedback_severity_low')}</option>
                      <option value="medium">{t(lang, 'feedback_severity_medium')}</option>
                      <option value="high">{t(lang, 'feedback_severity_high')}</option>
                      <option value="blocker">{t(lang, 'feedback_severity_blocker')}</option>
                    </Select>
                  </Field>
                )}

                <Field label={t(lang, 'feedback_field_title')} htmlFor="fb-title" required>
                  <Input id="fb-title" name="title" required maxLength={200} disabled={pending} />
                </Field>

                <Field label={t(lang, 'feedback_field_body')} htmlFor="fb-body" required>
                  <Textarea id="fb-body" name="body" rows={5} required maxLength={5000} disabled={pending} />
                </Field>

                {sites.length > 0 && (
                  <Field
                    label={t(lang, 'feedback_field_site')}
                    htmlFor="fb-site"
                    optional
                    optionalLabel={t(lang, 'feedback_site_optional')}
                  >
                    <Select id="fb-site" name="siteId" defaultValue={currentSiteId ?? ''} disabled={pending}>
                      <option value="">{t(lang, 'feedback_site_none')}</option>
                      {sites.map((s) => (
                        <option key={s.site_id} value={s.site_id}>
                          {s.display_name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}

                <Field label={t(lang, 'feedback_field_screenshot')} htmlFor="fb-screenshot" optional optionalLabel={t(lang, 'feedback_site_optional')}>
                  <input
                    id="fb-screenshot"
                    type="file"
                    accept={FEEDBACK_SCREENSHOT_ALLOWED_EXTENSIONS.join(',')}
                    onChange={handleScreenshotChange}
                    disabled={pending || screenshotUploading}
                  />
                </Field>
                {screenshotUploading && <p className={styles.status}>{t(lang, 'feedback_screenshot_uploading')}</p>}
                {screenshotError && <p className={styles.error}>{screenshotError}</p>}
                {screenshotPath && screenshotName && !screenshotUploading && (
                  <p className={styles.status}>
                    {t(lang, 'feedback_screenshot_attached').replace('{name}', screenshotName)}{' '}
                    <button type="button" className={styles.linkButton} onClick={removeScreenshot} disabled={pending}>
                      {t(lang, 'feedback_screenshot_remove_button')}
                    </button>
                  </p>
                )}

                {state.error && <p className={styles.error}>{state.error}</p>}

                <div className={styles.formActions}>
                  <Button type="submit" disabled={pending || screenshotUploading}>
                    {pending ? t(lang, 'feedback_submitting') : t(lang, 'feedback_submit_button')}
                  </Button>
                  <Button type="button" variant="ghost" onClick={close} disabled={pending}>
                    {t(lang, 'feedback_cancel_button')}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
