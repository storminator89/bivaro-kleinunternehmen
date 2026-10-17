import nodemailer from 'nodemailer';

export function createDocumentMailTransport(configuration: {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
}) {
  return nodemailer.createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.secure,
    requireTLS: !configuration.secure,
    auth: configuration.auth,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    disableFileAccess: true,
    disableUrlAccess: true,
    tls: { minVersion: 'TLSv1.2' },
  });
}
