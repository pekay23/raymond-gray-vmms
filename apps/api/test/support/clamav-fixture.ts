import net from 'node:net';

export type ClamAvFixtureMode = 'clean' | 'version-timeout' | 'scan-timeout' | 'slow-trickle' | 'malformed' | 'oversized' | 'truncated' | 'close';

function streamTerminatorOffset(frames: Buffer): number | null {
  let offset = 0;
  while (offset + 4 <= frames.length) {
    const size = frames.readUInt32BE(offset);
    offset += 4;
    if (size === 0) return offset;
    offset += size;
    if (offset > frames.length) return null;
  }
  return null;
}

export async function startClamAvFixture(mode: ClamAvFixtureMode) {
  const sockets = new Set<net.Socket>();
  const timers = new Set<NodeJS.Timeout>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    let received = Buffer.alloc(0);
    let versionHandled = false;
    let responseHandled = false;

    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
      const commandEnd = received.indexOf(0);
      if (commandEnd < 0) return;
      const command = received.subarray(0, commandEnd).toString('utf8');
      if (command === 'zVERSION' && !versionHandled) {
        versionHandled = true;
        if (mode === 'close') {
          socket.destroy();
          return;
        }
        if (mode !== 'version-timeout') socket.write(Buffer.from('ClamAV synthetic test\0'));
        return;
      }
      if (command !== 'zINSTREAM' || responseHandled) return;
      if (streamTerminatorOffset(received.subarray(commandEnd + 1)) === null) return;
      responseHandled = true;
      if (mode === 'scan-timeout') return;
      if (mode === 'slow-trickle') {
        const timer = setInterval(() => socket.write(Buffer.from('x')), 250);
        timers.add(timer);
        socket.once('close', () => {
          clearInterval(timer);
          timers.delete(timer);
        });
        return;
      }
      if (mode === 'truncated') {
        socket.end(Buffer.from('stream: OK'));
        return;
      }
      if (mode === 'oversized') {
        socket.write(Buffer.concat([Buffer.alloc(4098, 120), Buffer.from([0])]));
        return;
      }
      const response = mode === 'clean' ? 'stream: OK\0' : 'unexpected daemon response\0';
      socket.write(Buffer.from(response));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The local ClamAV fixture did not bind to a TCP port.');

  return {
    host: '127.0.0.1',
    port: address.port,
    async close() {
      for (const timer of timers) clearInterval(timer);
      timers.clear();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}
