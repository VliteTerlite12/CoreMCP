// Jadwal TV module: list_channeltv, rincian_jadwaltv

const BASE = 'https://api.siputzx.my.id/api/info/jadwaltv';

async function listChanneltv() {
  const res = await fetch(BASE, { headers: { 'User-Agent': 'CloudflareWorker/1.0' } });
  if (!res.ok) throw new Error(`TV schedule API error: ${res.status}`);
  const json = await res.json();
  if (!json.status) throw new Error('API returned error');
  return json.data;
}

async function rincianJadwaltv(channel) {
  const url = `${BASE}?channel=${encodeURIComponent(channel)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'CloudflareWorker/1.0' } });
  if (!res.ok) throw new Error(`TV schedule detail error: ${res.status}`);
  const json = await res.json();
  if (!json.status) throw new Error('API returned error');
  return json.data;
}

export const tools = [
  {
    name: 'list_channeltv',
    description: 'Get today\'s TV schedule for all Indonesian channels. Returns an array of channels with their programs and times.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'rincian_jadwaltv',
    description: 'Get full day schedule for a specific TV channel (e.g. "RTV", "SCTV"). Returns list of programs with times.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name, e.g. "RTV"' },
      },
      required: ['channel'],
    },
  },
];

export async function handleTool(name, args, env) {
  switch (name) {
    case 'list_channeltv': return listChanneltv();
    case 'rincian_jadwaltv': return rincianJadwaltv(args.channel);
    default: return null;
  }
}