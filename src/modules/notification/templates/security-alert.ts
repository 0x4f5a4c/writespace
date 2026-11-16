import { baseEmailLayout, escapeHtml } from "./layout";

export interface SecurityAlertEmailTemplateInput {
  recipientName: string;
  title: string;
  body: string;
}

export interface SecurityAlertEmailTemplateResult {
  subject: string;
  html: string;
  text: string;
}

export const SECURITY_ALERT_EMAIL_TEMPLATE_VERSION = "auth-security-alert-v1";

/**
 * Dedicated email for mandatory authentication and account-security alerts.
 *
 * Uses the shared Writespace layout while retaining a subtle coral security
 * indicator. Dynamic event content is escaped and never rendered as HTML.
 */
export function securityAlertEmailTemplate(
  input: SecurityAlertEmailTemplateInput,
): SecurityAlertEmailTemplateResult {
  const recipientName = input.recipientName.trim() || "there";
  const title = input.title.trim() || "Security alert";
  const body = input.body.trim();

  const safeRecipientName = escapeHtml(recipientName);
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body);

  // Prevent newline and control-character injection into the subject.
  const normalizedTitle = title
    .replace(/[\r\n\u0000-\u001F\u007F]+/g, " ")
    .slice(0, 120);

  const subject = `Writespace security alert: ${normalizedTitle}`.slice(0, 160);

  const content = `
    <p style="
      margin: 0 0 12px;
      color: #FF765E;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    ">
      Account security
    </p>

    <h1 style="
      margin: 0 0 18px;
      color: #191638;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 27px;
      line-height: 1.3;
      letter-spacing: -0.4px;
    ">
      ${safeTitle}
    </h1>

    <p style="margin: 0 0 20px; color: #4E4A61;">
      Hello ${safeRecipientName},
    </p>

    <div style="
      padding: 17px 19px;
      background-color: #F8F6F1;
      border-left: 3px solid #FF765E;
      border-radius: 4px;
      color: #4E4A61;
      font-size: 14px;
      line-height: 1.8;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    ">
      ${safeBody}
    </div>

    <p style="
      margin: 24px 0 0;
      color: #4E4A61;
      font-size: 14px;
      line-height: 1.8;
    ">
      If you don't recognize this activity, open Writespace directly,
      review your account security settings and check your active sessions.
      Do not share your password or authentication codes with anyone.
    </p>
  `.trim();

  const html = baseEmailLayout(content, "Writespace Account Security");

  const text = [
    "WRITESPACE — ACCOUNT SECURITY",
    "",
    `Hello ${recipientName},`,
    "",
    title,
    "",
    body,
    "",
    "If you don't recognize this activity, open Writespace directly, review your account security settings and check your active sessions.",
    "Do not share your password or authentication codes with anyone.",
    "",
    "Ideas Beyond the Scroll",
  ].join("\n");

  return {
    subject,
    html,
    text,
  };
}
