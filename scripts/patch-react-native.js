// scripts/patch-react-native.js
// Replaces the C++20 std::format call in React Native that the NDK's
// libc++ does not support, with a portable std::snprintf equivalent.
const fs = require('fs');
const path = require('path');

const targetFile = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native',
  'ReactCommon',
  'react',
  'renderer',
  'core',
  'graphicsConversions.h'
);

if (!fs.existsSync(targetFile)) {
  console.log('[patch-rn] graphicsConversions.h not found, skipping.');
  process.exit(0);
}

let source = fs.readFileSync(targetFile, 'utf8');

// Already patched? (either our snprintf form or a to_string form)
if (
  /std::snprintf\s*\(\s*buffer\s*,\s*sizeof\(buffer\)/.test(source) ||
  /std::to_string\s*\(\s*dimension\.value\s*\)/.test(source)
) {
  console.log('[patch-rn] Already patched.');
  process.exit(0);
}

// Match the original std::format call, allowing any whitespace.
const regex = /return\s+std::format\s*\(\s*"\{\}%"\s*,\s*dimension\.value\s*\)\s*;/;

if (!regex.test(source)) {
  console.warn('[patch-rn] std::format line not found and file does not appear patched.');
  console.warn('[patch-rn] Please open and verify manually:');
  console.warn('           ' + targetFile);
  process.exit(0);
}

source = source.replace(
  regex,
  'char buffer[256];\n      std::snprintf(buffer, sizeof(buffer), "%.9g%%", dimension.value);\n      return buffer;'
);

fs.writeFileSync(targetFile, source, 'utf8');
console.log('[patch-rn] Patched graphicsConversions.h successfully.');