import { baseEmailLayout, escapeHtml } from "./layout";

export const otpVerifyTemplate = (data: { email: string; otp: string }) => {
  const email = escapeHtml(data.email.trim());
  const otp = escapeHtml(data.otp.trim());

  const htmlContent = `
    <p style="
      margin: 0 0 12px;
      color: #897AF0;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    ">
      Account verification
    </p>

    <h1 style="
      margin: 0 0 18px;
      color: #191638;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 27px;
      line-height: 1.3;
    ">
      Verify your email address.
    </h1>

    <p style="margin: 0 0 10px; color: #4E4A61;">
      Use the verification code below to confirm your Writespace account.
    </p>

    <p style="
      margin: 0 0 24px;
      color: #928C86;
      font-size: 13px;
    ">
      ${email}
    </p>

    <table
      role="presentation"
      width="100%"
      cellpadding="0"
      cellspacing="0"
      border="0"
      style="margin: 0 0 24px;"
    >
      <tr>
        <td
          align="center"
          bgcolor="#F8F6F1"
          style="
            padding: 22px 12px;
            background-color: #F8F6F1;
            border: 1px dashed #897AF0;
            border-radius: 8px;
          "
        >
          <span style="
            color: #191638;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 32px;
            font-weight: 700;
            letter-spacing: 8px;
          ">
            ${otp}
          </span>
        </td>
      </tr>
    </table>

    <p style="
      margin: 0;
      color: #928C86;
      font-size: 13px;
      line-height: 1.7;
    ">
      This code expires in 10 minutes. If you didn't request this,
      you can safely ignore this email.
    </p>
  `;

  const textContent = [
    "Verify your email address.",
    "",
    "Use the verification code below to confirm your Writespace account.",
    email,
    "",
    `Verification Code: ${data.otp}`,
    "",
    "This code expires in 10 minutes.",
    "If you didn't request this, you can safely ignore this email.",
    "",
    "Ideas Beyond the Scroll",
  ].join("\n");

  return {
    html: baseEmailLayout(htmlContent, "Verify Your Writespace Account"),
    text: textContent,
  };
};
