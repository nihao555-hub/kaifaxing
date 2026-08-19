import nodemailer from 'nodemailer';
import { config } from './config.js';

export const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  auth: { user: config.smtp.user, pass: config.smtp.pass },
});

export async function sendMail({ to, subject, text }) {
  // 纯文本 + 简单 HTML 双格式，提高送达率
  const html = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.6;color:#222;">${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');

  const info = await transporter.sendMail({
    from: `"${config.smtp.senderName}" <${config.smtp.user}>`,
    to,
    subject,
    text,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;max-width:640px;">${html}</div>`,
  });
  return info;
}
