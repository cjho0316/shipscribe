import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createProvider } from './model/index.js';
import { generateRelease } from './domain/release.js';
import { applyChangelog, REPO_DIR } from './agent/tools.js';
import { getDefaultRange } from './domain/git.js';
import { redactSecrets } from './agent/guardrails.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '../web');
const cfg = loadConfig();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function send(res: ServerResponse, code: number, body: string | Buffer, headers: Record<string, string> = {}): void {
  res.writeHead(code, { 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function json(res: ServerResponse, code: number, obj: unknown): void {
  send(res, code, JSON.stringify(obj), { 'content-type': 'application/json' });
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function openSse(res: ServerResponse): (event: string, data: unknown) => void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  return (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const p = url.pathname;

    if (p === '/api/health') return json(res, 200, { ok: true });

    if (p === '/api/info') {
      const defaultRange = await getDefaultRange(REPO_DIR).catch(() => 'HEAD');
      return json(res, 200, {
        provider: cfg.provider,
        isAzure: cfg.provider === 'foundry',
        model: cfg.model,
        defaultRange,
        repo: REPO_DIR,
      });
    }

    if (p === '/api/release' && req.method === 'POST') {
      const body = await readBody(req);
      const emit = openSse(res);
      emit('meta', { provider: cfg.provider, isAzure: cfg.provider === 'foundry', model: cfg.model });
      try {
        const provider = await createProvider(cfg);
        const out = await generateRelease({
          range: body.range,
          provider,
          onText: (t) => emit('text', { delta: t }),
          onToolStart: (n, a) => emit('tool', { phase: 'start', name: n, args: redactSecrets(JSON.stringify(a)) }),
          onToolEnd: (n) => emit('tool', { phase: 'end', name: n }),
        });
        emit('sections', out.sections);
        emit('done', { range: out.range, provider: out.provider });
      } catch (e) {
        emit('error', { message: (e as Error).message });
      }
      return res.end();
    }

    if (p === '/api/apply' && req.method === 'POST') {
      const body = await readBody(req);
      const content = String(body.content || '').trim();
      if (!content) return json(res, 400, { error: 'content is required' });
      const result = await applyChangelog(content);
      return json(res, 200, { ok: true, result });
    }

    // Static files from web/.
    const rel = p === '/' ? '/index.html' : p;
    const full = path.join(webDir, path.normalize(rel));
    if (!full.startsWith(webDir)) return send(res, 403, 'forbidden');
    try {
      const data = await readFile(full);
      return send(res, 200, data, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' });
    } catch {
      return send(res, 404, 'not found');
    }
  } catch (e) {
    return json(res, 500, { error: (e as Error).message });
  }
});

server.listen(cfg.port, () => {
  const mode = cfg.provider === 'foundry' ? `Azure Foundry (${cfg.model})` : 'offline mock';
  console.log(`\n\u2693 ShipScribe web on http://localhost:${cfg.port}  [${mode}]`);
  console.log(`   repo: ${REPO_DIR}`);
});
