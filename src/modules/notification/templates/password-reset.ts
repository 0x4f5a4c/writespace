import {
  baseEmailLayout,
  emailButton,
  escapeHtml,
  safeEmailUrl,
} from "./layout";

export const passwordResetTemplate = (data: {
  username: string;
  resetLink: string;
}) => {
  const username = escapeHtml(data.username.trim() || "there");
  const resetLink = safeEmailUrl(data.resetLink);
  const safeResetLink = escapeHtml(resetLink);

  const htmlContent = `
    <p style="
      margin: 0 0 12px;
      color: #897AF0;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    ">
      Account access
    </p>

    <h1 style="
      margin: 0 0 18px;
      color: #191638;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 27px;
      line-height: 1.3;
    ">
      Reset your password.
    </h1>

    <p style="margin: 0 0 16px; color: #4E4A61;">
      Hi ${username},
    </p>

    <p style="margin: 0; color: #4E4A61;">
      We received a request to reset the password for your Writespace account.
      Use the button below to continue if you made this request.
    </p>

    ${emailButton(resetLink, "Reset Password")}

    <p style="
      margin: 26px 0 8px;
      color: #928C86;
      font-size: 12px;
      line-height: 1.7;
    ">
      Having trouble with the button? Copy this link into your browser:
    </p>

    <p style="
      margin: 0;
      overflow-wrap: anywhere;
      font-size: 12px;
      line-height: 1.7;
    ">
      <a href="${safeResetLink}" style="color: #FF765E;">
        ${safeResetLink}
      </a>
    </p>

    <div style="
      margin-top: 26px;
      padding: 15px 17px;
      background-color: #F8F6F1;
      border-left: 3px solid #FF765E;
      border-radius: 4px;
    ">
      <p style="
        margin: 0;
        color: #4E4A61;
        font-size: 13px;
        line-height: 1.7;
      ">
        If you didn't request a password reset, you can safely ignore
        this email.
      </p>
    </div>
  `;

  const textContent = [
    "Reset your password.",
    "",
    `Hi ${data.username.trim() || "there"},`,
    "",
    "We received a request to reset the password for your Writespace account.",
    "Use the link below to continue if you made this request:",
    "",
    resetLink,
    "",
    "If you didn't request a password reset, you can safely ignore this email.",
    "",
    "Ideas Beyond the Scroll",
  ].join("\n");

  return {
    html: baseEmailLayout(htmlContent, "Reset Your Password - Writespace"),
    text: textContent,
  };
};
