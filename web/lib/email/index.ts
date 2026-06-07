// Tiny mailer for the LORE frontend. Two backings behind one async API:
//   - SMTP configured (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM all set)
//     -> send via nodemailer.
//   - otherwise -> DEV FALLBACK: console.log the message so invitation links and
//     temporary passwords are visible in the server logs during local dev.
// Sending NEVER throws to the caller: a transport failure is logged and the call
// resolves to { ok:false } so flows like "invite a user" don't fail on email.
// Server-only.
import "server-only";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendResult {
  ok: boolean;
  delivery: "smtp" | "console";
  error?: string;
}

function smtpConfigured(): boolean {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  return !!(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && SMTP_FROM);
}

export function isSmtpConfigured(): boolean {
  return smtpConfigured();
}

export async function sendMail(mail: Mail): Promise<SendResult> {
  if (!smtpConfigured()) {
    // DEV FALLBACK — surface the full message (incl. links/temp passwords) in logs.
    // eslint-disable-next-line no-console
    console.log(
      [
        "",
        "──────────────────────────────────────────────",
        "[LORE email · DEV FALLBACK — SMTP not configured]",
        `To:      ${mail.to}`,
        `Subject: ${mail.subject}`,
        "",
        mail.text,
        "──────────────────────────────────────────────",
        "",
      ].join("\n")
    );
    return { ok: true, delivery: "console" };
  }

  try {
    // Imported lazily so the dev/console path needs no nodemailer at runtime.
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      // 465 => implicit TLS; otherwise STARTTLS is negotiated when available.
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    return { ok: true, delivery: "smtp" };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // Don't block the calling flow on email failure — log and report.
    // eslint-disable-next-line no-console
    console.error(`[LORE email] SMTP send failed to ${mail.to}: ${error}`);
    return { ok: false, delivery: "smtp", error };
  }
}

// Compose the invitation message (temp password + login URL). French copy by
// default (LORE ships FR-first); kept dependency-free and plain-text friendly.
export function inviteMessage(opts: {
  name: string;
  email: string;
  tempPassword: string;
  loginUrl: string;
  orgName?: string;
}): Mail {
  const org = opts.orgName ? ` ${opts.orgName}` : "";
  const text = [
    `Bonjour ${opts.name},`,
    "",
    `Un compte vient d'être créé pour vous sur LORE${org}.`,
    "",
    "Vos identifiants de première connexion :",
    `  • Adresse e-mail : ${opts.email}`,
    `  • Mot de passe temporaire : ${opts.tempPassword}`,
    "",
    `Connectez-vous ici : ${opts.loginUrl}`,
    "",
    "Pour des raisons de sécurité, un nouveau mot de passe vous sera demandé",
    "lors de votre première connexion.",
    "",
    "— L'équipe LORE",
  ].join("\n");
  return {
    to: opts.email,
    subject: "Votre accès à LORE — première connexion",
    text,
  };
}
