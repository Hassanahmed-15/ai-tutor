// Math Quest server: zero dependencies, Node 18+.
// Serves the game, proxies AI calls to the Claude API (your key never reaches the browser),
// and stores a simple weekly leaderboard in a JSON file.
//   ANTHROPIC_API_KEY=sk-ant-... node server/server.js     then open http://localhost:3000
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, '..', 'public');
const DATA = path.join(ROOT, 'data');
const PORT = +process.env.PORT || 3000;
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL_DEFAULT = process.env.MQ_MODEL || 'claude-sonnet-5-5';
const MODEL_QUICK = process.env.MQ_MODEL_QUICK || 'claude-haiku-5-5';
const MOCK = process.env.MQ_MOCK_AI === '1'; // offline testing without an API key

// ---------- tiny per-IP rate limit (protects your API bill) ----------
const hits = new Map();
function limited(ip, max = +process.env.MQ_AI_PER_MIN || 12) {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60000);
  list.push(now); hits.set(ip, list); return list.length > max;
}

// ---------- Claude ----------
async function claude(prompt, tier) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: tier === 'quick' ? MODEL_QUICK : MODEL_DEFAULT, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] })
  });
  if (r.status === 429 || r.status === 529) { const e = new Error('rate_limited'); e.code = 'rate_limited'; throw e; }
  if (!r.ok) throw new Error('Claude API error ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const d = await r.json();
  return (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}
function extractJSON(text) {
  const t = text.replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('No JSON in model reply');
}
function mockReply(prompt, mode) {
  if (mode === 'text') return { text: 'Great question! Try breaking it into small steps. What do you notice first?' };
  if (prompt.startsWith('Solve each')) { const n = (prompt.match(/\n\d+\. /g) || []).length; return { json: { answers: Array(n).fill(0) } }; }
  const q = (i, d) => ({ d, q: `What is ${i} + ${i * 2}?`, type: 'num', answer: i * 3, check: `${i}+${i * 2}`, hint: 'Add the two numbers.', explain: `${i} + ${i * 2} = ${i * 3}` });
  return { json: { topic: 'Practice topic', diagnostic: [1, 2, 3, 4].map(d => q(d + 1, d)),
    learn: [{ head: 'Getting started', body: 'This is mock lesson content (MQ_MOCK_AI=1).', steps: ['Step one', 'Step two'] }, { head: 'Next idea', body: 'Another mock card.', steps: [] }],
    revise: [{ head: 'Recap', body: 'Mock recap.' }], questions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => q(i, 1 + (i % 3))) } };
}

// ---------- leaderboard (JSON file; swap for your database) ----------
const BOARD = path.join(DATA, 'board.json');
async function loadBoardFile() { try { return JSON.parse(await readFile(BOARD, 'utf8')); } catch { return {}; } }
async function saveBoardFile(b) { if (!existsSync(DATA)) await mkdir(DATA, { recursive: true }); await writeFile(BOARD, JSON.stringify(b)); }

// ---------- http ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
function send(res, code, body, type = 'application/json') { res.writeHead(code, { 'content-type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); }
async function readBody(req, max = 200000) {
  let s = ''; for await (const c of req) { s += c; if (s.length > max) throw new Error('too large'); } return s ? JSON.parse(s) : {};
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), ip = req.socket.remoteAddress || '?';
  try {
    if (url.pathname === '/api/ai' && req.method === 'POST') {
      if (limited(ip)) return send(res, 429, { error: 'rate_limited' });
      const { prompt, mode, tier } = await readBody(req);
      if (typeof prompt !== 'string' || prompt.length > 20000) return send(res, 400, { error: 'bad prompt' });
      if (MOCK) return send(res, 200, mockReply(prompt, mode));
      if (!KEY) return send(res, 500, { error: 'ANTHROPIC_API_KEY is not set on the server' });
      const text = await claude(prompt, tier);
      return send(res, 200, mode === 'json' ? { json: extractJSON(text) } : { text });
    }
    if (url.pathname === '/api/leaderboard') {
      const board = await loadBoardFile();
      if (req.method === 'GET') {
        const wk = url.searchParams.get('week');
        const rows = Object.entries(board).filter(([, v]) => v.wk === wk).map(([id, v]) => ({ id, name: v.name, wxp: v.wxp, streak: v.streak }))
          .sort((a, b) => b.wxp - a.wxp).slice(0, 30);
        return send(res, 200, { rows });
      }
      if (req.method === 'POST') {
        const b = await readBody(req, 5000), id = String(b.id || '').slice(0, 80);
        if (!id) return send(res, 400, { error: 'missing id' });
        // In production, take id and name from your session/auth instead of trusting the client.
        board[id] = { name: String(b.name || 'Player').slice(0, 40), wk: String(b.wk || '').slice(0, 10), wxp: Math.max(0, Math.min(1e6, +b.wxp || 0)), xp: +b.xp || 0, streak: +b.streak || 0, ts: Date.now() };
        await saveBoardFile(board); return send(res, 200, { ok: true });
      }
    }
    // static files
    let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden', 'text/plain');
    const data = await readFile(file);
    return send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    if (e.code === 'ENOENT') return send(res, 404, 'not found', 'text/plain');
    if (e.code === 'rate_limited') return send(res, 429, { error: 'rate_limited' });
    console.error(e); return send(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => console.log(`Math Quest running on http://localhost:${PORT}${MOCK ? ' (mock AI)' : ''}`));
