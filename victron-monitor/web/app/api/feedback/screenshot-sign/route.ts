// `POST /api/feedback/screenshot-sign` — the feedback-screenshot twin of
// `app/api/branding/logo-sign/route.ts` (PLAN_BETA_PROGRAM.md § Phase 7).
// Same reason to exist: the browser PUTs the screenshot bytes straight to
// Supabase Storage via a signed URL, so this route's own body is a tiny
// JSON request/response, never the file itself. Same caveat that route's
// own header comment states: the extension/size checks here are a cheap,
// honest-mistake pre-filter, not a real image-content validation — nothing
// in this feature ever decodes the bytes server-side the way
// `vrm_api/branding.py`'s Pillow check does for a logo, since a feedback
// screenshot is just displayed as-is to an admin, never re-rendered into
// anything else.
//
// `requireCustomerForRouteAllowPending()`, NOT `requireCustomerForRoute()`
// — a pending discounted tester stuck on `/app/billing` can still attach a
// screenshot to a bug report (§11 Q10's "open to every customer" extends
// to this attachment step too, not just the text fields).
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCustomerForRouteAllowPending } from '@/lib/server/auth';
import { getSupabaseAdmin } from '@/lib/server/supabase';
import { FEEDBACK_SCREENSHOT_ALLOWED_EXTENSIONS, FEEDBACK_SCREENSHOT_MAX_BYTES } from '@/lib/uploadLimits';

const BUCKET = 'vrm-monitor';

const bodySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});

export async function POST(request: Request) {
  const session = await requireCustomerForRouteAllowPending();
  if (session instanceof NextResponse) return session;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  if (parsed.data.sizeBytes > FEEDBACK_SCREENSHOT_MAX_BYTES) {
    return NextResponse.json({ error: 'file_too_large', maxBytes: FEEDBACK_SCREENSHOT_MAX_BYTES }, { status: 413 });
  }
  const lowerName = parsed.data.filename.toLowerCase();
  if (!FEEDBACK_SCREENSHOT_ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
    return NextResponse.json({ error: 'unsupported_file_type' }, { status: 400 });
  }

  const ext = lowerName.endsWith('.jpeg') || lowerName.endsWith('.jpg') ? 'jpg' : 'png';
  // `feedback/{customer_id}/{uuid}.<ext>` — exactly the prefix
  // `lib/server/db/feedback.ts:createFeedback()` requires a
  // `screenshot_path` to start with before it'll keep it. A fresh UUID per
  // upload, same as the logo route, so there's never a collision to worry
  // about — orphan cleanup for an abandoned upload is a non-goal here too,
  // the same accepted debt that route's own comment documents.
  const path = `feedback/${session.customerId}/${randomUUID()}.${ext}`;

  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ error: 'sign_failed' }, { status: 500 });
  }

  return NextResponse.json({ uploadUrl: data.signedUrl, path: data.path });
}
