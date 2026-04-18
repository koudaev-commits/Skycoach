#!/usr/bin/env node
/**
 * Фильтрация DBC/DB2-выгрузки предметов (CSV).
 *
 * 1) Оставляет только столбцы: ID, StatPercentEditor_0..3, StatModifier_bonusStat_0..3,
 *    ItemLevel, RequiredLevel, InventoryType
 * 2) Оставляет строки с RequiredLevel = 90
 *
 * Использование:
 *   node scripts/filter-items-csv.mjs путь\к\items.csv
 *   node scripts/filter-items-csv.mjs items.csv --out data\items-lvl90-slim.csv
 */

import fs from 'fs';
import path from 'path';

const KEEP_COLUMNS = [
  'ID',
  'StatPercentEditor_0',
  'StatPercentEditor_1',
  'StatPercentEditor_2',
  'StatPercentEditor_3',
  'StatModifier_bonusStat_0',
  'StatModifier_bonusStat_1',
  'StatModifier_bonusStat_2',
  'StatModifier_bonusStat_3',
  'ItemLevel',
  'RequiredLevel',
  'InventoryType',
];

const REQUIRED_LEVEL = 90;

/**
 * @param {string} line
 * @returns {string[]}
 */
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

/**
 * @param {string} cell
 */
function escapeCsvCell(cell) {
  const s = cell == null ? '' : String(cell);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseArgs(argv) {
  let inputPath = '';
  let outPath = '';
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' && argv[i + 1]) {
      outPath = path.resolve(argv[++i]);
    } else if (!a.startsWith('--') && !inputPath) {
      inputPath = path.resolve(process.cwd(), a);
    }
  }
  if (!inputPath) {
    console.error('Укажите путь к CSV: node scripts/filter-items-csv.mjs <файл.csv> [--out out.csv]');
    process.exit(1);
  }
  if (!outPath) {
    const dir = path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    outPath = path.join(dir, `${base}-lvl90-slim.csv`);
  }
  return { inputPath, outPath };
}

function main() {
  const { inputPath, outPath } = parseArgs(process.argv);

  if (!fs.existsSync(inputPath)) {
    console.error(`Файл не найден: ${inputPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) {
    console.error('Пустой файл.');
    process.exit(1);
  }

  const header = parseCsvLine(lines[0]);
  const index = new Map(header.map((h, i) => [h.trim(), i]));

  for (const col of [...KEEP_COLUMNS, 'RequiredLevel']) {
    if (!index.has(col)) {
      console.error(`В заголовке нет столбца: ${col}`);
      console.error(`Есть: ${header.slice(0, 20).join(', ')}${header.length > 20 ? '…' : ''}`);
      process.exit(1);
    }
  }

  const reqIdx = index.get('RequiredLevel');
  const keepIdx = KEEP_COLUMNS.map((c) => index.get(c));

  const outLines = [KEEP_COLUMNS.join(',')];
  let kept = 0;
  let skipped = 0;

  for (let r = 1; r < lines.length; r++) {
    const row = parseCsvLine(lines[r]);
    if (row.length < header.length) {
      continue;
    }
    const reqVal = row[reqIdx]?.trim() ?? '';
    const reqNum = parseInt(reqVal, 10);
    if (reqVal === '' || Number.isNaN(reqNum) || reqNum !== REQUIRED_LEVEL) {
      skipped++;
      continue;
    }
    const slice = keepIdx.map((i) => escapeCsvCell(row[i] ?? ''));
    outLines.push(slice.join(','));
    kept++;
  }

  fs.writeFileSync(outPath, outLines.join('\n') + '\n', 'utf8');
  console.error(`Записано: ${outPath}`);
  console.error(`Строк данных (после фильтра): ${kept}; отброшено по уровню: ${skipped}; всего строк в файле (с заголовком): ${lines.length}`);
}

main();
