// Wikipedia module: wiki_quick, wiki_readmore, wiki_deep

const UA = 'CloudflareWorker/1.0';

async function wikiSearch(query, lang, limit = 10) {
  const api = `https://${lang}.wikipedia.org/w/api.php`;
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: Math.min(limit, 50),
    format: 'json',
    origin: '*',
  });
  params.append('prop', 'pageimages');
  params.append('piprop', 'thumbnail');
  params.append('pithumbsize', '300');
  params.append('pilimit', Math.min(limit, 50));

  const res = await fetch(`${api}?${params}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Wikipedia ${lang} API error: ${res.status}`);
  const data = await res.json();
  const pages = data?.query?.pages || {};
  return (data?.query?.search || []).map((r) => {
    const page = pages[r.pageid];
    return {
      title: r.title,
      pageid: r.pageid,
      snippet: r.snippet ? r.snippet.replace(/<[^>]+>/g, '') : '',
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
      thumbnail: page?.thumbnail?.source || null,
      lang,
      wordcount: r.wordcount || 0,
      timestamp: r.timestamp || null,
    };
  });
}

async function wikiFullArticle(title, lang) {
  const api = `https://${lang}.wikipedia.org/w/api.php`;

  const qParams = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'extracts|pageimages|info|categories|coordinates|langlinks',
    explaintext: 1,
    exintro: 0,
    exlimit: 'max',
    exchars: 120000,
    piprop: 'thumbnail',
    pithumbsize: 800,
    inprop: 'url|displaytitle',
    cllimit: 'max',
    collimit: 'max',
    lllimit: 'max',
    llprop: 'url|langname',
    format: 'json',
    origin: '*',
  });
  const qRes = await fetch(`${api}?${qParams}`, { headers: { 'User-Agent': UA } });
  if (!qRes.ok) throw new Error(`Wikipedia ${lang} query error: ${qRes.status}`);
  const qData = await qRes.json();
  const pages = qData?.query?.pages || {};
  const pageId = Object.keys(pages)[0];
  const page = pages[pageId];
  if (!page || page.missing) throw new Error(`Page not found: ${title}`);

  const pParams = new URLSearchParams({
    action: 'parse',
    page: title,
    prop: 'text|sections|images|links|categories|templates|externallinks|iwlinks|properties',
    format: 'json',
    origin: '*',
  });
  const pRes = await fetch(`${api}?${pParams}`, { headers: { 'User-Agent': UA } });
  let parseData = null;
  if (pRes.ok) parseData = await pRes.json();

  const categories = (page.categories || []).map(c => c.title.replace('Category:', ''));
  let coordinates = page.coordinates?.[0] ? { lat: page.coordinates[0].lat, lon: page.coordinates[0].lon } : null;
  const otherLanguages = (page.langlinks || []).map(l => ({ lang: l.lang, name: l.langname, url: l.url }));

  let htmlContent = '';
  if (parseData?.parse) {
    htmlContent = parseData.parse.text?.['*'] || '';
    htmlContent = htmlContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<table[^>]*>[\s\S]*?<\/table>/gi, '[TABLE]')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d))
      .replace(/\s+/g, ' ')
      .trim();
  }

  return {
    title: page.title,
    pageid: page.pageid,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    lang,
    displaytitle: page.displaytitle || page.title,
    extract: page.extract || '',
    extractLength: (page.extract || '').length,
    description: (page.extract || '').slice(0, 300),
    categories,
    coordinates,
    thumbnail: page.thumbnail?.source || null,
    pageImage: page.pageimage || null,
    lastModified: page.touched || null,
    wordCount: parseData?.parse?.properties?.wordcount || null,
    otherLanguages,
    sections: (parseData?.parse?.sections || []).map(s => ({ index: s.index, line: s.line, number: s.number, level: s.level, anchor: s.anchor })),
    links: (parseData?.parse?.links || []).map(l => ({ title: l['*'], exists: l.exists ?? true })).slice(0, 100),
    externalLinks: (parseData?.parse?.externallinks || []).slice(0, 50),
    templates: (parseData?.parse?.templates || []).map(t => t['*']).slice(0, 50),
    images: (parseData?.parse?.images || []).slice(0, 30),
    htmlContentPlain: htmlContent.slice(0, 50000),
  };
}

async function wikiQuick(query, limit = 10) {
  const half = Math.ceil(limit / 2);
  const [en, id] = await Promise.allSettled([
    wikiSearch(query, 'en', half),
    wikiSearch(query, 'id', half),
  ]);
  const combined = [], seen = new Set();
  const add = arr => { for (const r of arr) { const k = r.title.toLowerCase(); if (!seen.has(k)) { seen.add(k); combined.push(r); } } };
  if (en.status === 'fulfilled') add(en.value);
  if (id.status === 'fulfilled') add(id.value);
  return combined.slice(0, limit);
}

async function wikiReadmore(url) {
  const match = url.match(/https?:\/\/([a-z]{2,3})\.wikipedia\.org\/wiki\/(.+)/);
  if (!match) throw new Error('Invalid Wikipedia URL');
  const lang = match[1], title = decodeURIComponent(match[2]).replace(/_/g, ' ');
  return wikiFullArticle(title, lang);
}

async function wikiDeep(query) {
  const [en, id] = await Promise.all([
    wikiSearch(query, 'en', 3),
    wikiSearch(query, 'id', 3),
  ]);
  const results = [];
  if (en[0]) {
    try { results.push(await wikiFullArticle(en[0].title, 'en')); } catch (e) { results.push({ error: `EN: ${e.message}`, ...en[0] }); }
  }
  if (id[0] && id[0].title.toLowerCase() !== en[0]?.title.toLowerCase()) {
    try { results.push(await wikiFullArticle(id[0].title, 'id')); } catch (e) { results.push({ error: `ID: ${e.message}`, ...id[0] }); }
  }
  if (!results.length) throw new Error('No results');
  return results.length === 1 ? results[0] : results;
}

export const tools = [
  {
    name: 'wiki_quick',
    description: 'Quick search across Wikipedia English + Indonesia. Returns title, snippet, URL, thumbnail, word count.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keyword or phrase' },
        limit: { type: 'number', default: 10, description: 'Max results (1-50)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'wiki_readmore',
    description: 'Fetch complete Wikipedia article by URL (EN/ID). Full extract, categories, coordinates, images, sections, links, external links, templates, language translations, and cleaned HTML text.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Wikipedia URL' },
      },
      required: ['url'],
    },
  },
  {
    name: 'wiki_deep',
    description: 'Deep search across Wikipedia EN+ID, returning full metadata for best match(es).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term for deep research' },
      },
      required: ['query'],
    },
  },
];

export async function handleTool(name, args, env) {
  switch (name) {
    case 'wiki_quick': return wikiQuick(args.query, args.limit ?? 10);
    case 'wiki_readmore': return wikiReadmore(args.url);
    case 'wiki_deep': return wikiDeep(args.query);
    default: return null;
  }
}