/**
 * Local static gateway mirroring nginx routes — for verification without Docker.
 * Usage: node scripts/serve-local.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '../..');
const port = Number(process.env.PORT ?? 8080);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function tryFile(path) {
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  return readFileSync(path);
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === '/config.json') {
    const body = tryFile(join(root, 'apps/shell/public/config.json'));
    return send(res, body ? 200 : 404, body ?? 'missing', 'application/json');
  }

  let filePath;
  if (pathname.startsWith('/people/')) {
    filePath = join(root, 'apps/people/dist', pathname.slice('/people/'.length));
    if (pathname === '/people/' || pathname === '/people') {
      filePath = join(root, 'apps/people/dist/index.html');
    }
  } else if (pathname.startsWith('/delivery/')) {
    filePath = join(root, 'apps/delivery/dist', pathname.slice('/delivery/'.length));
    if (pathname === '/delivery/' || pathname === '/delivery') {
      filePath = join(root, 'apps/delivery/dist/index.html');
    }
  } else {
    filePath = join(root, 'apps/shell/dist', pathname === '/' ? 'index.html' : pathname);
  }

  let body = tryFile(filePath);
  if (!body && !extname(pathname)) {
    // SPA fallback
    if (pathname.startsWith('/people')) {
      body = tryFile(join(root, 'apps/people/dist/index.html'));
    } else if (pathname.startsWith('/delivery')) {
      body = tryFile(join(root, 'apps/delivery/dist/index.html'));
    } else {
      body = tryFile(join(root, 'apps/shell/dist/index.html'));
    }
  }

  if (!body) return send(res, 404, `Not found: ${pathname}`, 'text/plain');
  send(res, 200, body, mime[extname(filePath)] ?? 'application/octet-stream');
}).listen(port, () => {
  console.log(`Baseline suite at http://localhost:${port}`);
});
