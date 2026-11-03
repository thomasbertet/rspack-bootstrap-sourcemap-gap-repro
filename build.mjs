/**
 * Build the same tiny app twice:
 *  - once with rspack
 *  - once with webpack (classic, same devtool, for parity comparison)
 *
 * Both builds use mode: 'production' (minified) and devtool: 'source-map'.
 * No transpilers, no loaders: the point is the bundler-generated
 * bootstrap/module-loader code, not transform quality.
 */
import path from 'node:path';
import { rspack } from '@rspack/core';
import webpack from 'webpack';

const root = path.dirname(new URL(import.meta.url).pathname);

const common = {
  mode: 'production',
  devtool: 'source-map',
  entry: path.join(root, 'src/index.js'),
};

const rspackConfig = {
  ...common,
  target: 'web',
  output: {
    path: path.join(root, 'dist/rspack'),
    filename: 'bundle.js',
  },
  optimization: { minimize: true, concatenateModules: false },
};

const webpackConfig = {
  ...common,
  output: {
    path: path.join(root, 'dist/webpack'),
    filename: 'bundle.js',
  },
  optimization: { minimize: true, concatenateModules: false },
};

function runRspack() {
  return new Promise((resolve, reject) => {
    rspack.rspack(rspackConfig, (err, stats) => {
      if (err) return reject(err);
      if (stats.hasErrors()) return reject(new Error(stats.toString({ errorDetails: true })));
      console.log('[rspack] built', path.join('dist/rspack', 'bundle.js'));
      resolve();
    });
  });
}

function runWebpack() {
  return new Promise((resolve, reject) => {
    webpack(webpackConfig, (err, stats) => {
      if (err) return reject(err);
      if (stats.hasErrors()) return reject(new Error(stats.toString({ errorDetails: true })));
      console.log('[webpack] built', path.join('dist/webpack', 'bundle.js'));
      resolve();
    });
  });
}

await runRspack();
await runWebpack();
