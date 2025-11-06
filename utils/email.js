const nodemailer = require('nodemailer');

// Simple nodemailer wrapper. Configure via env vars:
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
  secure: false,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
});

async function sendEmail(to, subject, html) {
  const from = process.env.SMTP_FROM || 'no-reply@example.com';
  const msg = { from, to, subject, html };
  return transporter.sendMail(msg);
}

module.exports = { sendEmail };
