'use server';

import 'server-only';

// Server Actions for `/admin/feedback` (PLAN_BETA_PROGRAM.md § Phase 8).
// `requireAdmin()` first in every one — same discipline every other
// `/admin/*` actions.ts file follows.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/auth';
import { setAppSetting, updateFeedback, type UpdateFeedbackFields } from '@/lib/server/db/admin';
import { createFeedbackScreenshotUrl } from '@/lib/server/storage';
import { t } from '@/lib/i18n/strings';

export type FeedbackRowActionState = { ok?: boolean; error?: string };

const updateSchema = z.object({
  status: z.enum(['new', 'triaged', 'in_progress', 'resolved', 'wont_fix', 'duplicate']).optional(),
  adminPriority: z.enum(['p1', 'p2', 'p3']).nullable().optional(),
  adminNotes: z.string().max(5000).nullable().optional(),
});

/** One action for every editable field on a row (status select, priority
 * select, notes textarea) — each call site below only ever passes the ONE
 * field it actually changed, so a status-select onChange never clobbers
 * notes someone else is mid-typing in the same expanded row. */
export async function updateFeedbackAction(id: string, fields: UpdateFeedbackFields): Promise<FeedbackRowActionState> {
  const admin = await requireAdmin();
  const parsed = updateSchema.safeParse({
    status: fields.status,
    adminPriority: fields.admin_priority,
    adminNotes: fields.admin_notes,
  });
  if (!parsed.success) {
    return { error: t(admin.uiLanguage, 'admin_feedback_err_check_fields') };
  }
  try {
    await updateFeedback(id, fields);
  } catch {
    return { error: t(admin.uiLanguage, 'admin_feedback_err_save_generic') };
  }
  revalidatePath('/admin/feedback');
  return { ok: true };
}

export type ScreenshotUrlState = { url?: string; error?: string };

export async function getFeedbackScreenshotUrlAction(screenshotPath: string): Promise<ScreenshotUrlState> {
  const admin = await requireAdmin();
  const url = await createFeedbackScreenshotUrl(screenshotPath);
  if (!url) {
    return { error: t(admin.uiLanguage, 'admin_feedback_err_screenshot_generic') };
  }
  return { url };
}

const notifyEmailSchema = z.object({ email: z.string().trim().email() });

export type SaveNotifyEmailState = { ok?: boolean; error?: string };

export async function saveFeedbackNotifyEmailAction(_prevState: SaveNotifyEmailState, formData: FormData): Promise<SaveNotifyEmailState> {
  const admin = await requireAdmin();
  const parsed = notifyEmailSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { error: t(admin.uiLanguage, 'admin_feedback_err_invalid_email') };
  }
  try {
    await setAppSetting('feedback_notify_email', parsed.data.email, admin.email);
  } catch {
    return { error: t(admin.uiLanguage, 'admin_feedback_err_save_generic') };
  }
  console.info(`admin.setting_changed key=feedback_notify_email by=${admin.email}`);
  revalidatePath('/admin/feedback');
  return { ok: true };
}
