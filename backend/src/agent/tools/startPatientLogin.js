import { sendMagicLink } from '../../services/patients.js';

/**
 * Passwordless login: send a magic-link / OTP to the patient's contact.
 * The agent NEVER authenticates on trust alone — verification happens via this link.
 */
export async function startPatientLogin({ contact }) {
  await sendMagicLink(contact);
  return {
    sent: true,
    message: 'A secure one-time login link has been sent to your contact. Open it to sign in.',
  };
}
