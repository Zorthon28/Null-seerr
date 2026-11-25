import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { TorrentManager } from './torrentManager';

test('authenticates and only removes a verified Arr hash without deleting files', async (t) => {
  const knownHash = 'a'.repeat(40);
  const sameTitleHash = 'b'.repeat(40);
  const deleted: string[] = [];
  let logins = 0;
  const server = createServer(async (request, response) => {
    if (request.url === '/api/v2/auth/login') {
      logins++;
      response.setHeader('Set-Cookie', 'SID=fixture; HttpOnly');
      return response.end('Ok.');
    }
    if (request.headers.cookie !== 'SID=fixture') {
      response.statusCode = 403;
      return response.end();
    }
    if (request.url === '/api/v2/app/version') return response.end('v5.2.3');
    if (request.url === '/api/v2/torrents/info') {
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify([
        { hash: knownHash, name: 'Same title' },
        { hash: sameTitleHash, name: 'Same title' },
      ]));
    }
    if (request.url === '/api/v2/torrents/delete') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      deleted.push(Buffer.concat(chunks).toString());
      return response.end();
    }
    response.statusCode = 404;
    return response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const env = {
    QBITTORRENT_HOST: '127.0.0.1',
    QBITTORRENT_PORT: String(address.port),
    QBITTORRENT_USERNAME: 'fixture',
    QBITTORRENT_PASSWORD: 'fixture-password',
  };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }

  const manager = new TorrentManager();
  assert.equal((await manager.deleteMediaTorrents({ title: 'Same title' })).deletedCount, 0);
  assert.equal(logins, 0);
  const result = await manager.deleteMediaTorrents({
    title: 'Same title',
    knownHashes: [knownHash.toUpperCase(), 'invalid', 'c'.repeat(40)],
  });
  assert.deepEqual(result, { deletedCount: 1, hashes: [knownHash] });
  assert.equal(logins, 1);
  assert.equal(deleted.length, 1);
  const payload = new URLSearchParams(deleted[0]);
  assert.equal(payload.get('hashes'), knownHash);
  assert.equal(payload.get('deleteFiles'), 'false');
});
