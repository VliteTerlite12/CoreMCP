// CoreMCP - Pinterest MCP Server
// Cloudflare Worker + Durable Object
// Transport: HTTP+SSE (spec 2024-11-05) — compatible dengan Claude.ai

const PINTEREST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ====================== CORS HEADERS ======================
// Semua response HARUS punya ini agar Claude.ai bisa akses
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Cache-Control',
};

function corsResponse(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extra },
  });
}

// ====================== PINTEREST API ======================
async function pinterestAPI(resource, options) {
  const url = `https://www.pinterest.com/resource/${resource}/get/`;
  const params = new URLSearchParams({
    data: JSON.stringify({ options, context: {} }),
    _: Date.now(),
  });
  const res = await fetch(`${url}?${params}`, {
    headers: {
      ...PINTEREST_HEADERS,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Pinterest API error: ${res.status}`);
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
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    vids.push({ video: m[0].replace(/\/\d+p\//, '/720p/'), original: m[0] });
    if (vids.length >= limit) break;
  }
  return vids;
}

class ImgExtractor {
  constructor() { this.srcs = []; }
  element(el) {
    const src = el.getAttribute('src');
    if (src) this.srcs.push(src);
  }
}

async function extractImagesFromHTML(html, limit) {
  const handler = new ImgExtractor();
  await new HTMLRewriter().on('img', handler).transform(new Response(html)).text();
  return [...new Set(handler.srcs.filter(isValidPin).map(toOriginal))].slice(0, limit);
}

function isPinterestUrl(q) {
  return q.includes('pinterest.com/pin/') || q.includes('pin.it/');
}

async function resolvePinUrl(shortUrl) {
  const resp = await fetch(shortUrl, { headers: PINTEREST_HEADERS, redirect: 'follow' });
  return resp.url;
}

// ====================== SEARCH FUNCTIONS ======================
async function searchBoards(query, limit = 10) {
  const l = Math.min(limit, 50);
  const data = await pinterestAPI('BoardSearchResource', { query, page_size: l });
  return (data?.resource_response?.data || [])
    .slice(0, l)
    .map(b => ({
      id: b.id,
      name: b.name,
      url: `https://www.pinterest.com${b.url}`,
      pinCount: b.pin_count,
      owner: b.owner?.username,
    }));
}

async function searchUsers(query, limit = 10) {
  const l = Math.min(limit, 50);
  const data = await pinterestAPI('UserSearchResource', { query, page_size: l });
  return (data?.resource_response?.data || [])
    .slice(0, l)
    .map(u => ({
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      avatar: u.image_medium_url,
      url: `https://www.pinterest.com/${u.username}/`,
    }));
}

async function searchContent(query, limit = 10) {
  const l = Math.min(limit, 50);
  if (isPinterestUrl(query)) {
    const resolvedUrl = query.includes('pin.it/') ? await resolvePinUrl(query) : query;
    const resp = await fetch(resolvedUrl, { headers: PINTEREST_HEADERS });
    const html = await resp.text();
    return {
      url: resolvedUrl,
      videos: extractVidsFromHtml(html, l),
      images: await extractImagesFromHTML(html, l),
    };
  }
  const data = await pinterestAPI('SearchResource', { query, scope: 'pins', page_size: l });
  return (data?.resource_response?.data || [])
    .slice(0, l)
    .map(p => ({
      id: p.id,
      title: p.title || p.grid_title || '',
      image: p.images?.orig?.url || p.images?.['736x']?.url || '',
      url: `https://www.pinterest.com/pin/${p.id}/`,
    }));
}

// ====================== TOOL DEFINITIONS ======================
const TOOLS = [
  {
    name: 'pinterest_board_search',
    description: 'Search Pinterest boards by keyword. Returns board name, URL, pin count, and owner.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to search for boards' },
        limit: { type: 'number', description: 'Max results (1-50)', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'pinterest_user_search',
    description: 'Find Pinterest users by keyword. Returns username, full name, avatar, and profile URL.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to search for users' },
        limit: { type: 'number', description: 'Max results (1-50)', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'pinterest_content_search',
    description: 'Search Pinterest pins by keyword, OR extract images/videos from a Pinterest pin URL or pin.it short link.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword or Pinterest pin URL / pin.it link' },
        limit: { type: 'number', description: 'Max results (1-50)', default: 10 },
      },
      required: ['query'],
    },
  },
];

