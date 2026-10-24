import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { supabaseAdmin } from '../../db/supabase.js';
import * as notificationModel from '../../models/notificationModel.js';
import { renderEmail } from './templates.js';
import { createLogAdapter } from './adapters/log.js';
import { createSmtpAdapter } from './adapters/smtp.js';
import { createBrevoAdapter } from './adapters/brevo.js';

/**
 * One way to send email, whatever the provider. Switching from Gmail to Brevo is a
 * single env var (EMAIL_PROVIDER) — no code changes. That swappable piece is an
 * "adapter", like a travel plug: same device, different socket.
 *
 * Every email is logged in the notifications table (queued → sent | failed), so staff
 * can see what was sent and what failed.
 */

// Phone-only patients get an internal login address that must never receive mail.
export const PLACEHOLDER_EMAIL_DOMAIN = 'patients.brightsmile.app';
export const isPlaceholderEmail = (address) => String(address).toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);

function createAdapter() {
  const { provider, from, smtp, brevoApiKey } = config.email;
  if (provider === 'smtp') return createSmtpAdapter({ ...smtp, from });
  if (provider === 'brevo') return createBrevoAdapter({ apiKey: brevoApiKey, from });
  return createLogAdapter({ showBody: config.nodeEnv !== 'production' });
}

let adapter = null;
const getAdapter = () => (adapter ??= createAdapter());

/** Tests swap in a fake adapter. */
export function setEmailAdapter(fake) {
  adapter = fake;
}

/**
 * Renders and sends one email, and records it. Resolves to { sent: boolean } and never
 * throws, because an email problem must not undo a booking that already happened.
 */
export async function sendEmail({ template, to, language = 'en', data, patientId = null, appointmentId = null }) {
  if (!to || isPlaceholderEmail(to)) return { sent: false, skipped: true };

  let notificationId = null;
  try {
    if (supabaseAdmin) {
      ({ id: notificationId } = await notificationModel.createQueued(supabaseAdmin, {
        patientId,
        appointmentId,
        template,
        toAddress: to,
      }));
    }
    const message = renderEmail(template, language, data);
    await getAdapter().send({ to, ...message });
    if (notificationId) await notificationModel.markSent(supabaseAdmin, notificationId);
    return { sent: true };
  } catch (err) {
    logger.warn(`Email "${template}" failed: ${err.message}`);
    if (notificationId) await notificationModel.markFailed(supabaseAdmin, notificationId, err.message).catch(() => {});
    return { sent: false };
  }
}

/** Fire-and-forget: the HTTP response doesn't wait for the email to go out. */
export function sendEmailInBackground(args) {
  sendEmail(args).catch((err) => logger.warn(`Background email failed: ${err.message}`));
}
