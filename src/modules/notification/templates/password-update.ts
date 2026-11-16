import {
  baseEmailLayout,
  emailButton,
  escapeHtml,
  safeEmailUrl,
} from "./layout";

export const passwordUpdateTemplate = (data: {
  username: string;
  contactSupportLink: string;
}) => {
  const username = escapeHtml(data.username.trim() || "there");
  const supportLink = safeEmailUrl(data.contactSupportLink);

  const htmlContent = `
    <p style="
      margin: 0 0 12px;
      color: #897AF0;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    ">
      Account update
    </p>

    <h1 style="
      margin: 0 0 18px;
      color: #191638;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 27px;
      line-height: 1.3;
    ">
      Your password was updated.
    </h1>

    <p style="margin: 0 0 16px; color: #4E4A61;">
      Hi ${username},
    </p>

    <p style="margin: 0; color: #4E4A61;">
      The password for your Writespace account was successfully changed.
    </p>

    <div style="
      margin-top: 24px;
      padding: 16px 18px;
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
        If you didn't make this change, contact support immediately
        to secure your account.
      </p>
    </div>

    ${emailButton(supportLink, "Contact Support")}
  `;

  const textContent = [
    "Your password was updated.",
    "",
    `Hi ${data.username.trim() || "there"},`,
    "",
    "The password for your Writespace account was successfully changed.",
    "",
    "If you didn't make this change, contact support immediately to secure your account:",
    supportLink,
    "",
    "Ideas Beyond the Scroll",
  ].join("\n");

  return {
    html: baseEmailLayout(htmlContent, "Password Updated - Writespace"),
    text: textContent,
  };
};
