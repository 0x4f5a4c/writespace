import {
  baseEmailLayout,
  emailButton,
  escapeHtml,
  safeEmailUrl,
} from "./layout";

export const welcomeTemplate = (data: {
  username: string;
  ctaLink: string;
}) => {
  const username = data.username.trim() || "there";
  const safeUsername = escapeHtml(username);
  const ctaLink = safeEmailUrl(data.ctaLink);

  const htmlContent = `
    <p style="
      margin: 0 0 12px;
      color: #897AF0;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    ">
      Welcome aboard
    </p>

    <h1 style="
      margin: 0 0 18px;
      color: #191638;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 28px;
      line-height: 1.3;
      letter-spacing: -0.5px;
    ">
      Welcome to Writespace, ${safeUsername}.
    </h1>

    <p style="margin: 0 0 16px; color: #4E4A61;">
      We're glad you're here.
    </p>

    <p style="margin: 0; color: #4E4A61;">
      Writespace is a place to share your ideas, publish your work,
      discover perspectives and connect with people who care about
      what you're creating.
    </p>

    ${emailButton(ctaLink, "Complete Your Profile")}

    <p style="
      margin: 26px 0 0;
      color: #928C86;
      font-size: 13px;
    ">
      Here's to everything you'll create.
    </p>
  `;

  const textContent = [
    `Welcome to Writespace, ${username}.`,
    "",
    "We're glad you're here.",
    "",
    "Writespace is a place to share your ideas, publish your work, discover perspectives and connect with people who care about what you're creating.",
    "",
    `Complete Your Profile: ${ctaLink}`,
    "",
    "Here's to everything you'll create.",
    "",
    "Ideas Beyond the Scroll",
  ].join("\n");

  return {
    html: baseEmailLayout(htmlContent, "Welcome to Writespace"),
    text: textContent,
  };
};
