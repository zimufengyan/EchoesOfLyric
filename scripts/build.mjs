import { build, transform } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parse, printParseErrorCode } from 'jsonc-parser';

const errors = [];
const collection = parse(await readFile('echoes_of_lyric.json', 'utf8'), errors, { allowTrailingComma: true });
if (errors.length) throw new Error(`Invalid seed JSON: ${printParseErrorCode(errors[0].error)}`);
const snapshot = { version: 1, id: 'echoes-initial-v1', collection, category: Object.keys(collection)[0] ?? '' };
const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const worker = await build({ entryPoints: ['src/file-worker.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', target: ['chrome110', 'edge110'], minify: true, charset: 'utf8' });
const result = await build({ entryPoints: ['src/app.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', target: ['chrome110', 'edge110'], minify: true, charset: 'utf8', legalComments: 'inline', define: { __FILE_WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0].text) } });
const css = await transform(await readFile('src/styles.css', 'utf8'), { loader: 'css', minify: true });
const logo = (await readFile('src/logo.svg', 'utf8')).trim();
const template = await readFile('src/template.html', 'utf8');
const html = template.replace('<!-- APP_LOGO -->', () => logo).replace('APP_FAVICON', () => `data:image/svg+xml,${encodeURIComponent(logo)}`).replace('/* APP_CSS */', () => css.code).replace('/* APP_SNAPSHOT */', () => safeJSON(snapshot)).replace('/* APP_JS */', () => result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
await mkdir('dist', { recursive: true });
await writeFile('dist/echoes_of_lyric.html', html, 'utf8');
console.log(`Built dist/echoes_of_lyric.html (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB). No external assets.`);
