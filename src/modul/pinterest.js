// Pinterest module: pinterest_user_search, pinterest_global_search

async function pinterestUserSearch(username) {
  const url = `https://api.siputzx.my.id/api/stalk/pinterest?q=${encodeURIComponent(username)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'CloudflareWorker/1.0' } });
  if (!res.ok) throw new Error(`Pinterest user API error: ${res.status}`);
  const json = await res.json();
  if (!json.status) throw new Error('Pinterest API returned error');
  return json.data;
}

async function pinterestGlobalSearch(query, limit = 30) {
  const url = `https://api.siputzx.my.id/api/s/pinterest?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'CloudflareWorker/1.0' } });
  if (!res.ok) throw new Error(`Pinterest search API error: ${res.status}`);
  const json = await res.json();
  if (!json.status) throw new Error('Pinterest API returned error');
  return (json.data || []).slice(0, Math.min(limit, 50));
}

export const tools = [
  {
    name: 'pinterest_user_search',
    description: 'Get detailed Pinterest user profile by username. Returns full name, bio, stats, images, social links.',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Pinterest username' },
      },
      required: ['username'],
    },
  },
  {
    name: 'pinterest_global_search',
    description: 'Search Pinterest globally for pins. Returns image URL, description, pinner info, board, reactions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', default: 30, description: 'Max results (1-50)' },
      },
      required: ['query'],
    },
  },
];

export async function handleTool(name, args, env) {
  switch (name) {
    case 'pinterest_user_search': return pinterestUserSearch(args.username);
    case 'pinterest_global_search': return pinterestGlobalSearch(args.query, args.limit ?? 30);
    default: return null;
  }
}