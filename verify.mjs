/**
 * verify.mjs — gap analysis of the repro bundles' source maps.
 *
 * For both the webpack and rspack bundles (identical source, identical build
 * settings), locates the generated module loader (__webpack_require__) and
 * reports, directly from the decoded source map:
 *   - which sampled positions inside the loader are covered by mappings
 *   - which mappings surround the gap (preceding source-bearing / following)
 *
 * See verify-npm.mjs for the same check through the community consumers
 * (Mozilla source-map, @jridgewell/trace-mapping).
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64 = new Map([...CHARS].map((c, i) => [c, i]));

/** Spec-correct v3 decode: generated column is a per-line delta;
 * source index/line/column/name are deltas across the whole file. */
function decodeMappings(mappings) {
  const perLine = [];
  let src = 0, srcLine = 0, srcCol = 0, nameIdx = 0;
  for (const lineStr of mappings.split(';')) {
    const segs = [];
    let genCol = 0;
    if (lineStr) {
      for (const seg of lineStr.split(',')) {
        if (!seg) continue;
        const vals = [];
        let shift = 0, value = 0;
        for (const c of seg) {
          const digit = B64.get(c);
          value += (digit & 31) << shift;
          if (digit & 32) { shift += 5; }
          else { const neg = value & 1; value >>>= 1; vals.push(neg ? -value : value); shift = 0; value = 0; }
        }
        if (vals.length === 0) continue;
        let i = 0;
        genCol += vals[i++];
        const hasSrc = vals.length >= 4;
        const srcIdx = hasSrc ? (src += vals[i++]) : null;
        const sLine = hasSrc ? (srcLine += vals[i++]) : null;
        const sCol = hasSrc ? (srcCol += vals[i++]) : null;
        const nm = vals.length === 5 ? (nameIdx += vals[4]) : null;
        segs.push({ genCol, srcIdx, sLine, sCol, nm });
      }
    }
    perLine.push(segs);
  }
  return perLine;
}

const LOADER_RE = /function (\w+)\((\w+)\)\{(?:var|const|let) (\w+)=(\w+)\[\2\];if\(void 0!==\3\)return \3\.exports;/;

function loaderSpan(js) {
  const m = js.match(LOADER_RE);
  if (!m) return null;
  const start = js.indexOf(m[0]);
  let depth = 0, i = start;
  for (; i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return { name: m[1], start, end: i };
}

function absToLineCol(js, abs) {
  let line = 0, col = 0;
  for (let i = 0; i < abs; i++) {
    if (js.charCodeAt(i) === 10) { line++; col = 0; } else col++;
  }
  return { line, col };
}

function analyze(label, jsPath, mapPath) {
  console.log('='.repeat(76));
  console.log(label);
  console.log('='.repeat(76));
  const js = fs.readFileSync(jsPath, 'utf8');
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const span = loaderSpan(js);
  if (!span) { console.log('  module loader not found'); return; }

  const bootstrap = map.sources.filter((s) => /bootstrap/.test(s));
  console.log(`  module loader "${span.name}()" spans generated chars [${span.start}, ${span.end})`);
  console.log(`  virtual bootstrap source in map: ${bootstrap.length ? bootstrap.join(', ') : 'NONE'}`);

  const perLine = decodeMappings(map.mappings);
  const samples = [span.start, (span.start + span.end) >> 1, span.end - 2];
  for (const abs of samples) {
    const { line, col } = absToLineCol(js, abs);
    const segs = perLine[line] || [];
    const exact = segs.find((s) => s.genCol === col && s.srcIdx != null);
    if (exact) {
      console.log(`  position ${line + 1}:${col} (inside loader) -> MAPPED: ${map.sources[exact.srcIdx]} line ${exact.sLine + 1}`);
    } else {
      // surrounding source-bearing mappings
      let prev = null, next = null;
      const flat = [];
      for (let l = 0; l < perLine.length; l++) for (const s of perLine[l]) flat.push({ line: l, ...s });
      flat.sort((a, b) => a.line - b.line || a.genCol - b.genCol);
      for (const f of flat) {
        if (f.srcIdx == null) continue;
        if (f.line < line || (f.line === line && f.genCol <= col)) prev = f;
        else if (!next) { next = f; break; }
      }
      console.log(`  position ${line + 1}:${col} (inside loader) -> NOT MAPPED (gap)`);
      if (prev) console.log(`      preceding mapping: line ${prev.line + 1}:${prev.genCol} -> ${map.sources[prev.srcIdx]} line ${prev.sLine + 1} (${line === prev.line && col - prev.genCol} columns before)`);
      if (next) console.log(`      following mapping: line ${next.line + 1}:${next.genCol} -> ${map.sources[next.srcIdx]} line ${next.sLine + 1}`);
    }
  }
  console.log('');
}

analyze('WEBPACK (classic, parity reference)', path.join(root, 'dist/webpack/bundle.js'), path.join(root, 'dist/webpack/bundle.js.map'));
analyze('RSPACK 2.2.3', path.join(root, 'dist/rspack/bundle.js'), path.join(root, 'dist/rspack/bundle.js.map'));
