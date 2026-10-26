// Development transport only. No login, browser session or application mutation.
const WebSocket = require('ws');
const origin = process.env.ALORA_DEV_ORIGIN || 'http://127.0.0.1:53020';
async function main() {
  const response = await fetch(origin + '/@vite/client');
  if (!response.ok) throw Error('Development client HTTP ' + response.status);
  const source = await response.text();
  const token = /const wsToken\s*=\s*["']([^"']+)["']/.exec(source)?.[1];
  if (!token) throw Error('Development socket token missing');
  const url = new URL(origin);url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';url.pathname = '/';url.searchParams.set('token', token);
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(url, 'vite-hmr', { origin });
    const timer = setTimeout(() => { ws.terminate();reject(Error('Development socket did not connect')); }, 4000);
    function fail(message) { clearTimeout(timer);ws.terminate();reject(Error(message)); }
    ws.on('unexpected-response', (_request, reply) => fail('Development socket HTTP ' + reply.statusCode + ' instead of 101'));
    ws.on('error', () => fail('Development socket transport failed'));
    ws.on('message', data => { try { if (JSON.parse(data.toString()).type === 'connected') {clearTimeout(timer);ws.close();resolve();} } catch { fail('Invalid development socket handshake'); } });
  });
  const redirect = await fetch(origin + '/', {redirect:'manual'});
  if (redirect.status !== 302 || !redirect.headers.get('location')?.endsWith('/admin/')) throw Error('Ordinary root redirect changed');
  console.log('PASS: Vite token handshake connected through public proxy; normal root redirect preserved. No user-flow acceptance.');
}
main().catch(error => { console.error(error.message);process.exitCode=1; });
