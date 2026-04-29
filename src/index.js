// CoreMCP - Pinterest MCP Server
// Cloudflare Worker + Durable Object
// Transport: HTTP+SSE (spec 2024-11-05) — compatible dengan Claude.ai

const PINTEREST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ====================== CORS HEADERS ======================
function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, baggage, sentry-trace',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': '*',
  };
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

  try {
    if (method === 'notifications/initialized') {
      return null; 
    }

    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'pinterest-mcp', version: '1.0.0' },
        },
      };
    }

    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS, nextCursor: null },
      };
    }

    if (method === 'tools/call') {
      const { name, arguments: args = {} } = params || {};
      const limit = parseInt(args?.limit) || 10;
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
    }

    if (method === 'resources/list') return { jsonrpc: '2.0', id, result: { resources: [], nextCursor: null } };
    if (method === 'prompts/list') return { jsonrpc: '2.0', id, result: { prompts: [], nextCursor: null } };

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: `Internal error: ${err.message}` },
    };
  }
}

// ====================== DURABLE OBJECT ======================
// DIKEMBALIKAN KE NAMA LAMA AGAR CLOUDFLARE TIDAK ERROR (CODE 10064)
export class MCPObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.writer = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCorsHeaders(request) });
    }

    if (request.method === 'GET' && url.pathname === '/sse') {
      const { readable, writable } = new TransformStream();
      this.writer = writable.getWriter();
      
      const sessionId = url.searchParams.get('sessionId');
      const protocol = url.hostname.includes('localhost') ? 'http:' : 'https:';
      const postUrl = `${protocol}//${url.host}/message?sessionId=${sessionId}`;

      this.writer.write(new TextEncoder().encode(`event: endpoint\ndata: ${postUrl}\n\n`));

      const keepAlive = setInterval(() => {
        if (this.writer) {
          this.writer.write(new TextEncoder().encode(': keepalive\n\n')).catch(() => clearInterval(keepAlive));
        } else {
          clearInterval(keepAlive);
        }
      }, 15000);

      request.signal.addEventListener('abort', () => {
        this.writer = null;
        clearInterval(keepAlive);
      });

      return new Response(readable, {
        status: 200,
        headers: {
          ...getCorsHeaders(request),
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      });
    }

    if (request.method === 'POST' && url.pathname === '/message') {
      if (!this.writer) {
        return new Response('SSE connection not active', { status: 400, headers: getCorsHeaders(request) });
      }

      let body;
      try {
        body = await request.json();
      } catch (err) {
        return new Response('Invalid JSON', { status: 400, headers: getCorsHeaders(request) });
      }

      this.processMessage(body).catch(console.error);
      return new Response(null, { status: 202, headers: getCorsHeaders(request) });
    }

    return new Response('Not Found', { status: 404, headers: getCorsHeaders(request) });
  }

  async processMessage(body) {
    const encoder = new TextEncoder();
    const send = async (msg) => {
      if (this.writer) {
        try {
          await this.writer.write(encoder.encode(`event: message\ndata: ${JSON.stringify(msg)}\n\n`));
        } catch (e) {
          this.writer = null;
        }
      }
    };

    const messages = Array.isArray(body) ? body : [body];
    for (const msg of messages) {
      const resp = await handleMCPMessage(msg);
      if (resp !== null) await send(resp); 
    }
  }
}

// ====================== WORKER ENTRY POINT ======================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCorsHeaders(request) });
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', transport: 'SSE (2024-11-05)' }), {
        headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/sse') {
      if (request.method !== 'GET') {
        return new Response('GET required for SSE', { status: 405, headers: getCorsHeaders(request) });
      }
      
      const sessionId = crypto.randomUUID();
      const doId = env.MCP_OBJECT.idFromName(sessionId);
      const stub = env.MCP_OBJECT.get(doId);
      
      const doUrl = new URL(request.url);
      doUrl.searchParams.set('sessionId', sessionId);
      return stub.fetch(new Request(doUrl.toString(), request));
    }

    if (url.pathname === '/message') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) {
        return new Response('Missing sessionId', { status: 400, headers: getCorsHeaders(request) });
      }
      const doId = env.MCP_OBJECT.idFromName(sessionId);
      const stub = env.MCP_OBJECT.get(doId);
      return stub.fetch(request);
    }

    return new Response('Not Found', { status: 404, headers: getCorsHeaders(request) });
  },
};