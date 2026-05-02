// GitHub module: anonymous public API tools

const GITHUB_API = 'https://api.github.com';
const UA = 'CloudflareWorker/1.0';
const HEADERS = {
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': UA,
};

async function ghGet(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const url = `${GITHUB_API}${path}${qs.toString() ? '?' + qs : ''}`;
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 403) throw new Error('Rate limit exceeded (60/hr unauthenticated). Try again later.');
  if (res.status === 404) throw new Error(`Not found: ${path}`);
  if (!res.ok) throw new Error(`GitHub API error ${res.status} on ${path}`);
  return res.json();
}

// ─── User ───

async function githubUserProfile(username) {
  const user = await ghGet(`/users/${encodeURIComponent(username)}`);
  return {
    login: user.login, id: user.id, name: user.name, bio: user.bio,
    avatar_url: user.avatar_url, html_url: user.html_url, blog: user.blog,
    location: user.location, company: user.company, email: user.email,
    twitter_username: user.twitter_username,
    public_repos: user.public_repos, public_gists: user.public_gists,
    followers: user.followers, following: user.following,
    created_at: user.created_at, updated_at: user.updated_at,
  };
}

async function githubUserRepos({ username, type = 'owner', sort = 'updated', direction = 'desc', per_page = 30, page = 1 }) {
  const repos = await ghGet(`/users/${encodeURIComponent(username)}/repos`, { type, sort, direction, per_page: Math.min(per_page, 100), page });
  return (repos || []).map(r => ({
    name: r.name, full_name: r.full_name, private: r.private,
    html_url: r.html_url, description: r.description, fork: r.fork,
    language: r.language, stargazers_count: r.stargazers_count,
    watchers_count: r.watchers_count, forks_count: r.forks_count,
    open_issues_count: r.open_issues_count,
    topics: r.topics || [], license: r.license?.spdx_id || null,
    created_at: r.created_at, updated_at: r.updated_at, pushed_at: r.pushed_at,
    owner: { login: r.owner?.login, avatar_url: r.owner?.avatar_url },
  }));
}

// ─── Search ───

async function githubSearchRepos({ query, sort = '', order = 'desc', per_page = 30, page = 1 }) {
  const data = await ghGet('/search/repositories', { q: query, sort: sort || undefined, order, per_page: Math.min(per_page, 100), page });
  return {
    total_count: data.total_count,
    incomplete_results: data.incomplete_results,
    items: (data.items || []).map(r => ({
      full_name: r.full_name, html_url: r.html_url, description: r.description,
      language: r.language, stargazers_count: r.stargazers_count,
      forks_count: r.forks_count, topics: r.topics || [],
      owner: { login: r.owner?.login, avatar_url: r.owner?.avatar_url },
      created_at: r.created_at, updated_at: r.updated_at,
    })),
  };
}

async function githubSearchUsers({ query, sort = '', order = 'desc', per_page = 30, page = 1 }) {
  const data = await ghGet('/search/users', { q: query, sort: sort || undefined, order, per_page: Math.min(per_page, 100), page });
  return {
    total_count: data.total_count,
    incomplete_results: data.incomplete_results,
    items: (data.items || []).map(u => ({
      login: u.login, avatar_url: u.avatar_url, html_url: u.html_url,
      score: u.score,
    })),
  };
}

async function githubSearchCode({ query, per_page = 30, page = 1 }) {
  const data = await ghGet('/search/code', { q: query, per_page: Math.min(per_page, 100), page });
  return {
    total_count: data.total_count,
    incomplete_results: data.incomplete_results,
    items: (data.items || []).map(c => ({
      name: c.name, path: c.path, html_url: c.html_url,
      repository: { full_name: c.repository?.full_name, html_url: c.repository?.html_url },
      score: c.score,
    })),
  };
}

// ─── Repository ───

async function githubRepoInfo({ owner, repo }) {
  const r = await ghGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  return {
    full_name: r.full_name, html_url: r.html_url, description: r.description,
    private: r.private, fork: r.fork,
    language: r.language, license: r.license?.spdx_id || null,
    stargazers_count: r.stargazers_count, watchers_count: r.watchers_count,
    forks_count: r.forks_count, open_issues_count: r.open_issues_count,
    topics: r.topics || [], default_branch: r.default_branch,
    subscribers_count: r.subscribers_count,
    created_at: r.created_at, updated_at: r.updated_at, pushed_at: r.pushed_at,
    owner: { login: r.owner?.login, avatar_url: r.owner?.avatar_url, html_url: r.owner?.html_url },
  };
}

