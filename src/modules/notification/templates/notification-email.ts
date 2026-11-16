import { baseEmailLayout, escapeHtml } from "./layout";

export interface NotificationEmailTemplateInput {
  recipientName: string;
  title: string;
  body: string;
}

export interface NotificationEmailTemplateResult {
  subject: string;
  html: string;
  text: string;
}

export const NOTIFICATION_EMAIL_TEMPLATE_VERSION = "notification-email-v1";

/**
 * Build a generic notification email from a persisted inbox notification.
 *
 * The template deliberately avoids rendering arbitrary presentationData
 * as HTML. Dynamic values are escaped, while the shared layout handles
 * Writespace branding and presentation.
 */
export function notificationEmailTemplate(
  input: NotificationEmailTemplateInput,
): NotificationEmailTemplateResult {
  const recipientName = input.recipientName.trim() || "there";
  const title = input.title.trim() || "You have a new notification";
  const body = input.body.trim();

  // Remove line breaks and control characters to prevent subject injection.
  const subject = title
    .replace(/[\r\n\u0000-\u001F\u007F]+/g, " ")
    .slice(0, 160);

  const safeRecipientName = escapeHtml(recipientName);
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body);

  const content = `
    <p style="
      margin: 0 0 24px;
      color: #4E4A61;
      font-size: 14px;
      line-height: 1.7;
    ">
      Hello ${safeRecipientName},
    </p>

    <h1 style="
      margin: 0 0 18px;
      color: #191638;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 25px;
      font-weight: 700;
      line-height: 1.35;
      letter-spacing: -0.4px;
    ">
      ${safeTitle}
    </h1>

    <div style="
      color: #4E4A61;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 15px;
      line-height: 1.8;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    ">
      ${safeBody}
    </div>

    <hr style="
      margin: 30px 0 22px;
      height: 0;
      border: 0;
      border-top: 1px solid #EAE6E0;
    ">

    <p style="
      margin: 0;
      color: #928C86;
      font-size: 12px;
      line-height: 1.7;
    ">
      You received this email because of activity associated with your
      Writespace account.
    </p>
  `.trim();

  const html = baseEmailLayout(content, title);

  const text = [
    `Hello ${recipientName},`,
    "",
    title,
    "",
    body,
    "",
    "Ideas Beyond the Scroll.",
    "",
    "You received this email because of activity associated with your Writespace account.",
  ].join("\n");

  return {
    subject,
    html,
    text,
  };
}
