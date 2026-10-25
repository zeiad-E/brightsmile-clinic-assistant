import nodemailer from 'nodemailer';

/**
 * Sends through an SMTP server — for us, the clinic's Gmail with an App Password
 * (Google account → Security → App passwords). Port 465 = encrypted from the start.
 *
 * Short timeouts: if a host blocks SMTP ports, we want a clear failure in seconds
 * (marked "failed" in notifications), not a connection hanging for minutes.
 */
export function createSmtpAdapter({ host, port, user, pass, from }) {
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return {
    name: 'smtp',
    async send({ to, subject, text, html }) {
      await transport.sendMail({ from, to, subject, text, html });
    },
  };
}
