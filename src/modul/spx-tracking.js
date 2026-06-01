// SPX Tracking module: lacak_spx
// Menggunakan proxy r.jina.ai untuk mengonversi halaman HTML tracking ke Markdown

const JINA_PROXY = 'https://r.jina.ai';
const SPX_BASE = 'https://spx.co.id/m/track';

async function lacakSPX({ resi }) {
  // Bersihkan input resi
  const cleanResi = resi.trim();
  if (!cleanResi) throw new Error('Nomor resi tidak boleh kosong');

  const targetUrl = `${SPX_BASE}?${encodeURIComponent(cleanResi)}`;
  const proxyUrl = `${JINA_PROXY}/${targetUrl}`;

  const res = await fetch(proxyUrl, {
    headers: {
      'User-Agent': 'CloudflareWorker/1.0',
      'Accept': 'text/markdown, text/html, */*',
    },
  });

  if (!res.ok) {
    if (res.status === 502 || res.status === 504) {
      throw new Error(`Gagal mengambil data tracking (${res.status}). Server proxy atau SPX mungkin sedang sibuk. Coba lagi nanti.`);
    }
    throw new Error(`Gagal mengambil data tracking: ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type') || '';
  let markdown = await res.text();

  // Jina.ai biasanya mengembalikan Markdown, tapi jika HTML, beri tahu pengguna
  if (contentType.includes('text/html') && !markdown.startsWith('http')) {
    markdown = `⚠️ Proxy mengembalikan HTML, bukan Markdown. Mentahan HTML:\n\n\`\`\`html\n${markdown.slice(0, 10000)}\n\`\`\``;
  }

  return {
    resi: cleanResi,
    tracking_url: targetUrl,
    markdown,
    note: 'Konten di atas adalah hasil konversi halaman tracking SPX ke format Markdown oleh r.jina.ai.',
  };
}

export const tools = [
  {
    name: 'lacak_spx',
    description: 'Lacak paket SPX dengan nomor resi. Mengembalikan informasi tracking lengkap dalam format Markdown (melalui proxy r.jina.ai).',
    inputSchema: {
      type: 'object',
      properties: {
        resi: {
          type: 'string',
          description: 'Nomor resi SPX (contoh: SPXID00000000)',
        },
      },
      required: ['resi'],
    },
  },
];

export async function handleTool(name, args, env) {
  switch (name) {
    case 'lacak_spx':
      return lacakSPX(args);
    default:
      return null;
  }
}
