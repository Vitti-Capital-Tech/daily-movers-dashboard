import "server-only";

/**
 * Sends one email through Resend's HTTP API.
 *
 * A plain `fetch` rather than the `resend` SDK: this app sends one message a
 * day, and the API is a single POST.
 * https://resend.com/docs/api-reference/emails/send-email
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type EmailAttachment = {
  filename: string;
  content: Uint8Array;
};

export type OutgoingEmail = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
};

/** Returns Resend's message id. Throws with Resend's own message on failure. */
export async function sendEmail(email: OutgoingEmail): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not set.");

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: email.from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: email.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: Buffer.from(attachment.content).toString("base64"),
      })),
    }),
    cache: "no-store",
  });

  const body = (await response.json().catch(() => null)) as {
    id?: string;
    message?: string;
    name?: string;
  } | null;

  if (!response.ok || !body?.id) {
    throw new Error(
      `Resend answered ${response.status}: ${body?.message ?? body?.name ?? "no detail"}`,
    );
  }

  return body.id;
}