async function githubRepoReadme({ owner, repo }) {
  const data = await ghGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`);
  let content = '';
  if (data.content) {
    content = atob(data.content.replace(/\n/g, ''));
  }
  return {
    name: data.name, path: data.path, size: data.size,
    html_url: data.html_url, download_url: data.download_url,
    content: content.slice(0, 50000),
    content_truncated: content.length > 50000,
  };
}

async function githubRepoContents({ owner, repo, path = '' }) {
  const data = await ghGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`);
  if (Array.isArray(data)) {
    return data.map(f => ({
      name: f.name, path: f.path, type: f.type, size: f.size,
      html_url: f.html_url, download_url: f.download_url,
    }));
  } else {
    let content = '';
    if (data.content) content = atob(data.content.replace(/\n/g, ''));
    return {
      name: data.name, path: data.path, size: data.size,
      html_url: data.html_url, download_url: data.download_url,
      content: content.slice(0, 50000),
      content_truncated: content.length > 50000,
    };
  }
}

async function githubRepoReleases({ owner, repo, per_page = 10, page = 1 }) {
  const data = await ghGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`, { per_page: Math.min(per_page, 100), page });
  return (data || []).map(r => ({
    tag_name: r.tag_name, name: r.name, html_url: r.html_url,
    prerelease: r.prerelease, draft: r.draft,
    created_at: r.created_at, published_at: r.published_at,
    body: (r.body || '').slice(0, 2000),
    assets: (r.assets || []).map(a => ({ name: a.name, size: a.size, download_count: a.download_count, browser_download_url: a.browser_download_url })),
  }));
}

async function githubRepoContributors({ owner, repo, per_page = 30, page = 1 }) {
  const data = await ghGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contributors`, { per_page: Math.min(per_page, 100), page });
  return (data || []).map(c => ({
    login: c.login, avatar_url: c.avatar_url, html_url: c.html_url,
    contributions: c.contributions,
  }));
}

async function githubRepoLanguages({ owner, repo }) {
  return ghGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`);
}

async function githubRepoCommits({ owner, repo, per_page = 30, page = 1, sha = '' }) {
  const params = { per_page: Math.min(per_page, 100), page };
  if (sha) params.sha = sha;
  const data = await ghGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`, params);
  return (data || []).map(c => ({
    sha: c.sha, html_url: c.html_url,
    message: c.commit?.message?.split('\n')[0] || '',
    author: { name: c.commit?.author?.name, date: c.commit?.author?.date },
    committer: { login: c.committer?.login, avatar_url: c.committer?.avatar_url },
  }));
}

// ─── Organization ───

async function githubOrgRepos({ org, type = 'public', sort = 'updated', direction = 'desc', per_page = 30, page = 1 }) {
  const repos = await ghGet(`/orgs/${encodeURIComponent(org)}/repos`, { type, sort, direction, per_page: Math.min(per_page, 100), page });
  return (repos || []).map(r => ({
    name: r.name, full_name: r.full_name, html_url: r.html_url,
    description: r.description, language: r.language,
    stargazers_count: r.stargazers_count, forks_count: r.forks_count,
    topics: r.topics || [], updated_at: r.updated_at,
  }));
}

// ─── Events ───

async function githubPublicEvents({ per_page = 30, page = 1 }) {
  const data = await ghGet('/events', { per_page: Math.min(per_page, 100), page });
  return (data || []).map(e => ({
    id: e.id, type: e.type,
    actor: { login: e.actor?.login, avatar_url: e.actor?.avatar_url },
    repo: { name: e.repo?.name, url: e.repo?.url },
    created_at: e.created_at,
    payload: e.payload ? { action: e.payload.action, ref: e.payload.ref, ref_type: e.payload.ref_type } : null,
  }));
}

// ─── Tools ───

