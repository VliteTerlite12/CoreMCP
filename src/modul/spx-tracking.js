// SPX Tracking module: lacak_spx
// Fitur "Lacak SPX" — melacak paket Shopee Express (SPX) berdasarkan nomor resi.
// Menggunakan proxy r.jina.ai untuk mengubah seluruh isi halaman tracking SPX menjadi Markdown.
//
// Format URL:
//   https://r.jina.ai/https://spx.co.id/m/track?(RESI)
// Contoh:
//   https://r.jina.ai/https://spx.co.id/m/track?SPXID06

const JINA_PROXY = 'https://r.jina.ai';
const SPX_TRACK = 'https://spx.co.id/m/track';
const UA = 'CloudflareWorker/1.0 (CoreMCP)';

/**
 * Bangun URL proxy r.jina.ai untuk sebuah nomor resi.
 * Resi ditempel langsung setelah tanda "?" sesuai format spx.co.id/m/track.
 */
function buildProxyUrl(resi) {
  const target = `${SPX_TRACK}?${resi}`;
  return `${JINA_PROXY}/${target}`;
}

/**
 * Lacak paket SPX dan kembalikan hasil tracking dalam format Markdown.
 */
async function lacakSPX({ resi }) {
  if (!resi || typeof resi !== 'string') {
    throw new Error('Parameter "resi" wajib diisi (contoh: SPXID06).');
  }

  // Bersihkan input: buang spasi & whitespace, samakan ke huruf besar.
  const cleanResi = resi.trim().replace(/\s+/g, '').toUpperCase();
  if (!cleanResi) throw new Error('Nomor resi tidak boleh kosong.');

  const targetUrl = `${SPX_TRACK}?${cleanResi}`;
  const proxyUrl = buildProxyUrl(cleanResi);

  let res;
  try {
    res = await fetch(proxyUrl, {
      headers: {
        'User-Agent': UA,
        // Minta r.jina.ai mengembalikan Markdown bersih.
        'Accept': 'text/markdown, text/plain, */*',
        'X-Return-Format': 'markdown',
        // Halaman tracking SPX dirender via JavaScript. Minta jina.ai menunggu
        // hingga konten ter-render agar timeline tracking ikut terambil.
        'X-Timeout': '20',
      },
    });
  } catch (err) {
    throw new Error(`Gagal menghubungi proxy r.jina.ai: ${err.message}`);
  }

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('Terlalu banyak permintaan ke r.jina.ai (429). Coba lagi beberapa saat.');
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error(`Proxy/SPX sedang sibuk (${res.status}). Silakan coba lagi nanti.`);
    }
    throw new Error(`Gagal mengambil data tracking: ${res.status} ${res.statusText}`);
  }

  let markdown = (await res.text()).trim();

  if (!markdown) {
    throw new Error('Konten tracking kosong. Periksa kembali nomor resi Anda.');
  }

  return {
    resi: cleanResi,
    tracking_url: targetUrl,
    proxy_url: proxyUrl,
    format: 'markdown',
    markdown,
    note: 'Konten di atas adalah seluruh isi halaman tracking SPX yang telah dikonversi ke Markdown oleh r.jina.ai.',
  };
}

export const tools = [
  {
    name: 'lacak_spx',
    description:
      'Lacak SPX — melacak paket Shopee Express (SPX) berdasarkan nomor resi. Mengembalikan seluruh isi halaman tracking dalam format Markdown (via proxy r.jina.ai).',
    inputSchema: {
      type: 'object',
      properties: {
        resi: {
          type: 'string',
          description: 'Nomor resi SPX yang ingin dilacak. Contoh: SPXID06',
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
