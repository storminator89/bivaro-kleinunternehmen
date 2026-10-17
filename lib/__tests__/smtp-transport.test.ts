import { expect, it } from 'vitest';
import net from 'node:net';
import { createDocumentMailTransport } from '@/lib/smtp-transport';

it('refuses a STARTTLS-stripping SMTP peer before credentials or document data leave the client', async () => {
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
  });
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
