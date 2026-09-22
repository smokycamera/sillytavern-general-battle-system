import http from 'node:http';
import { pathToFileURL } from 'node:url';

const defaultOrigins = ['http://localhost:8000', 'http://127.0.0.1:8000', 'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'];
const limit = 2 * 1024 * 1024;

/** Small, dependency-free relay for hosts without a generic API proxy (e.g. TauriTavern).
 * The operator pins one upstream; callers cannot turn it into an arbitrary URL proxy.
 */
export function createJevRelay({ upstream = 'https://api.typesafe.ai/v1', origins = defaultOrigins, request = fetch } = {}) {
  const base = new URL(upstream);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash ||
    (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) throw Error('Use an HTTPS upstream or a loopback HTTP bridge');
  base.pathname = base.pathname.replace(/\/(?:models|systemone|chat\/completions)\/?$/, '').replace(/\/+$/, '');
  const prefix = base.href.replace(/\/+$/, '');
  const targets = new Set(['models', 'systemone', 'chat/completions', 'api/meta', 'api/bridge/evaluate', 'api/bridge/select-context', 'api/bridge/context'].map(path => prefix + '/' + path));
  const allowedOrigins = new Set(origins);
  return http.createServer(async (req, res) => {
    const reply = (status, body) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const origin = req.headers.origin;
    // Host validation also prevents DNS rebinding against the loopback listener.
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host ?? '')) return reply(403, { error: 'Invalid relay host' });
    if (!origin || !allowedOrigins.has(origin)) return reply(403, { error: 'Origin is not allowed; configure JEV_RELAY_ORIGINS' });
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.writeHead(204); res.end(); return;
    }
    if (req.method !== 'GET' && req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
    let target;
    try {
      if (!req.url?.startsWith('/proxy/')) return reply(404, { error: 'Unknown relay route' });
      target = decodeURIComponent(req.url.slice('/proxy/'.length));
    } catch { return reply(400, { error: 'Invalid target' }); }
    if (!targets.has(target)) return reply(403, { error: 'Target differs from the configured JEV_RELAY_UPSTREAM' });
    const get = target.endsWith('/models') || target.endsWith('/api/meta');
    if (req.method !== (get ? 'GET' : 'POST')) return reply(405, { error: 'Method does not match endpoint' });
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    try {
      let body;
      if (!get) {
        const chunks = []; let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > limit) return reply(413, { error: 'Request too large' });
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks).toString('utf8');
        try { JSON.parse(body); } catch { return reply(400, { error: 'Expected JSON' }); }
      }
      // Never forward the browser's cookie, Origin, CSRF or other host headers.
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (req.headers.authorization) headers.Authorization = req.headers.authorization;
      const response = await request(target, {
        method: req.method, headers, body, redirect: 'error', credentials: 'omit',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
      });
      if (!response.ok) { await response.body?.cancel(); return reply(response.status, { error: 'Upstream request failed', status: response.status }); }
      const reader = response.body?.getReader();
      const chunks = []; let bytes = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > limit) { await reader.cancel(); return reply(502, { error: 'Upstream response too large' }); }
          chunks.push(value);
        }
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return reply(502, { error: 'Upstream did not return JSON' }); }
      reply(response.status, data);
    } catch { reply(502, { error: 'Upstream connection failed or timed out' }); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const upstream = process.env.JEV_RELAY_UPSTREAM || 'https://api.typesafe.ai/v1';
  const origins = process.env.JEV_RELAY_ORIGINS ? process.env.JEV_RELAY_ORIGINS.split(',').map(value => value.trim()).filter(Boolean) : defaultOrigins;
  const port = Number(process.env.JEV_RELAY_PORT || 4318);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid JEV_RELAY_PORT');
  const server = createJevRelay({ upstream, origins });
  server.on('error', error => { console.error('JEV relay could not start:', error.code || 'unknown error'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    console.log('JEV relay listening on http://127.0.0.1:' + port);
    console.log('Allowed origins: ' + origins.join(', '));
  });
}
