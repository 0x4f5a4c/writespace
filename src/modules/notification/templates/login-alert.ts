import {
  baseEmailLayout,
  emailButton,
  escapeHtml,
  safeEmailUrl,
} from "./layout";

export const loginAlertTemplate = (data: {
  username: string;
  time: string;
  ip: string;
  secureAccountLink: string;
}) => {
  const username = escapeHtml(data.username.trim() || "there");
  const time = escapeHtml(data.time);
  const ip = escapeHtml(data.ip);
  const secureAccountLink = safeEmailUrl(data.secureAccountLink);

  const htmlContent = `
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
    ">
      A new login was detected.
    </h1>

    <p style="margin: 0 0 20px; color: #4E4A61;">
      Hi ${username}, we noticed a recent login to your Writespace account.
      Here are the available details:
    </p>

    <table
      role="presentation"
      width="100%"
      cellpadding="0"
      cellspacing="0"
      border="0"
      bgcolor="#F8F6F1"
      style="
        width: 100%;
        background-color: #F8F6F1;
        border: 1px solid #EAE6E0;
        border-radius: 7px;
      "
    >
      <tr>
        <td style="padding: 14px 17px; border-bottom: 1px solid #EAE6E0;">
          <p style="
            margin: 0 0 4px;
            color: #928C86;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
          ">
            Time
          </p>
          <p style="margin: 0; color: #191638; font-size: 14px;">
            ${time}
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding: 14px 17px;">
          <p style="
            margin: 0 0 4px;
            color: #928C86;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
          ">
            IP address
          </p>
          <p style="margin: 0; color: #191638; font-size: 14px;">
            ${ip}
          </p>
        </td>
      </tr>
    </table>

    <p style="margin: 22px 0 0; color: #4E4A61;">
      If this was you, no further action is needed. If you don't recognize
      this activity, review your account security and active sessions.
    </p>

    ${emailButton(secureAccountLink, "Review Account Security")}
  `;

  const textContent = [
    "A new login was detected.",
    "",
    `Hi ${data.username.trim() || "there"},`,
    "",
    "We noticed a recent login to your Writespace account:",
    `Time: ${data.time}`,
    `IP Address: ${data.ip}`,
    "",
    "If this was you, no further action is needed.",
    "If you don't recognize this activity, review your account security and active sessions:",
    secureAccountLink,
    "",
    "Ideas Beyond the Scroll",
  ].join("\n");

  return {
    html: baseEmailLayout(htmlContent, "New Login Alert - Writespace"),
    text: textContent,
  };
};
