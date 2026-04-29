# Pinterest MCP Server

MCP Server untuk Pinterest tanpa login, berjalan di Cloudflare Workers dengan Durable Objects.

## Cara Deploy

```bash
# 1. Install wrangler
npm install

# 2. Login ke Cloudflare
npx wrangler login

# 3. Deploy
npm run deploy
```

Setelah deploy, kamu akan dapat URL seperti:
`https://pinterest-mcp.<username>.workers.dev`

## Cara Hubungkan ke Claude.ai

1. Buka **claude.ai** → Settings → **Connectors**
2. Klik **"Add custom connector"**
3. Masukkan URL SSE: `https://pinterest-mcp.<username>.workers.dev/sse`
4. Simpan dan reconnect

## Endpoints

| Endpoint | Method | Keterangan |
|----------|--------|------------|
| `/sse` | GET | SSE stream — Claude connect ke sini |
| `/message?sessionId=<id>` | POST | Terima JSON-RPC dari Claude |
| `/health` | GET | Status server |

## Tools yang Tersedia

- `pinterest_board_search` — Cari board Pinterest
- `pinterest_user_search` — Cari user Pinterest  
- `pinterest_content_search` — Cari pin atau ekstrak media dari URL pin

## Apa yang Diperbaiki

| Masalah Lama | Perbaikan |
|---|---|
| `protocolVersion: '0.1.0'` | ✅ Diubah ke `'2024-11-05'` |
| Tidak ada handler `notifications/initialized` | ✅ Ditambahkan (return null = no response needed) |
| Tidak ada handler `ping` | ✅ Ditambahkan |
| Tidak ada handler `resources/list` & `prompts/list` | ✅ Ditambahkan |
| CORS header tidak lengkap di semua response | ✅ CORS diterapkan ke semua endpoint |
| `new_sqlite_classes` deprecated di wrangler.toml | ✅ Diubah ke `new_classes` |
| Binding nama `MCP_OBJECT` tidak konsisten | ✅ Diganti `MCP_SESSION` konsisten |
| Tidak ada `nextCursor` di tools/list | ✅ Ditambahkan `nextCursor: null` |
| Error di tools/call tidak sesuai spec | ✅ Pakai format `isError: true` |
| Heartbeat 30s bisa timeout Cloudflare | ✅ Dikurangi jadi 25 detik |
