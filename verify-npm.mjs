/**
 * verify-npm.mjs — community source-map consumers on the repro bundles.
 *
 * For BOTH the webpack and rspack bundles (identical source, identical build
 * settings), this script:
 *   1. Locates the generated module loader (__webpack_require__) in the
 *      minified output.
 *   2. Samples several positions inside the loader function: its start,
 *      the cache check, the module-creation assignment, the dispatch call,
 *      and the final return.
 *   3. Resolves each position with the two most widely used NPM consumers:
 *        - source-map (Mozilla) originalPositionFor, default bias
 *          (GREATEST_LOWER_BOUND) and LEAST_UPPER_BOUND
 *        - @jridgewell/trace-mapping originalPositionFor
 */
import fs from 'node:fs';
import path from 'node:path';
import { SourceMapConsumer } from 'source-map';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

const root = path.dirname(new URL(import.meta.url).pathname);

const LOADER_RE = /function (\w+)\((\w+)\)\{(?:var|const|let) (\w+)=(\w+)\[\2\];if\(void 0!==\3\)return \3\.exports;/;

/** Find positions of interest inside the loader function (absolute char offsets). */
function loaderPositions(js) {
  const m = js.match(LOADER_RE);
  if (!m) return null;
  const start = js.indexOf(m[0]);
  const loaderText = m[0];
  // also grab the rest of the function up to its closing brace
  const braceStart = start + loaderText.length;
  let depth = 1, i = braceStart;
  while (depth > 0 && i < js.length) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}') depth--;
    i++;
  }
  const fnEnd = i; // index just past closing brace
  const samples = [
    ['fn start', start],
    ['cache check', start + loaderText.indexOf('if(void 0!==')],
    ['cache hit return', start + loaderText.indexOf('return')],
    ['fn end', fnEnd - 2],
  ];
  const dispatch = js.indexOf('.call(', braceStart);
  if (dispatch > -1 && dispatch < fnEnd) samples.push(['dispatch call', dispatch]);
  const modCreate = js.indexOf('={exports:{}}', braceStart);
  if (modCreate > -1 && modCreate < fnEnd) samples.push(['module creation', modCreate]);
  return { name: m[1], samples };
}

function absToLineCol(js, abs) {
  let line = 0, col = 0;
  for (let i = 0; i < abs; i++) {
    if (js.charCodeAt(i) === 10) { line++; col = 0; } else col++;
  }
  return { line, col };
}

async function analyze(label, jsPath, mapPath) {
  console.log('='.repeat(76));
  console.log(label);
  console.log('='.repeat(76));
  const js = fs.readFileSync(jsPath, 'utf8');
  const raw = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const pos = loaderPositions(js);
  if (!pos) { console.log('  module loader not found'); return; }
  console.log(`  module loader "${pos.name}()" — sampling ${pos.samples.length} positions inside it\n`);

  const tm = new TraceMap(raw);
  const consumer = await new SourceMapConsumer(raw); // eslint-disable-line no-new-wrappers

  for (const [sampleName, abs] of pos.samples) {
    const { line, col } = absToLineCol(js, abs);
    const line1 = line + 1;
    const fmt = (r) => (r.source !== null && r.source !== undefined
      ? `${r.source} line ${r.line} col ${r.column}`
      : 'NOT FOUND (unmapped)');

    const trace = originalPositionFor(tm, { line: line1, column: col });
    const glb = consumer.originalPositionFor({ line: line1, column: col, bias: SourceMapConsumer.GREATEST_LOWER_BOUND });
    const lub = consumer.originalPositionFor({ line: line1, column: col, bias: SourceMapConsumer.LEAST_UPPER_BOUND });

    console.log(`  [${sampleName}] generated ${line1}:${col}`);
    console.log(`    trace-mapping          : ${fmt(trace)}`);
    console.log(`    source-map GLB (default): ${fmt(glb)}`);
    console.log(`    source-map LUB          : ${fmt(lub)}`);
  }
  console.log('');
  consumer.destroy();
}

await analyze('WEBPACK (classic, parity reference)', path.join(root, 'dist/webpack/bundle.js'), path.join(root, 'dist/webpack/bundle.js.map'));
await analyze('RSPACK 2.2.3', path.join(root, 'dist/rspack/bundle.js'), path.join(root, 'dist/rspack/bundle.js.map'));
