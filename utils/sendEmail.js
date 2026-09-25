// Sends EcoTask emails: the sign-up verification code and the password reset code.
//
// Option 1 - Brevo (use this when deployed on Render; Render's free plan blocks Gmail SMTP):
//   BREVO_API_KEY=your Brevo API key
//   EMAIL_FROM=the sender email you verified in Brevo
// Option 2 - Gmail (works on your own computer):
//   EMAIL_USER=yourgmail@gmail.com
//   EMAIL_PASS=your 16-character Gmail App Password (NOT your normal password)
// If neither is set, the code is printed in the backend terminal instead,
// so you can still test sign-up locally.
const nodemailer = require('nodemailer');

const isBrevoConfigured = () => Boolean(process.env.BREVO_API_KEY && (process.env.EMAIL_FROM || process.env.EMAIL_USER));
const isGmailConfigured = () => Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);
const isEmailConfigured = () => isBrevoConfigured() || isGmailConfigured();

// Sends through Brevo's HTTPS API (not SMTP, so hosting providers don't block it).
const sendWithBrevo = async ({ to, name, subject, text, html }) => {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'EcoTask', email: process.env.EMAIL_FROM || process.env.EMAIL_USER },
      to: [{ email: to, name: name || to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Brevo email failed (${response.status}): ${details}`);
  }
};

let transporter = null;
const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
  }
  return transporter;
};

const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

// One template for every "here is your code" email.
const sendCodeEmail = async ({ to, name, code, minutes, subject, heading, intro, footer, logLabel }) => {
  if (!isEmailConfigured()) {
    console.log(`[EcoTask] Email is not set up. ${logLabel} for ${to}: ${code}`);
    return;
  }

  const safeName = escapeHtml(name);

  const message = {
    to,
    subject,
    text: `Hi ${name},\n\n${intro} ${code}\nIt expires in ${minutes} minutes.\n\n${footer}`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:460px;margin:0 auto;padding:24px;color:#1f2937">
        <h2 style="margin:0 0 4px;color:#1f5133">EcoTask</h2>
        <p style="margin:0 0 20px;color:#6b7280;font-size:13px">${heading}</p>
        <p>Hi ${safeName},</p>
        <p>${intro}</p>
        <div style="margin:20px 0;padding:16px;text-align:center;background:#f3fbf5;border:1px solid #cfe9d6;border-radius:10px">
          <span style="font-size:32px;font-weight:bold;letter-spacing:10px;color:#159447">${code}</span>
        </div>
        <p style="font-size:13px;color:#6b7280">This code expires in ${minutes} minutes. ${footer}</p>
      </div>`,
  };

  if (isBrevoConfigured()) {
    await sendWithBrevo({ ...message, name });
    return;
  }

  await getTransporter().sendMail({
    ...message,
    from: `"EcoTask" <${process.env.EMAIL_USER}>`,
  });
};

exports.sendVerificationCodeEmail = ({ to, name, code, minutes }) => sendCodeEmail({
  to, name, code, minutes,
  subject: `${code} is your EcoTask verification code`,
  heading: 'Confirm your email address',
  intro: 'Use this code to verify your EcoTask account:',
  footer: "If you didn't create an EcoTask account, you can ignore this email.",
  logLabel: 'Verification code',
});

exports.sendPasswordResetCodeEmail = ({ to, name, code, minutes }) => sendCodeEmail({
  to, name, code, minutes,
  subject: `${code} is your EcoTask password reset code`,
  heading: 'Reset your password',
  intro: 'Use this code to reset your EcoTask password:',
  footer: "If you didn't ask to reset your password, you can ignore this email. Your password won't change.",
  logLabel: 'Password reset code',
});
