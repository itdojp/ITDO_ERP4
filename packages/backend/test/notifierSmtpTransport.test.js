import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import {
  closeNotifierResources,
  sendEmail,
} from '../dist/services/notifier.js';

test(
  'real SMTP transport sends synthetic recipients/attachment and reopens after cleanup',
  { timeout: 10000 },
  async (t) => {
    const messages = [];
    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => {});
      socket.setEncoding('utf8');
      let pending = '';
      let inData = false;
      let envelope = { recipients: [], body: [] };
      socket.write('220 localhost synthetic SMTP\r\n');
      socket.on('data', (chunk) => {
        pending += chunk;
        let boundary;
        while ((boundary = pending.indexOf('\r\n')) >= 0) {
          const line = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          if (inData) {
            if (line === '.') {
              inData = false;
              messages.push(envelope);
              socket.write('250 accepted\r\n');
              envelope = { recipients: [], body: [] };
            } else {
              envelope.body.push(line);
            }
          } else if (/^(EHLO|HELO) /i.test(line)) {
            socket.write('250 localhost\r\n');
          } else if (/^MAIL FROM:/i.test(line)) {
            envelope.from = line;
            socket.write('250 sender accepted\r\n');
          } else if (/^RCPT TO:/i.test(line)) {
            envelope.recipients.push(line);
            socket.write('250 recipient accepted\r\n');
          } else if (line === 'DATA') {
            inData = true;
            socket.write('354 end with dot\r\n');
          } else if (line === 'QUIT') {
            socket.end('221 bye\r\n');
          } else {
            socket.write('250 ok\r\n');
          }
        }
      });
    });
    t.after(async () => {
      await closeNotifierResources();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const values = {
      MAIL_TRANSPORT: 'smtp',
      MAIL_FROM: 'sender@example.test',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(server.address().port),
      SMTP_SECURE: 'false',
      SMTP_USER: undefined,
      SMTP_PASS: undefined,
    };
    const previous = Object.fromEntries(
      Object.keys(values).map((key) => [key, process.env[key]]),
    );
    t.after(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const result = await sendEmail(
      ['recipient@example.test', ' recipient@example.test '],
      'Synthetic SMTP compatibility',
      'Synthetic body only',
      {
        attachments: [
          {
            filename: 'synthetic.txt',
            content: Buffer.from('synthetic attachment'),
          },
        ],
      },
    );
    assert.equal(result.status, 'success');
    assert.equal(typeof result.messageId, 'string');
    assert.equal(messages.length, 1);
    assert.match(messages[0].from, /<sender@example\.test>/);
    assert.deepEqual(messages[0].recipients, [
      'RCPT TO:<recipient@example.test>',
    ]);
    const body = messages[0].body.join('\n');
    assert.match(body, /Subject: Synthetic SMTP compatibility/);
    assert.match(body, /Synthetic body only/);
    assert.match(body, /filename=synthetic\.txt|filename="synthetic\.txt"/);
    assert.ok(
      body.includes(Buffer.from('synthetic attachment').toString('base64')),
    );
    await closeNotifierResources();
    await closeNotifierResources();
    const second = await sendEmail(
      ['recipient@example.test'],
      'Synthetic second message',
      'Synthetic body',
    );
    assert.equal(second.status, 'success');
    assert.equal(messages.length, 2);
  },
);
