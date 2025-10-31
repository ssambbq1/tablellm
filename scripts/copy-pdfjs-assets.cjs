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
const srcWorkerLegacy = path.join(nm, 'legacy', 'build', 'pdf.worker.mjs');
const srcWorker = path.join(nm, 'build', 'pdf.worker.min.mjs');
const destBase = path.join(root, 'public', 'pdfjs');
const destCmaps = path.join(destBase, 'cmaps');
const destStdFonts = path.join(destBase, 'standard_fonts');
const destWorkerLegacy = path.join(destBase, 'pdf.worker.mjs');
const destWorker = path.join(destBase, 'pdf.worker.min.mjs');

copyDir(srcCmaps, destCmaps);
copyDir(srcStdFonts, destStdFonts);

try {
  if (fs.existsSync(srcWorkerLegacy)) {
    fs.mkdirSync(destBase, { recursive: true });
    fs.copyFileSync(srcWorkerLegacy, destWorkerLegacy);
  }
} catch (e) {
  console.warn('[copy-pdfjs-assets] skip legacy worker copy:', e?.message || e);
}

try {
  if (fs.existsSync(srcWorker)) {
    fs.mkdirSync(destBase, { recursive: true });
    fs.copyFileSync(srcWorker, destWorker);
  }
} catch (e) {
  console.warn('[copy-pdfjs-assets] skip worker copy:', e?.message || e);
}

console.log('[copy-pdfjs-assets] copied cmaps and standard_fonts to public/pdfjs');
console.log('[copy-pdfjs-assets] copied worker(s) to public/pdfjs if available');
