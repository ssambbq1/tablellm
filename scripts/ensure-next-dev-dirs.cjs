#!/usr/bin/env node
/*
 Ensures Next.js dev temp directories exist on Windows where Turbopack may
 attempt to write to `.next/static/development/*.tmp.*` before the folder exists.
 Safe to run repeatedly.
*/
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const dirs = [
  path.join(root, '.next'),
  path.join(root, '.next', 'static'),
  path.join(root, '.next', 'static', 'development'),
];

for (const d of dirs) {
  try {
    fs.mkdirSync(d, { recursive: true });
  } catch (e) {
    // ignore; will fail later if truly not creatable
  }
}

