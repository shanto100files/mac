// Compiled for Node 12 in webOS 23+ packages; cancellation is shimmed at startup.
const http = require('http'), https = require('https'), dns = require('dns');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const MAX = 8 * 1024 * 1024;
const token = () => crypto.randomBytes(32).toString('hex');
const fail = message => {throw new Error(message);};
const allowedHeaders = /^(accept|accept-language|user-agent|referer|origin|range|sec-ch-ua(?:-mobile|-platform)?)$/i;
function headersFor(headers, original, target) {
  return headers.filter(([name]) => !/^(host|connection|content-length|transfer-encoding|upgrade|proxy-.*|accept-encoding)$/i.test(name) &&
    (new URL(original).origin === new URL(target).origin || allowedHeaders.test(name)));
}
function collect(stream, limit = MAX) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    stream.on('data', chunk => {size += chunk.length; if (size > limit) {reject(new Error('Response exceeds TV host limit')); stream.destroy();} else chunks.push(chunk);});
    stream.on('end', () => resolve(Buffer.concat(chunks))); stream.on('error', reject);
  });
}
function createTransport(policy) {
  return async function open(input, signal) {
    const url = policy.publicHttpUrl(input.url);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    let timeout;
    let addresses;
    try {addresses = await Promise.race([dns.promises.lookup(host, {all:true}), new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Provider DNS timed out')),15_000);})]);}
    finally {clearTimeout(timeout);}
    if (!addresses.length || addresses.some(item => !policy.isPublicAddress(item.address))) fail('Provider DNS resolved to a blocked destination');
    if (signal.aborted) fail('Request canceled');
    const headers = headersFor(input.headers || [], input.url, input.url);
    headers.push(['accept-encoding', 'identity']);
    return new Promise((resolve, reject) => {
      // The connection uses the checked address; no second unvalidated DNS lookup.
      const req = (url.protocol === 'https:' ? https : http).request(url, {
        method:input.method || 'GET', headers:Object.fromEntries(headers), agent:false,
        lookup:(_host, options, callback) => options?.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family),
      }, response => {resolve(response);});
      const abort = () => req.destroy(new Error('Request canceled'));
      signal.addEventListener('abort', abort, {once:true});
      req.on('close', () => signal.removeEventListener('abort', abort));
      req.setTimeout(30_000, () => req.destroy(new Error('Provider request timed out')));
      req.on('error', reject);
      if (input.body) req.write(Buffer.from(input.body)); req.end();
    });
  };
}
async function startHost({root, port = 32177, policy, open:providedOpen} = {}) {
  policy = policy || require('./networkPolicy.cjs');
  const open = providedOpen || createTransport(policy);
  const session = token(), leases = new Map(), active = new Set(); let base, lastSeen = Date.now();
  const fileTypes = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.wasm':'application/wasm', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2'};
  const server = http.createServer(async (req, res) => {
    const controller = new AbortController();
    if (active.size >= 16) {res.statusCode=429;res.end('Too many TV host requests');return;}
    active.add(controller);
    res.on('close', () => {controller.abort();active.delete(controller);});
    const stopTimer = setTimeout(() => controller.abort(), 120_000);
    // Node 8 emits response `close` only when the keep-alive socket closes.
    // Completed responses must release their slot immediately on every runtime.
    res.once('finish', () => {clearTimeout(stopTimer);active.delete(controller);});
    try {
      if (req.headers.host !== new URL(base).host || req.headers.origin && req.headers.origin !== base) fail('Unauthorized TV host origin');
      res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
      const url = new URL(req.url, base);
      if (url.pathname.startsWith(`/app/${session}/`) && req.method === 'GET') {
        const relative = decodeURIComponent(url.pathname.slice(`/app/${session}/`.length));
        const file = path.resolve(root, relative);
        if (!file.startsWith(path.resolve(root) + path.sep)) fail('Invalid app asset');
        const stat = await fs.promises.stat(file); if (!stat.isFile()) fail('Invalid app asset');
        res.setHeader('Content-Type', fileTypes[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(res); return;
      }
      if (url.pathname.startsWith('/media/') && ['GET','HEAD'].includes(req.method)) {
        const [, , secret, key] = url.pathname.split('/');
        const lease = leases.get(secret);
        if (!lease || lease.expires < Date.now() || !lease.urls.has(key)) fail('Playback lease expired');
        lease.active.add(controller);res.once('close',()=>lease.active.delete(controller));
        lease.expires = Date.now() + 120_000; lastSeen = Date.now();
        let target = lease.urls.get(key), currentHeaders = headersFor(lease.headers, lease.source, target), response;
        if (req.headers.range) currentHeaders = currentHeaders.filter(([name]) => name.toLowerCase() !== 'range').concat([['range',req.headers.range]]);
        for (let i = 0; i <= 10; i++) {
          response = await open({url:target, method:req.method, headers:currentHeaders}, controller.signal);
          if (![301,302,303,307,308].includes(response.statusCode) || !response.headers.location) break;
          if (i === 10) fail('Too many playback redirects');
          const next = new URL(response.headers.location, target).href;
          currentHeaders = headersFor(currentHeaders, target, next); target = next; response.destroy();
        }
        const mime = response.headers['content-type'] || '';
        const playlist = /mpegurl/i.test(mime) || /\.m3u8(?:$|\?)/i.test(target);
        if (playlist && req.method !== 'HEAD' && response.statusCode === 200) {
          const text = (await collect(response, 512_000)).toString('utf8');
          if (!text.trimStart().startsWith('#EXTM3U') || /\{\$|#EXT-X-(?:CONTENT-STEERING|DEFINE|PART:|PRELOAD-HINT:)/.test(text)) fail('Unsupported HLS playlist');
          const resource = value => {
            const destination = policy.publicHttpUrl(new URL(value, target).href).href;
            let id = lease.keys.get(destination);
            if (!id) {if (lease.urls.size >= 2000) fail('Too many playback resources'); id = token(); lease.keys.set(destination, id); lease.urls.set(id, destination);}
            return `${base}/media/${secret}/${id}`;
          };
          const rewritten = text.split(/\r?\n/).map(line => {
            if (/KEYFORMAT="(?!identity")/.test(line)) fail('DRM playback is not supported');
            if (!line.trim()) return line;
            return line.startsWith('#') ? line.replace(/URI="([^"]+)"/g, (_, value) => `URI="${resource(value)}"`) : resource(line.trim());
          }).join('\n');
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); res.end(rewritten); return;
        }
        res.statusCode = response.statusCode;
        for (const name of ['content-type','content-length','content-range','accept-ranges']) if (response.headers[name]) res.setHeader(name,response.headers[name]);
        response.on('error', error => res.destroy(error)); response.pipe(res); return;
      }
      if (req.method !== 'POST' || req.headers['x-vega-session'] !== session || req.headers['content-type'] !== 'application/json') fail('Unauthorized TV host request');
      const body = JSON.parse((await collect(req)).toString('utf8')); lastSeen = Date.now();
      let result;
      if (url.pathname === '/api/request') {
        if (body.credentials !== 'omit' || !['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(body.method) || !Array.isArray(body.headers)) fail('Invalid native request');
        const response = await open(body, controller.signal);
        const headers = []; for (let i = 0; i < response.rawHeaders.length; i += 2) headers.push([response.rawHeaders[i], response.rawHeaders[i+1]]);
        result = {url:body.url, status:response.statusCode, headers, body:Array.from(await collect(response))};
      } else if (url.pathname === '/api/prepare') {
        if (typeof body.id !== 'string' || body.id.length > 100 || typeof body.source !== 'string') fail('Invalid media source');
        policy.publicHttpUrl(body.source);
        if (leases.size >= 8) fail('Too many prepared sources');
        const secret = token(), key = token();
        leases.set(secret, {id:body.id, source:body.source, headers:Object.entries(body.headers || {}), urls:new Map([[key,body.source]]), keys:new Map([[body.source,key]]), expires:Date.now()+120_000,active:new Set()});
        result = {...body, source:`${base}/media/${secret}/${key}`, headers:undefined};
      } else if (url.pathname === '/api/release') {for (const [key, lease] of leases) if (lease.id === body.id) {for(const controller of lease.active)controller.abort();leases.delete(key);} result = {};
      } else if (url.pathname === '/api/heartbeat') {for (const [key, lease] of leases) {if (lease.expires < Date.now()) leases.delete(key); else lease.expires = Date.now()+120_000;} result = {};
      } else fail('Unknown TV host method');
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
    } catch (error) {if (!res.headersSent) {res.statusCode = 400; res.end(error.message);} else res.destroy();}
    finally {if (res.writableEnded) {clearTimeout(stopTimer);active.delete(controller);} else res.once('close',()=>clearTimeout(stopTimer));}
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(port, '127.0.0.1', resolve);});
  base = `http://127.0.0.1:${server.address().port}`;
  return {url:`${base}/app/${session}/index.html`, get lastSeen(){return lastSeen;}, close(){for (const controller of active) controller.abort(); leases.clear(); server.close();}};
}
module.exports = {startHost, createTransport, headersFor};