export const tools = [
  {
    name: 'github_user_profile',
    description: 'Get public GitHub profile info for any user: name, bio, avatar, repos, followers, etc.',
    inputSchema: {
      type: 'object',
      properties: { username: { type: 'string', description: 'GitHub username' } },
      required: ['username'],
    },
  },
  {
    name: 'github_user_repos',
    description: 'List public repositories of a GitHub user with sorting and pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string' },
        type: { type: 'string', default: 'owner', description: 'owner, member, all' },
        sort: { type: 'string', default: 'updated', description: 'created, updated, pushed, full_name' },
        direction: { type: 'string', default: 'desc', description: 'asc or desc' },
        per_page: { type: 'number', default: 30 },
        page: { type: 'number', default: 1 },
      },
      required: ['username'],
    },
  },
  {
    name: 'github_search_repos',
    description: 'Search public repositories on GitHub. Supports full search qualifiers (language:xxx, stars:>100, topic:xxx, etc).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query with optional qualifiers' },
        sort: { type: 'string', default: '', description: 'stars, forks, updated, or empty for best match' },
        order: { type: 'string', default: 'desc' },
        per_page: { type: 'number', default: 30 },
        page: { type: 'number', default: 1 },
      },
      required: ['query'],
    },
  },
  {
    name: 'github_search_users',
    description: 'Search GitHub users. Supports qualifiers like type:user, followers:>100, location:indonesia.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        sort: { type: 'string', default: '', description: 'followers, repositories, joined' },
        order: { type: 'string', default: 'desc' },
        per_page: { type: 'number', default: 30 },
        page: { type: 'number', default: 1 },
      },
      required: ['query'],
    },
  },
  {
    name: 'github_search_code',
    description: 'Search code on GitHub. Requires at least one search term. Supports language:, repo:, path: qualifiers.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (must include a search term, not just qualifiers)' },
        per_page: { type: 'number', default: 30 },
        page: { type: 'number', default: 1 },
      },
      required: ['query'],
    },
  },
  {
    name: 'github_repo_info',
    description: 'Get detailed metadata for a GitHub repository: stars, forks, topics, license, description, dates.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (user or org)' },
        repo: { type: 'string', description: 'Repository name' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'github_repo_readme',
    description: 'Get the README content of a GitHub repository. Returns full text (up to 50K chars).',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'github_repo_contents',
    description: 'List a directory in a repo or get a file\'s content. Leave path empty for root.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        path: { type: 'string', default: '', description: 'File/directory path (empty = root)' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'github_repo_releases',
    description: 'List releases of a GitHub repository with tag names, release notes, and download assets.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        per_page: { type: 'number', default: 10 },
        page: { type: 'number', default: 1 },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'github_repo_contributors',
    description: 'List top contributors to a GitHub repository with contribution counts.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        per_page: { type: 'number', default: 30 },
        page: { type: 'number', default: 1 },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'github_repo_languages',
    description: 'Get programming language breakdown of a repository (bytes per language).',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'github_repo_commits',
    description: 'List recent commits on a repository. Optionally specify a branch SHA.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        per_page: { type: 'number', default: 30 },
        page: { type: 'number', default: 1 },
        sha: { type: 'string', description: 'Branch name or SHA (optional)' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'github_org_repos',
    description: 'List public repositories of a GitHub organization with sorting.',
    inputSchema: {
      type: 'object',
      properties: {
        org: { type: 'string' },
        type: { type: 'string', default: 'public' },
        sort: { type: 'string', default: 'updated' },
        direction: { type: 'string', default: 'desc' },
        per_page: { type: 'number', default: 30 },
        page: { type: 'number', default: 1 },
      },
      required: ['org'],
    },
  },
  {
    name: 'github_public_events',
    description: 'List recent public events on GitHub (global activity feed). Shows what users are starring, forking, pushing, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', default: 30, description: 'Max 100' },
        page: { type: 'number', default: 1 },
      },
      required: [],
    },
  },
];

export async function handleTool(name, args, env) {
  switch (name) {
    case 'github_user_profile': return githubUserProfile(args.username);
    case 'github_user_repos': return githubUserRepos(args);
    case 'github_search_repos': return githubSearchRepos(args);
    case 'github_search_users': return githubSearchUsers(args);
    case 'github_search_code': return githubSearchCode(args);
    case 'github_repo_info': return githubRepoInfo(args);
    case 'github_repo_readme': return githubRepoReadme(args);
    case 'github_repo_contents': return githubRepoContents(args);
    case 'github_repo_releases': return githubRepoReleases(args);
    case 'github_repo_contributors': return githubRepoContributors(args);
    case 'github_repo_languages': return githubRepoLanguages(args);
    case 'github_repo_commits': return githubRepoCommits(args);
    case 'github_org_repos': return githubOrgRepos(args);
    case 'github_public_events': return githubPublicEvents(args);
    default: return null;
  }
}