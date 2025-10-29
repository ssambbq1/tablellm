#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`[copy-pdfjs-assets] source not found: ${src}`);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

const root = process.cwd();
const nm = path.join(root, 'node_modules', 'pdfjs-dist');
const srcCmaps = path.join(nm, 'cmaps');
const srcStdFonts = path.join(nm, 'standard_fonts');
const destBase = path.join(root, 'public', 'pdfjs');
const destCmaps = path.join(destBase, 'cmaps');
const destStdFonts = path.join(destBase, 'standard_fonts');

copyDir(srcCmaps, destCmaps);
copyDir(srcStdFonts, destStdFonts);

console.log('[copy-pdfjs-assets] copied cmaps and standard_fonts to public/pdfjs');

