import './build.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
createServer(async (_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(await readFile('dist/echoes_of_lyric.html'));
}).listen(5173, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:5173 (run the build again after editing source)'));
