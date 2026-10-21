import nodemailer from 'nodemailer';
import { createConnection, type Socket } from 'node:net';

export function createDocumentMailTransport(configuration: {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
}, control?: { signal: AbortSignal }) {
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
    // Non-pooled Nodemailer.close() does not abort its local connection. For
    // outbox sends, own the actual TCP socket; Nodemailer still performs TLS
    // (including implicit TLS) over this connection with the same policy.
    ...(control ? { getSocket(_options: unknown, callback: (error: Error | null, socketOptions: { connection: Socket; secured: false } | false) => void) {
      const socket = createConnection({ host: configuration.host, port: configuration.port, signal: control.signal });
      let settled = false;
      const timer = setTimeout(() => socket.destroy(Object.assign(new Error('Connection timeout'), { code: 'ECONNECTION', command: 'CONN' })), 10_000);
      const fail = (error: Error) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        callback(control.signal.aborted ? error : Object.assign(new Error('SMTP connection failed before handshake'), { code: 'ECONNECTION', command: 'CONN' }), false);
      };
      socket.on('error', fail);
      socket.once('connect', () => {
        clearTimeout(timer);
        if (settled || control.signal.aborted) { socket.destroy(); return; }
        settled = true;
        callback(null, { connection: socket, secured: false });
      });
      socket.once('close', () => clearTimeout(timer));
    } } : {}),
  });
}