// ====================== MCP MESSAGE HANDLER ======================
async function handleMCPMessage(msg) {
  const { method, id, params } = msg;

  // PENTING: Claude kirim notifikasi ini setelah initialize — harus di-handle
  if (method === 'notifications/initialized') {
    return null; // Notifikasi tidak perlu response
  }

  // Ping — Claude kadang kirim ini untuk cek koneksi
  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        // PENTING: Versi protokol HARUS persis seperti ini
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: { listChanged: false },
          resources: {},
          prompts: {},
          logging: {},
        },
        serverInfo: {
          name: 'pinterest-mcp-server',
          version: '1.0.0',
        },
      },
    };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: TOOLS,
        // nextCursor harus ada (null = tidak ada halaman lagi)
        nextCursor: null,
      },
    };
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params || {};
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
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Unknown tool: ${name}` },
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: false,
        },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        },
      };
    }
  }

  // Resources & prompts — Claude kadang tanya ini
  if (method === 'resources/list') {
    return { jsonrpc: '2.0', id, result: { resources: [], nextCursor: null } };
  }
  if (method === 'prompts/list') {
    return { jsonrpc: '2.0', id, result: { prompts: [], nextCursor: null } };
  }

  // Method tidak dikenal
  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

// ====================== DURABLE OBJECT ======================
export class MCPSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.writer = null;
    this.encoder = new TextEncoder();
    this.queue = [];
    this.heartbeatTimer = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // OPTIONS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // GET /sse — buka SSE stream
    if (request.method === 'GET') {
      return this._openSSE(request);
    }

    // POST /message — terima pesan dari client
    if (request.method === 'POST') {
      return this._receiveMessage(request);
    }

    return new Response('Method Not Allowed', { status: 405, headers: CORS });
  }

  _openSSE(request) {
    const { writable, readable } = new TransformStream();
    this.writer = writable.getWriter();
    const sessionId = this.state.id.name;

    // Jalankan async di background — JANGAN await di sini (deadlock)
    (async () => {
      try {
        // 1. Kirim endpoint event — Claude butuh ini untuk tahu ke mana POST
        // Format: event: endpoint\ndata: <url>\n\n
        await this._send(`event: endpoint\ndata: /message?sessionId=${sessionId}\n\n`);

        // 2. Drain queue (pesan yang datang sebelum SSE terbuka)
        await this._drainQueue();

        // 3. Heartbeat setiap 25 detik (Cloudflare timeout = 30 detik)
        this.heartbeatTimer = setInterval(() => {
          this._send(': ping\n\n').catch(() => this._cleanup());
        }, 25000);

        // 4. Tunggu disconnect
        await new Promise(resolve => request.signal.addEventListener('abort', resolve));
      } finally {
        this._cleanup();
      }
    })();

    return new Response(readable, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  async _receiveMessage(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return corsResponse(JSON.stringify({ error: 'Invalid JSON' }), 400);
    }

    // Handle array (batch) atau single message
    const messages = Array.isArray(body) ? body : [body];
    const responses = [];

    for (const msg of messages) {
      const response = await handleMCPMessage(msg);
      if (response !== null) responses.push(response);
    }

    // Kirim setiap response sebagai SSE event
    for (const resp of responses) {
      const event = `event: message\ndata: ${JSON.stringify(resp)}\n\n`;
      if (this.writer) {
        await this._send(event);
      } else {
        this.queue.push(event);
      }
    }

    return new Response('', { status: 202, headers: CORS });
  }

  async _send(text) {
    if (!this.writer) return;
    try {
      await this.writer.ready;
      await this.writer.write(this.encoder.encode(text));
    } catch {
      this._cleanup();
    }
  }

  async _drainQueue() {
    while (this.queue.length > 0 && this.writer) {
      const msg = this.queue.shift();
      await this._send(msg);
    }
  }

  _cleanup() {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.writer) { this.writer.close().catch(() => {}); this.writer = null; }
  }
}

// ====================== WORKER ENTRY POINT ======================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // OPTIONS untuk semua path
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return corsResponse(JSON.stringify({
        name: 'pinterest-mcp-server',
        version: '1.0.0',
        status: 'ok',
        transport: 'SSE (2024-11-05)',
        endpoints: { sse: '/sse', message: '/message?sessionId=<id>' },
      }));
    }

    // SSE endpoint — Claude.ai connect ke sini
    if (url.pathname === '/sse') {
      if (request.method !== 'GET') {
        return new Response('GET required for SSE', { status: 405, headers: CORS });
      }
      const sessionId = crypto.randomUUID();
      const doId = env.MCP_SESSION.idFromName(sessionId);
      const stub = env.MCP_SESSION.get(doId);
      return stub.fetch(request);
    }

    // Message endpoint — Claude.ai POST ke sini
    if (url.pathname === '/message') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) {
        return corsResponse(JSON.stringify({ error: 'Missing sessionId' }), 400);
      }
      const doId = env.MCP_SESSION.idFromName(sessionId);
      const stub = env.MCP_SESSION.get(doId);
      return stub.fetch(request);
    }

    return corsResponse(JSON.stringify({
      error: 'Not Found',
      hint: 'Connect to /sse to start an MCP session',
    }), 404);
  },
};
