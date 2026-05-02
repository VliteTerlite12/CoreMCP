# CoreMCP — Modular MCP Server for Cloudflare Workers

Server Model Context Protocol (MCP) untuk Cloudflare Workers, dengan **HTTP+SSE** dan **Streamable HTTP** (`/mcp`) — kompatibel dengan Claude.ai, GitHub Copilot, dan klien MCP lainnya.

## Fitur

| Modul | Tools | Sumber |
|-------|-------|--------|
| 📚 **Wikipedia** | `wiki_quick` `wiki_readmore` `wiki_deep` | EN + ID |
| 📌 **Pinterest** | `pinterest_user_search` `pinterest_global_search` | api.siputzx.my.id |
| 📺 **Jadwal TV** | `list_channeltv` `rincian_jadwaltv` | api.siputzx.my.id |
| 📝 **Gist GitHub** | `index_gist` `read_gist` `user_gist` | api.github.com/gists |
| 🐙 **GitHub** | `github_user_profile` `github_user_repos` `github_search_repos` `github_search_users` `github_search_code` `github_repo_info` `github_repo_readme` `github_repo_contents` `github_repo_releases` `github_repo_contributors` `github_repo_languages` `github_repo_commits` `github_org_repos` `github_public_events` | api.github.com |

## Struktur

```
src/
index.js          → Router MCP, Durable Object, SSE & /mcp
modul/
wikipedia.js    → Wikipedia EN + ID
pinterest.js    → Pinterest user & search
jadwaltv.js     → Jadwal TV Indonesia
gist-github.js  → GitHub Gist
github.js       → GitHub anonymous API
```

## Rate Limits

- **Wikipedia**: No rate limit
- **Pinterest/TV**: No strict limit (via proxy)
- **GitHub anonymous**: **60 req/jam per IP**. Untuk production, tambahkan token di env vars.
- **GitHub Search**: 10 req/menit (unauthenticated)

## Cara Deploy

1. `npm install -g wrangler`
2. Konfigurasi `wrangler.toml`
3. `wrangler deploy`

## Penggunaan

- **Claude.ai**: `POST https://<worker>/mcp`
- **SSE**: `GET /sse` lalu `POST /message?sessionId=...`

## Menambah Modul

1. Buat file di `src/modul/`
2. Ekspor `tools` (array definisi) dan `handleTool(name, args, env)`
3. Import di `src/index.js`, tambahkan ke `ALL_TOOLS` dan rantai handler.