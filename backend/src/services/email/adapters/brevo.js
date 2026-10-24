/**
 * Sends through Brevo's HTTPS API (free tier: 300 emails/day).
 *
 * Why it exists: free hosts may block the SMTP ports Gmail needs. An HTTPS call on
 * port 443 is never blocked. The sender address must be verified in Brevo first.
 */
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

/** "BrightSmile Dental <clinic@gmail.com>" → { name, email } */
export function parseAddress(from) {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return match ? { name: match[1] || undefined, email: match[2] } : { email: from.trim() };
}

export function createBrevoAdapter({ apiKey, from, fetchImpl = fetch }) {
  const sender = parseAddress(from);

  return {
    name: 'brevo',
    async send({ to, subject, text, html }) {
      const res = await fetchImpl(BREVO_URL, {
        method: 'POST',
        headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Brevo responded ${res.status}: ${detail.slice(0, 200)}`);
      }
    },
  };
}
