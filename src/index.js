/**
 * CoreMCP – Router Utama
 * Transport: HTTP+SSE + Streamable HTTP (/mcp)
 * Modul: wikipedia, pinterest, jadwaltv
 */

import { tools as wikiTools, handleTool as wikiHandler } from './modul/wikipedia.js';
import { tools as pinTools, handleTool as pinHandler } from './modul/pinterest.js';
import { tools as tvTools, handleTool as tvHandler } from './modul/jadwaltv.js';

const UA = 'CloudflareWorker/1.0 (CoreMCP)';
const ALL_TOOLS = [...wikiTools, ...pinTools, ...tvTools];

// ========== CORS ==========
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

// ========== HANDLER TOOLS ==========
async function callTool(name, args, env) {
  // Coba setiap modul secara bergantian
  let result = await wikiHandler(name, args, env);
  if (result !== null) return result;
  result = await pinHandler(name, args, env);
  if (result !== null) return result;
  result = await tvHandler(name, args, env);
  if (result !== null) return result;
  throw new Error(`Unknown tool: ${name}`);
}

// ========== MCP Message Handler ==========
async function handleMCPMessage(msg, env) {
  const { method, id, params } = msg;
  try {
    if (method === 'notifications/initialized') return null;
    if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'core-mcp', version: '2.1.0' },
        },
      };
    }
    if (method === 'tools/list')
      return { jsonrpc: '2.0', id, result: { tools: ALL_TOOLS, nextCursor: null } };

    if (method === 'tools/call') {
      const { name, arguments: args = {} } = params || {};
      const result = await callTool(name, args, env);
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false },
      };
    }

    if (method === 'resources/list')
      return { jsonrpc: '2.0', id, result: { resources: [], nextCursor: null } };
    if (method === 'prompts/list')
      return { jsonrpc: '2.0', id, result: { prompts: [], nextCursor: null } };
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  } catch (err) {
    return { jsonrpc: '2.0', id, error: { code: -32603, message: `Internal error: ${err.message}` } };
  }
}

// ========== DURABLE OBJECT ==========
export class MCPObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.writer = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: getCorsHeaders(request) });

    if (url.pathname === '/sse' && request.method === 'GET') {
      const { readable, writable } = new TransformStream();
      this.writer = writable.getWriter();
      const sessionId = url.searchParams.get('sessionId');
      const protocol = url.hostname.includes('localhost') ? 'http:' : 'https:';
      const postUrl = `${protocol}//${url.host}/message?sessionId=${sessionId}`;

      const encoder = new TextEncoder();
      this.writer.write(encoder.encode(`event: endpoint\ndata: ${postUrl}\n\n`));

      const keepAlive = setInterval(() => {
        if (this.writer) this.writer.write(encoder.encode(': keepalive\n\n')).catch(() => clearInterval(keepAlive));
        else clearInterval(keepAlive);
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
          'Connection': 'keep-alive',
        },
      });
    }

    if (url.pathname === '/message' && request.method === 'POST') {
      if (!this.writer) return new Response('SSE connection not active', { status: 400, headers: getCorsHeaders(request) });
      let body;
      try { body = await request.json(); } catch (e) { return new Response('Invalid JSON', { status: 400, headers: getCorsHeaders(request) }); }
      this.processMessage(body).catch(console.error);
      return new Response(null, { status: 202, headers: getCorsHeaders(request) });
    }

    return new Response('Not Found', { status: 404, headers: getCorsHeaders(request) });
  }

  async processMessage(body) {
    const encoder = new TextEncoder();
    const send = async (msg) => {
      if (this.writer) {
        try { await this.writer.write(encoder.encode(`event: message\ndata: ${JSON.stringify(msg)}\n\n`)); }
        catch (e) { this.writer = null; }
      }
    };
    const messages = Array.isArray(body) ? body : [body];
    for (const msg of messages) {
      const resp = await handleMCPMessage(msg, this.env);
      if (resp !== null) await send(resp);
    }
  }
}

// ========== WORKER FETCH ==========
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: getCorsHeaders(request) });

    // Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        transport: 'SSE+Streamable',
        server: 'core-mcp',
        version: '2.1.0',
        tools: ALL_TOOLS.map(t => t.name),
      }), { headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' } });
    }

    // Streamable HTTP /mcp
    if (url.pathname === '/mcp') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: getCorsHeaders(request) });
      if (request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch (e) { return new Response('Invalid JSON', { status: 400, headers: getCorsHeaders(request) }); }
        const isBatch = Array.isArray(body);
        const messages = isBatch ? body : [body];
        const results = [];
        for (const msg of messages) {
          const resp = await handleMCPMessage(msg, env);
          results.push(resp);
        }
        const filtered = results.filter(r => r !== null);
        const responseBody = isBatch ? filtered : (filtered[0] || {});
        return new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' },
        });
      }
      return new Response('Method Not Allowed', { status: 405, headers: getCorsHeaders(request) });
    }

    // SSE (entry point untuk membuat session baru)
    if (url.pathname === '/sse') {
      if (request.method !== 'GET') return new Response('GET required for SSE', { status: 405, headers: getCorsHeaders(request) });
      const sessionId = crypto.randomUUID();
      const doId = env.MCP_OBJECT.idFromName(sessionId);
      const stub = env.MCP_OBJECT.get(doId);
      const doUrl = new URL(request.url);
      doUrl.searchParams.set('sessionId', sessionId);
      return stub.fetch(new Request(doUrl.toString(), request));
    }

    // SSE message posting
    if (url.pathname === '/message') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) return new Response('Missing sessionId', { status: 400, headers: getCorsHeaders(request) });
      const doId = env.MCP_OBJECT.idFromName(sessionId);
      const stub = env.MCP_OBJECT.get(doId);
      return stub.fetch(request);
    }

    return new Response('Not Found', { status: 404, headers: getCorsHeaders(request) });
  },
};