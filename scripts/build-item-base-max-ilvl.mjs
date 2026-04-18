#!/usr/bin/env node
/**
 * Строит js/item-base-max-ilvl.js для file://: максимальный ItemLevel по каждому InventoryType
 * из data/ItemBase-lvl90-slim.csv
 *
 *   node scripts/build-item-base-max-ilvl.mjs
 *   node scripts/build-item-base-max-ilvl.mjs --in путь.csv
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

let inPath = path.join(__dirname, '..', 'data', 'ItemBase-lvl90-slim.csv');
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--in' && process.argv[i + 1]) {
    inPath = path.resolve(process.argv[++i]);
  }
}

if (!fs.existsSync(inPath)) {
  console.error('Нет файла:', inPath);
  process.exit(1);
}

const raw = fs.readFileSync(inPath, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
const header = parseCsvLine(lines[0]);
const iIlvl = header.indexOf('ItemLevel');
const iInv = header.indexOf('InventoryType');
if (iIlvl < 0 || iInv < 0) {
  console.error('Нужны столбцы ItemLevel и InventoryType');
  process.exit(1);
}

/** @type {Record<string, number>} */
const maxByType = {};
for (let r = 1; r < lines.length; r++) {
  const row = parseCsvLine(lines[r]);
  if (row.length < header.length) {
    continue;
  }
  const ilvl = parseInt(row[iIlvl], 10);
  const inv = parseInt(row[iInv], 10);
  if (Number.isNaN(ilvl) || Number.isNaN(inv)) {
    continue;
  }
  const key = String(inv);
  if (maxByType[key] === undefined || ilvl > maxByType[key]) {
    maxByType[key] = ilvl;
  }
}

const outPath = path.join(__dirname, '..', 'js', 'item-base-max-ilvl.js');
const payload = `/* Автогенерация из CSV — не править вручную. node scripts/build-item-base-max-ilvl.mjs */
window.__ITEM_BASE_MAX_ILVL_BY_INV_TYPE = ${JSON.stringify(maxByType, null, 0)};
window.__ITEM_BASE_META = ${JSON.stringify({
  source: path.basename(inPath),
  builtAt: new Date().toISOString(),
  inventoryTypes: Object.keys(maxByType).length,
})};
`;
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, payload, 'utf8');
console.error('OK', outPath, 'types', Object.keys(maxByType).length);
