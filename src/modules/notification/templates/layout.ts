/**
 * Shared Writespace email design system.
 *
 * All email templates should use this layout to maintain consistent
 * branding across authentication, account, notification, and security emails.
 */

const BRAND = {
  midnightNavy: "#191638",
  coral: "#FF765E",
  lavender: "#897AF0",
  warmIvory: "#F8F6F1",
  warmGrey: "#928C86",
  bodyText: "#4E4A61",
  white: "#FFFFFF",
  border: "#EAE6E0",
};

/**
 * Escape dynamic values before inserting them into HTML.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character] ?? character;
  });
}

/**
 * Allow only HTTP(S) absolute URLs and safe local paths.
 * This prevents unsafe schemes such as javascript: from being used in href.
 */
export function safeEmailUrl(value: string): string {
  const candidate = value.trim();

  if (!candidate) {
    return "#";
  }

  if (candidate.startsWith("#")) {
    return candidate;
  }

  if (candidate.startsWith("/") && !candidate.startsWith("//")) {
    return candidate;
  }

  try {
    const url = new URL(candidate);

    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    ) {
      return url.toString();
    }
  } catch {
    // Invalid URLs are deliberately replaced with a harmless fallback.
  }

  return "#";
}

/**
 * Reusable email CTA.
 *
 * Uses inline styling because many email clients do not reliably apply
 * embedded stylesheets or external CSS classes.
 */
export function emailButton(href: string, label: string): string {
  const safeHref = escapeHtml(safeEmailUrl(href));
  const safeLabel = escapeHtml(label);

  return `
    <table
      role="presentation"
      cellpadding="0"
      cellspacing="0"
      border="0"
      style="border-collapse: collapse; margin: 24px 0;"
    >
      <tr>
        <td
          align="center"
          bgcolor="${BRAND.midnightNavy}"
          style="
            background-color: ${BRAND.midnightNavy};
            border-radius: 7px;
          "
        >
          <a
            href="${safeHref}"
            target="_blank"
            style="
              display: inline-block;
              padding: 13px 25px;
              color: ${BRAND.white};
              font-family: Arial, Helvetica, sans-serif;
              font-size: 14px;
              font-weight: 700;
              line-height: 1.4;
              text-decoration: none;
              border-radius: 7px;
            "
          >
            ${safeLabel}
          </a>
        </td>
      </tr>
    </table>
  `.trim();
}

/**
 * Wrap trusted, template-generated HTML in the shared Writespace layout.
 *
 * Callers must escape dynamic values before constructing content.
 */
export const baseEmailLayout = (content: string, title: string): string => {
  const safeTitle = escapeHtml(title);
  const currentYear = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${safeTitle}</title>

  <style>
    body {
      margin: 0 !important;
      padding: 0 !important;
      background-color: ${BRAND.warmIvory};
      color: ${BRAND.bodyText};
      font-family: Arial, Helvetica, sans-serif;
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }

    table {
      border-collapse: collapse;
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }

    @media only screen and (max-width: 620px) {
      .email-outer {
        padding: 16px 10px !important;
      }

      .email-content {
        padding: 30px 22px !important;
      }

      .email-brand {
        font-size: 29px !important;
      }
    }
  </style>
</head>

<body style="
  margin: 0;
  padding: 0;
  background-color: ${BRAND.warmIvory};
  color: ${BRAND.bodyText};
  font-family: Arial, Helvetica, sans-serif;
">

  <table
    role="presentation"
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    bgcolor="${BRAND.warmIvory}"
    style="width: 100%; background-color: ${BRAND.warmIvory};"
  >
    <tr>
      <td
        align="center"
        class="email-outer"
        style="padding: 36px 16px;"
      >

        <table
          role="presentation"
          width="600"
          cellpadding="0"
          cellspacing="0"
          border="0"
          bgcolor="${BRAND.white}"
          style="
            width: 100%;
            max-width: 600px;
            background-color: ${BRAND.white};
            border: 1px solid ${BRAND.border};
            border-radius: 12px;
            overflow: hidden;
          "
        >

          <!-- Shared text wordmark until the final logo is approved. -->
          <tr>
            <td
              align="center"
              bgcolor="${BRAND.warmIvory}"
              style="
                padding: 30px 24px 26px;
                background-color: ${BRAND.warmIvory};
                border-bottom: 1px solid ${BRAND.border};
              "
            >
              <div
                class="email-brand"
                style="
                  color: ${BRAND.midnightNavy};
                  font-family: Georgia, 'Times New Roman', serif;
                  font-size: 32px;
                  font-weight: 700;
                  line-height: 1.2;
                  letter-spacing: -0.8px;
                "
              >
                Writespace<span style="color: ${BRAND.coral};">.</span>
              </div>

              <div style="
                margin-top: 9px;
                color: ${BRAND.bodyText};
                font-family: Arial, Helvetica, sans-serif;
                font-size: 11px;
                line-height: 1.6;
                letter-spacing: 1px;
              ">
                Ideas
                <span style="color: ${BRAND.coral}; font-weight: 700;">
                  Beyond
                </span>
                the Scroll
              </div>
            </td>
          </tr>

          <!-- Individual email content. -->
          <tr>
            <td
              class="email-content"
              bgcolor="${BRAND.white}"
              style="
                padding: 40px;
                background-color: ${BRAND.white};
                color: ${BRAND.bodyText};
                font-family: Arial, Helvetica, sans-serif;
                font-size: 15px;
                line-height: 1.75;
              "
            >
              ${content}
            </td>
          </tr>

          <!-- Shared footer. -->
          <tr>
            <td
              align="center"
              bgcolor="${BRAND.warmIvory}"
              style="
                padding: 23px 24px;
                background-color: ${BRAND.warmIvory};
                border-top: 1px solid ${BRAND.border};
              "
            >
              <p style="
                margin: 0;
                color: ${BRAND.midnightNavy};
                font-size: 12px;
                line-height: 1.6;
                font-weight: 600;
              ">
                Ideas Beyond the Scroll
              </p>

              <p style="
                margin: 8px 0 0;
                color: ${BRAND.warmGrey};
                font-size: 11px;
                line-height: 1.6;
              ">
                &copy; ${currentYear} Writespace. All rights reserved.
              </p>

              <p style="
                margin: 5px 0 0;
                color: ${BRAND.warmGrey};
                font-size: 11px;
                line-height: 1.6;
              ">
                This is an automated message. Please do not reply.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
};
