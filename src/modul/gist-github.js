// Gist GitHub module: index_gist, read_gist, user_gist

const GITHUB_API = 'https://api.github.com';
const UA = 'CloudflareWorker/1.0';

/**
 * index_gist — list public gists dengan pagination + query filter + since
 */
async function indexGist({ per_page = 30, page = 1, query = '', since = '' }) {
  const params = new URLSearchParams();
  params.set('per_page', Math.min(per_page, 100));
  params.set('page', Math.max(page, 1));
  if (since) params.set('since', since);

  const url = `${GITHUB_API}/gists/public?${params}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': UA,
    },
  });
  if (!res.ok) {
    if (res.status === 403) throw new Error('Rate limit exceeded (60/hr unauthenticated). Wait or use a token.');
    throw new Error(`GitHub Gist API error: ${res.status}`);
  }
  let gists = await res.json();
  if (!Array.isArray(gists)) gists = [];

  // Client-side filter by query (search in description, owner login, file names)
  const q = query.toLowerCase().trim();
  if (q) {
    gists = gists.filter(g => {
      const desc = (g.description || '').toLowerCase();
      const owner = (g.owner?.login || '').toLowerCase();
      const files = Object.keys(g.files || {}).join(' ').toLowerCase();
      return desc.includes(q) || owner.includes(q) || files.includes(q);
    });
  }

  // Simplify response
  return gists.map(g => ({
    id: g.id,
    html_url: g.html_url,
    description: g.description || '',
    public: g.public,
    created_at: g.created_at,
    updated_at: g.updated_at,
    comments: g.comments,
    owner: g.owner ? { login: g.owner.login, avatar_url: g.owner.avatar_url, html_url: g.owner.html_url } : null,
    files: Object.keys(g.files || {}).map(f => ({
      filename: f,
      language: g.files[f].language || null,
      size: g.files[f].size,
      raw_url: g.files[f].raw_url,
    })),
  }));
}

/**
 * read_gist — baca gist dari URL, ambil semua kode file
 */
async function readGist(url) {
  // Extract gist ID from various URL formats
  let gistId;
  const patterns = [
    /gist\.github\.com\/([a-zA-Z0-9_-]+)\/([a-f0-9]+)/,
    /gist\.github\.com\/([a-f0-9]+)/,
    /api\.github\.com\/gists\/([a-f0-9]+)/,
    /^([a-f0-9]{32})$/,          // raw gist id
    /^([a-zA-Z0-9_-]+)\/([a-f0-9]+)$/, // owner/gist_id
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) { gistId = m[2] || m[1]; break; }
  }
  if (!gistId) throw new Error('Could not extract gist ID from URL. Provide gist URL like https://gist.github.com/abc123');

  // Fetch gist metadata
  const metaUrl = `${GITHUB_API}/gists/${gistId}`;
  const metaRes = await fetch(metaUrl, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': UA,
    },
  });
  if (!metaRes.ok) {
    if (metaRes.status === 404) throw new Error(`Gist not found: ${gistId}`);
    if (metaRes.status === 403) throw new Error('Rate limit exceeded (60/hr).');
    throw new Error(`GitHub API error: ${metaRes.status}`);
  }
  const gist = await metaRes.json();

  // Fetch each file's raw content in parallel
  const files = gist.files || {};
  const fileEntries = await Promise.all(Object.entries(files).map(async ([name, info]) => {
    let content = info.content || '';
    let truncated = info.truncated || false;
    // If truncated, fetch from raw_url
    if (truncated && info.raw_url) {
      try {
        const rawRes = await fetch(info.raw_url, { headers: { 'User-Agent': UA } });
        if (rawRes.ok) {
          content = await rawRes.text();
          truncated = false;
        }
      } catch (e) { /* keep truncated content */ }
    }
    return {
      filename: name,
      language: info.language || null,
      size: info.size,
      content,
      truncated,
    };
  }));

  return {
    id: gist.id,
    html_url: gist.html_url,
    description: gist.description || '',
    public: gist.public,
    created_at: gist.created_at,
    updated_at: gist.updated_at,
    comments: gist.comments,
    owner: gist.owner ? {
      login: gist.owner.login,
      avatar_url: gist.owner.avatar_url,
      html_url: gist.owner.html_url,
    } : null,
    files: fileEntries,
  };
}

/**
 * user_gist — list gist dari user tertentu
 */
async function userGist({ username, per_page = 30, page = 1 }) {
  const params = new URLSearchParams();
  params.set('per_page', Math.min(per_page, 100));
  params.set('page', Math.max(page, 1));

  const url = `${GITHUB_API}/users/${encodeURIComponent(username)}/gists?${params}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': UA,
    },
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error(`User "${username}" not found`);
    if (res.status === 403) throw new Error('Rate limit exceeded (60/hr).');
    throw new Error(`GitHub API error: ${res.status}`);
  }
  let gists = await res.json();
  if (!Array.isArray(gists)) gists = [];

  return gists.map(g => ({
    id: g.id,
    html_url: g.html_url,
    description: g.description || '',
    public: g.public,
    created_at: g.created_at,
    updated_at: g.updated_at,
    comments: g.comments,
    files: Object.keys(g.files || {}).map(f => ({
      filename: f,
      language: g.files[f]?.language || null,
      size: g.files[f]?.size || 0,
      raw_url: g.files[f]?.raw_url || '',
    })),
  }));
}

export const tools = [
  {
    name: 'index_gist',
    description: 'Browse & search public GitHub gists globally with pagination. Supports per_page, page, query (filter by description/owner/files), and since (ISO timestamp). Claude can set per_page and page numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', default: 30, description: 'Results per page (max 100)' },
        page: { type: 'number', default: 1, description: 'Page number' },
        query: { type: 'string', description: 'Filter gists by keyword in description, owner, or filenames' },
        since: { type: 'string', description: 'ISO 8601 timestamp: YYYY-MM-DDTHH:MM:SSZ. Only gists updated after this time.' },
      },
      required: [],
    },
  },
  {
    name: 'read_gist',
    description: 'Read a GitHub gist and get ALL file contents as complete code. Provide a gist URL like https://gist.github.com/owner/id or the gist ID directly.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Gist URL or ID (e.g. https://gist.github.com/abc123... or just the ID)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'user_gist',
    description: 'List all public gists from a specific GitHub user. Includes file info and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'GitHub username' },
        per_page: { type: 'number', default: 30, description: 'Results per page (max 100)' },
        page: { type: 'number', default: 1, description: 'Page number' },
      },
      required: ['username'],
    },
  },
];

export async function handleTool(name, args, env) {
  switch (name) {
    case 'index_gist': return indexGist(args);
    case 'read_gist': return readGist(args.url);
    case 'user_gist': return userGist(args);
    default: return null;
  }
}