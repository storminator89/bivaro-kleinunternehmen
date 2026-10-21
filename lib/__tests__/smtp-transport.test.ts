import { expect, it } from 'vitest';
import net from 'node:net';
import { createDocumentMailTransport } from '@/lib/smtp-transport';

it.each([false, true])('refuses a STARTTLS-stripping SMTP peer before credentials or data leave; abortable=%s', async abortable => {
  const commands: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('220 local.test SMTP fixture\r\n');
    let pending = '';
    socket.on('data', bytes => {
      pending += bytes.toString();
      let end: number;
      while ((end = pending.indexOf('\r\n')) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        commands.push(line);
        if (line.startsWith('EHLO')) socket.write('250-local.test\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (line === 'STARTTLS') socket.write('454 TLS unavailable\r\n');
        else socket.write('500 Unexpected command\r\n');
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const transport = createDocumentMailTransport({
    host: '127.0.0.1', port: (server.address() as net.AddressInfo).port,
    secure: false, auth: { user: 'synthetic-user', pass: 'synthetic-password' },
  }, abortable ? { signal: new AbortController().signal } : undefined);
  try {
    await expect(transport.sendMail({ from: 'sender@example.test', to: 'recipient@example.test',
      subject: 'Synthetic test', text: 'Must not be delivered',
    })).rejects.toThrow();
    expect(commands).toContain('STARTTLS');
    expect(commands.some(command => /^(AUTH|MAIL|RCPT|DATA)\b/.test(command))).toBe(false);
  } finally {
    transport.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

it.each([false, true])('aborts the actual TCP socket for outbox implicitTLS=%s without transmitting a message', async secure => {
  let connected!: () => void; let closed!: () => void;
  const connection = new Promise<void>(resolve => { connected = resolve; });
  const closure = new Promise<void>(resolve => { closed = resolve; });
  const commands: Buffer[] = [];
  const server = net.createServer(socket => {
    socket.on('data', bytes => commands.push(bytes));
    socket.once('close', closed);
    socket.on('error', () => {});
    connected();
    // Deliberately withhold SMTP greeting/TLS handshake; only isolated loopback.
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController();
  const transport = createDocumentMailTransport({ host: '127.0.0.1', port: (server.address() as net.AddressInfo).port, secure }, { signal: controller.signal });
  try {
    const rejected = expect(transport.sendMail({ from: 'sender@example.test', to: 'recipient@example.test', subject: 'Synthetic only', text: 'SENSITIVE_SYNTHETIC_BODY' })).rejects.toThrow();
    await connection;
    controller.abort();
    await rejected;
    await closure;
    expect(Buffer.concat(commands).toString()).not.toContain('SENSITIVE_SYNTHETIC_BODY');
    expect(Buffer.concat(commands).toString()).not.toMatch(/(?:AUTH|MAIL FROM|RCPT TO|DATA)\b/u);
  } finally {
    controller.abort(); transport.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


it('marks a controlled preconnection refusal as definitely not handed off', async () => {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const controller = new AbortController();
  const transport = createDocumentMailTransport({ host: '127.0.0.1', port, secure: false }, { signal: controller.signal });
  try {
    await expect(transport.sendMail({ from: 'sender@example.test', to: 'recipient@example.test', subject: 'Synthetic only', text: 'Never handed off' })).rejects.toMatchObject({ code: 'ECONNECTION', command: 'CONN' });
  } finally { controller.abort(); transport.close(); }
});
