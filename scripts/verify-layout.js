#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'sdk-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const errors = [];

Object.entries(manifest.layers).forEach(function ([layer, meta]) {
  const layerDir = path.join(root, layer);
  if (!fs.existsSync(layerDir)) {
    errors.push('missing layer directory: ' + layer + '/');
    return;
  }
  (meta.files || []).forEach(function (file) {
    const filePath = path.join(layerDir, file);
    if (!fs.existsSync(filePath)) {
      errors.push('missing file: ' + layer + '/' + file);
    }
  });
});

const flatJs = fs.readdirSync(root).filter(function (name) {
  return name.endsWith('.js');
});
if (flatJs.length) {
  errors.push('flat root .js files remain (move into core/, order/, or staff/): ' + flatJs.join(', '));
}

if (errors.length) {
  console.error('SDK layout verification failed:\n- ' + errors.join('\n- '));
  process.exit(1);
}

console.log('SDK layout OK (' + Object.keys(manifest.layers).join(', ') + ')');
