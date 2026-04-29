// pinterest-mcp-worker.js
// Cloudflare Worker + Durable Object untuk MCP Pinterest (SSE transport)

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ====================== PINTEREST API ======================
async function pinterestAPI(resource, options) {
  const url = `https://www.pinterest.com/resource/${resource}/get/`;
  const params = new URLSearchParams({
    data: JSON.stringify({ options, context: {} }),
    _: Date.now(),
  });
  const res = await fetch(`${url}?${params}`, {
    headers: {
      ...HEADERS,
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json',
    },
  });
  return res.json();
}

// ====================== HELPERS ======================
function toOriginal(src) {
  return src.replace(/\/\d+x\//, '/originals/').replace(/\/\d+x\d+\//, '/originals/');
}
function isValidPin(src) {
  return (
    src.includes('i.pinimg.com') &&
    /\.(jpg|jpeg|png|webp)/.test(src) &&
    !src.includes('/60x60/') &&
    !src.includes('/videos/thumbnails/')
  );
}
function extractVidsFromHtml(html, limit) {
  const seen = new Set();
  const vids = [];
  const RE = /https:\/\/v\d+\.pinimg\.com\/videos\/[^\s"'\\]+\.mp4/g;
  for (const m of html.matchAll(RE)) {
    const original = m[0];
    if (seen.has(original)) continue;
    seen.add(original);
    const hd = original.replace(/\/\d+p\//, '/720p/');
    vids.push({ video: hd, original });
    if (vids.length >= limit) break;
  }
  return vids;
}

class ImgExtractor {
  constructor() { this.srcs = []; }
  element(element) {
    const src = element.getAttribute('src');
    if (src) this.srcs.push(src);
  }
}
async function extractImagesFromHTML(html, limit) {
  const handler = new ImgExtractor();
  const rewriter = new HTMLRewriter().on('img', handler);
  const resp = new Response(html);
  await rewriter.transform(resp).text();
  const filtered = handler.srcs.filter(src => isValidPin(src)).map(src => toOriginal(src));
  return [...new Set(filtered)].slice(0, limit);
}
function isPinterestUrl(query) {
  return query.includes('pinterest.com/pin/') || query.includes('pin.it/');
}
async function resolvePinUrl(shortUrl) {
  const resp = await fetch(shortUrl, { headers: HEADERS, redirect: 'follow' });
  return resp.url;
}

// ====================== SEARCH FUNCTIONS ======================
async function searchBoards(query, limit) {
  const l = Math.min(limit, 50);
  const data = await pinterestAPI('BoardSearchResource', { query, page_size: l });
  const boards = data?.resource_response?.data || [];
  return boards.map(b => ({
    id: b.id,
    name: b.name,
    url: `https://www.pinterest.com${b.url}`,
    pinCount: b.pin_count,
    owner: b.owner?.username,
  })).slice(0, l);
}

async function searchUsers(query, limit) {
  const l = Math.min(limit, 50);
  const data = await pinterestAPI('UserSearchResource', { query, page_size: l });
  const users = data?.resource_response?.data || [];
  return users.map(u => ({
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    avatar: u.image_medium_url,
    url: `https://www.pinterest.com/${u.username}/`,
  })).slice(0, l);
}

async function searchContent(query, limit) {
  const l = Math.min(limit, 50);
  if (isPinterestUrl(query)) {
    let resolvedUrl = query;
    if (query.includes('pin.it/')) {
      resolvedUrl = await resolvePinUrl(query);
    }
    const resp = await fetch(resolvedUrl, { headers: HEADERS });
    const html = await resp.text();
    const vids = extractVidsFromHtml(html, l);
    const imgs = await extractImagesFromHTML(html, l);
    return { url: resolvedUrl, videos: vids, images: imgs };
  } else {
    const data = await pinterestAPI('SearchResource', { query, scope: 'pins', page_size: l });
    const pins = data?.resource_response?.data || [];
    return pins.map(p => ({
      id: p.id,
      title: p.title || p.grid_title || '',
      image: p.images?.orig?.url || p.images?.['736x']?.url || '',
      url: `https://www.pinterest.com/pin/${p.id}/`,
    })).slice(0, l);
  }
}

// ====================== DURABLE OBJECT (MCP SSE TRANSPORT) ======================
export class MCPObject {
  constructor(state, env) {
    this.state = state;
    this.queue = [];
    this.writer = null;
    this.keepAlive = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' },
      });
    }

    if (request.method === 'GET') {
      // SSE connection
      const { writable, readable } = new TransformStream();
      this.writer = writable.getWriter();
      const encoder = new TextEncoder();

      // Kirim endpoint event + heartbeat dalam background
      this._startHeartbeat(encoder);

      // Kirim event endpoint dengan sessionId
      const sessionId = this.state.id.name; // Sama dengan sessionId di URL
      const endpointEvent = `event: endpoint\ndata: /message?sessionId=${sessionId}\n\n`;

      try {
        await this.writer.ready;
        await this.writer.write(encoder.encode(endpointEvent));
      } catch (e) {
        // Client mungkin sudah disconnect
        this._cleanup();
        return new Response(null, { status: 500 });
      }

      // Setelah kirim endpoint, kirim antrian jika ada (biasanya kosong)
      await this._drainQueue(encoder);

      // Tunggu koneksi ditutup client
      await new Promise(resolve => {
        request.signal.addEventListener('abort', () => {
          resolve();
        });
      });

      this._cleanup();
      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    if (request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response('Invalid JSON', { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
      }

      const response = await this._handleMessage(body);
      const event = `event: message\ndata: ${JSON.stringify(response)}\n\n`;

      // Kirim event jika writer masih aktif, jika belum antri
      if (this.writer) {
        try {
          await this.writer.ready;
          await this.writer.write(new TextEncoder().encode(event));
        } catch (e) {
          // Writer closed, taruh di antrian
          this.queue.push(event);
        }
      } else {
        this.queue.push(event);
      }
      return new Response('Accepted', { status: 202, headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    return new Response('Not Found', { status: 404 });
  }

  async _startHeartbeat(encoder) {
    this.keepAlive = setInterval(() => {
      if (this.writer) {
        try {
          this.writer.write(encoder.encode(': keepalive\n\n')).catch(() => {});
        } catch (e) {
          // ignore, writer mungkin sudah ditutup
        }
      }
    }, 30000);
  }

  async _drainQueue(encoder) {
    while (this.queue.length > 0 && this.writer) {
      const msg = this.queue.shift();
      try {
        await this.writer.ready;
        await this.writer.write(encoder.encode(msg));
      } catch (e) {
        // Kembalikan ke antrian atau hentikan
        this.queue.unshift(msg);
        break;
      }
    }
  }

  _cleanup() {
    if (this.keepAlive) clearInterval(this.keepAlive);
    if (this.writer) {
      this.writer.close().catch(() => {});
      this.writer = null;
    }
  }

  async _handleMessage(msg) {
    // JSON-RPC handling
    if (msg.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '0.1.0',
          capabilities: { tools: {} },
          serverInfo: { name: 'pinterest-mcp-server', version: '1.0.0' },
        },
      };
    }

    if (msg.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            {
              name: 'pinterest_board_search',
              description: 'Search Pinterest boards by keyword',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string' },
                  limit: { type: 'number', default: 10 },
                },
                required: ['query'],
              },
            },
            {
              name: 'pinterest_user_search',
              description: 'Find Pinterest users by keyword',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string' },
                  limit: { type: 'number', default: 10 },
                },
                required: ['query'],
              },
            },
            {
              name: 'pinterest_content_search',
              description: 'Search Pinterest pins by keyword or extract media from a pin URL',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string' },
                  limit: { type: 'number', default: 10 },
                },
                required: ['query'],
              },
            },
          ],
        },
      };
    }

    if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params;
      const limit = args?.limit || 10;
      try {
        let result;
        if (name === 'pinterest_board_search') {
          result = await searchBoards(args.query, limit);
        } else if (name === 'pinterest_user_search') {
          result = await searchUsers(args.query, limit);
        } else if (name === 'pinterest_content_search') {
          result = await searchContent(args.query, limit);
        } else {
          return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Tool not found' } };
        }
        return {
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
        };
      } catch (err) {
        return { jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: err.message } };
      }
    }

    return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } };
  }
}

// ====================== WORKER ENTRY POINT ======================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/sse') {
      const sessionId = crypto.randomUUID();
      const doId = env.MCP_OBJECT.idFromName(sessionId);
      const stub = env.MCP_OBJECT.get(doId);
      return stub.fetch(request);
    }

    if (url.pathname === '/message') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) {
        return new Response('Missing sessionId', { status: 400 });
      }
      const doId = env.MCP_OBJECT.idFromName(sessionId);
      const stub = env.MCP_OBJECT.get(doId);
      return stub.fetch(request);
    }

    return new Response('MCP Pinterest Server. Use /sse to connect.', { status: 404 });
  },
};