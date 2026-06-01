// SPX Tracking module

async function trackSPX(resi) {
  const url = `https://r.jina.ai/https://spx.co.id/m/track?${encodeURIComponent(resi)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'CloudflareWorker/1.0' } });

  if (!res.ok) {
    throw new Error(`SPX tracking error: ${res.status}`);
  }

  const text = await res.text();
  return text;
}

export const tools = [
  {
    name: 'track_spx',
    description: 'Track SPX Express shipment by RESI (tracking number). Returns tracking details in Markdown format.',
    inputSchema: {
      type: 'object',
      properties: {
        resi: { type: 'string', description: 'The SPX tracking number (e.g. SPXID066965582086)' },
      },
      required: ['resi'],
    },
  },
];

export async function handleTool(name, args, env) {
  switch (name) {
    case 'track_spx': return trackSPX(args.resi);
    default: return null;
  }
}
