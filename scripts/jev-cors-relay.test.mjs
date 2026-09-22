import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import { createJevRelay } from './jev-cors-relay.mjs';

const origin = 'http://localhost:8000';
const requests = [];
let upstream, relay, upstreamUrl, relayUrl;
let status = 200;
const start = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)));
const stop = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
before(async () => {
  upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status === 200 ? { data: [{ id: 'jev-latest' }], received: req.method } : { error: 'secret-upstream-key' }));
  });
  upstreamUrl = await start(upstream);
  relay = createJevRelay({ upstream: upstreamUrl + '/v1' });
  relayUrl = await start(relay);
});
after(async () => { await stop(relay); await stop(upstream); });
const target = path => relayUrl + '/proxy/' + encodeURIComponent(upstreamUrl + path);

test('answers browser preflight for the configured origin, including local-network headers', async () => {
  const response = await fetch(target('/v1/models'), { method: 'OPTIONS', headers: {
    Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,content-type',
    'Access-Control-Request-Private-Network': 'true',
  } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.match(response.headers.get('access-control-allow-headers'), /Authorization/);
  assert.equal(response.headers.get('access-control-allow-private-network'), 'true');
});
test('forwards model GET and decision POST, keeps credentials out of URLs and host headers out of upstream', async () => {
  for (const [path, method] of [['/v1/models', 'GET'], ['/v1/systemone', 'POST'], ['/v1/chat/completions', 'POST']]) {
    const response = await fetch(target(path), { method, headers: {
      Origin: origin, Authorization: 'Bearer test-key', Cookie: 'host-session=private', 'X-CSRF-Token': 'private', 'Content-Type': 'application/json',
    }, ...(method === 'POST' ? { body: JSON.stringify({ model: 'jev-latest', state: {}, questions: {} }) } : {}) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal((await response.json()).received, method);
    const last = requests.at(-1);
    assert.equal(last.url, path);
    assert.equal(last.headers.authorization, 'Bearer test-key');
    assert.equal(last.headers.cookie, undefined);
    assert.equal(last.headers.origin, undefined);
    assert.equal(last.headers['x-csrf-token'], undefined);
    if (method === 'POST') assert.equal(JSON.parse(last.body).model, 'jev-latest');
  }
});
test('rejects untrusted origins, missing Origin, unknown target, wrong method and invalid JSON before forwarding', async () => {
  const count = requests.length;
  for (const headers of [{ Origin: 'https://evil.example' }, {}]) {
    const response = await fetch(target('/v1/models'), { headers });
    assert.equal(response.status, 403);
    assert.equal(response.headers.has('access-control-allow-origin'), false);
  }
  const headers = { Origin: origin };
  assert.equal((await fetch(relayUrl + '/proxy/' + encodeURIComponent('http://127.0.0.1:9999/private'), { headers })).status, 403);
  assert.equal((await fetch(target('/v1/models?redirect=other'), { headers })).status, 403);
  assert.equal((await fetch(target('/v1/systemone'), { headers })).status, 405);
  assert.equal((await fetch(target('/v1/systemone'), { method: 'POST', headers, body: 'invalid' })).status, 400);
  assert.equal(requests.length, count);
});
test('preserves upstream HTTP status without exposing provider response secrets', async () => {
  status = 401;
  const response = await fetch(target('/v1/models'), { headers: { Origin: origin } });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal((await response.text()).includes('secret-upstream-key'), false);
  status = 200;
});
test('does not follow upstream redirects or forward the key to another destination', async () => {
  const redirect = http.createServer((_req, res) => { res.writeHead(302, { Location: upstreamUrl + '/stolen' }); res.end(); });
  const base = await start(redirect);
  const server = createJevRelay({ upstream: base + '/v1' });
  const address = await start(server);
  const count = requests.length;
  try {
    const response = await fetch(address + '/proxy/' + encodeURIComponent(base + '/v1/models'), { headers: { Origin: origin, Authorization: 'Bearer key' } });
    assert.equal(response.status, 502);
    assert.equal(requests.length, count);
  } finally { await stop(server); await stop(redirect); }
});
