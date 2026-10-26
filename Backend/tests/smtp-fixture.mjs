import { createServer } from 'node:net';
import { once } from 'node:events';

// Loopback-only SMTP capture. Codes stay in memory and no external mail is sent.
export async function smtpFixture() {
  const messages = new Map(), sockets = new Set();
  let reject = false;
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    socket.setEncoding('utf8'); socket.write('220 localhost test SMTP\r\n');
    let buffer = '', data = false, lines = [], recipient = '';
    socket.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n'), line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        if (data) {
          if (line !== '.') { lines.push(line.startsWith('..') ? line.slice(1) : line); continue; }
          data = false;
          if (reject) { socket.write('550 test delivery rejected\r\n'); continue; }
          const raw = lines.join('\r\n'), split = raw.indexOf('\r\n\r\n');
          let body = raw.slice(split + 4);
          if (/Content-Transfer-Encoding: base64/i.test(raw.slice(0, split))) body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
          else if (/Content-Transfer-Encoding: quoted-printable/i.test(raw.slice(0, split))) body = Buffer.from(body.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))), 'binary').toString('utf8');
          const code = body.match(/\b\d{6}\b/)?.[0]; messages.set(recipient, { code });
          socket.write('250 accepted\r\n'); continue;
        }
        if (/^EHLO /i.test(line)) socket.write('250-localhost\r\n250 8BITMIME\r\n');
        else if (/^RCPT TO:/i.test(line)) { recipient = line.match(/<([^>]+)>/)?.[1].toLowerCase(); socket.write('250 ok\r\n'); }
        else if (/^DATA$/i.test(line)) { data = true; lines = []; socket.write('354 send data\r\n'); }
        else if (/^QUIT$/i.test(line)) socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { port: server.address().port, messages, reject(value) { reject = value; }, async close() { for (const socket of sockets) socket.destroy(); await new Promise(done => server.close(done)); } };
}
