# rspack bootstrap sourcemap gap — repro

Minimal reproduction of a source map coverage gap in **rspack**-generated bundles:
the bundler bootstrap (the chunk-startup code containing the module loader,
`__webpack_require__`) is **not mapped at all** in the emitted source map, while
**webpack** maps the exact same code to a virtual `webpack:///webpack/bootstrap`
source.

Same input, same settings (`mode: 'production'`, `devtool: 'source-map'`,
default minifiers) — only the bundler differs.

## How to run

```bash
npm install
npm run build        # builds src/ with rspack 2.2.3 AND webpack
npm run verify       # gap analysis straight from the decoded source maps
npm exec node verify-npm.mjs   # same check through the community consumers
```

## What it shows

Each bundle contains the same minified module loader
(`function <x>(<id>){var <c>=<cache>[<id>];if(void 0!==<c>)return <c>.exports;…}`).

### 1. The gap (verify.mjs)

**webpack** — the loader is covered by mappings to the virtual bootstrap source:

```
module loader "r()" spans generated chars [95, 216)
virtual bootstrap source in map: …/webpack/bootstrap …
position 1:95  (inside loader) -> MAPPED: webpack://…/webpack/bootstrap line 5
```

**rspack 2.2.3** — the whole loader span is unmapped, and there is no
bootstrap source in the map at all:

```
module loader "o()" spans generated chars [91, 208)
virtual bootstrap source in map: NONE
position 1:91  (inside loader) -> NOT MAPPED (gap)
    preceding mapping: line 1:66 -> ./src/dep.js line 6
    following mapping: line 1:208 -> webpack/runtime/define_property_getters line 1
position 1:206 (inside loader) -> NOT MAPPED (gap)   <- entire function is a gap
```

rspack *does* map its `webpack/runtime/*` helper modules — only the
bootstrap/chunk-startup code is left unmapped.

### 2. Community consumers agree (verify-npm.mjs)

Sampling several positions inside the loader and resolving them with the two
most widely used NPM source-map consumers — Mozilla's `source-map` and
`@jridgewell/trace-mapping`:

| position inside loader | webpack (source-map GLB / trace-mapping) | rspack 2.2.3 |
|---|---|---|
| fn start | `webpack/bootstrap` line 5 | **NOT FOUND (unmapped)** |
| cache check | `webpack/bootstrap` line 8 | **NOT FOUND (unmapped)** |
| cache hit return | `webpack/bootstrap` line 9 | **NOT FOUND (unmapped)** |
| module creation | `webpack/bootstrap` line 12 | **NOT FOUND (unmapped)** |
| fn end | `webpack/bootstrap` line 22 | **NOT FOUND (unmapped)** |

- `source-map` with its default `GREATEST_LOWER_BOUND` bias and
  `@jridgewell/trace-mapping` both return **null** for every position inside
  the rspack loader: the loader is genuinely unmapped, and standard consumers
  correctly report it as such (the DevTools display would be the minified
  position / an unmapped frame).
- `LEAST_UPPER_BOUND` on rspack resolves to the *following* mapping —
  `webpack/runtime/define_property_getters`, the next runtime module — which
  would also be a misattribution for consumers that look forward instead of
  backward.

### Why this matters

Tools that don't treat "no mapping found" as a terminal result, and instead
fall back to a nearby mapping (previous or next), will attribute the module
loader's frames to **unrelated files** — a stack frame from `__webpack_require__`
gets shown as coming from whatever module happens to be mapped next to the gap.
Since the module loader runs on the critical path of every page load, this
distorts stack traces and profiles precisely where load performance is
analyzed.

## Notes

- Both builds use `optimization.concatenateModules: false` so the module
  system survives in a 2-module bundle (otherwise everything gets inlined and
  there is no bootstrap at all). The mapping gap is independent of this flag;
  in real applications the bootstrap is always present.
- Related upstream history:
  - [PR #10245](https://github.com/web-infra-dev/rspack/pull/10245) "feat: generate source map for runtime code" (merged 2025-05) — added mappings for runtime *modules*, did not cover the bootstrap.
  - [PR #8176](https://github.com/web-infra-dev/rspack/pull/8176) (closed, unmerged) — documents that runtime code is returned as `RawSource`, for which `rspack-sources` skips mapping generation; proposed `OriginalSource`.
  - [Issue #7914](https://github.com/web-infra-dev/rspack/issues/7914) — long thread on partial sourcemap coverage (~76% vs 100% with Terser).
- The suggested upstream fix: emit the bootstrap/chunk-startup code as an
  `OriginalSource` mapped to a virtual source like webpack's
  `webpack:///webpack/bootstrap`, so `__webpack_require__` symbolicates
  consistently with webpack bundles.
- The decoders in `verify.mjs` / consumers in `verify-npm.mjs` handle the
  spec correctly: generated columns are per-line deltas; source index, source
  line, source column and name index are deltas across the whole file.
