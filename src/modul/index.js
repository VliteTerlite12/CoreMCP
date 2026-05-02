// Registry semua modul MCP
// Cukup tambahkan import & entri di array saat menambah modul baru

import { tools as wikiTools, handleTool as wikiHandler } from './wikipedia.js';
import { tools as pinTools, handleTool as pinHandler } from './pinterest.js';
import { tools as tvTools, handleTool as tvHandler } from './jadwaltv.js';
import { tools as gistTools, handleTool as gistHandler } from './gist-github.js';
import { tools as ghTools, handleTool as ghHandler } from './github.js';

// Daftarkan pasangan tools + handler di sini (urutan tidak penting)
export const MODULES = [
  { tools: wikiTools, handler: wikiHandler },
  { tools: pinTools, handler: pinHandler },
  { tools: tvTools, handler: tvHandler },
  { tools: gistTools, handler: gistHandler },
  { tools: ghTools, handler: ghHandler },
];