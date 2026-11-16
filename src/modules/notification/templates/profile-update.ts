import {
  baseEmailLayout,
  emailButton,
  escapeHtml,
  safeEmailUrl,
} from "./layout";

export const profileUpdateTemplate = (data: {
  username: string;
  profileLink: string;
}) => {
  const username = escapeHtml(data.username.trim() || "there");
  const profileLink = safeEmailUrl(data.profileLink);

  const htmlContent = `
    <p style="
      margin: 0 0 12px;
      color: #897AF0;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    ">
      Profile update
    </p>

    <h1 style="
      margin: 0 0 18px;
      color: #191638;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 27px;
      line-height: 1.3;
    ">
      Your profile was updated.
    </h1>

    <p style="margin: 0 0 16px; color: #4E4A61;">
      Hi ${username},
    </p>

    <p style="margin: 0; color: #4E4A61;">
      This is a quick confirmation that the core identity information
      on your Writespace profile has been updated.
    </p>

    ${emailButton(profileLink, "View Your Profile")}

    <p style="
      margin: 24px 0 0;
      color: #928C86;
      font-size: 13px;
    ">
      Didn't make this change? Review your account details.
    </p>
  `;

  const textContent = [
    "Your profile was updated.",
    "",
    `Hi ${data.username.trim() || "there"},`,
    "",
    "This is a quick confirmation that the core identity information on your Writespace profile has been updated.",
    "",
    `View Your Profile: ${profileLink}`,
    "",
    "Didn't make this change? Review your account details.",
    "",
    "Ideas Beyond the Scroll",
  ].join("\n");

  return {
    html: baseEmailLayout(htmlContent, "Profile Updated - Writespace"),
    text: textContent,
  };
};
