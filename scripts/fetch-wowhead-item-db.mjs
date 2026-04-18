#!/usr/bin/env node
/**
 * Одноразовая выгрузка предметов с Wowhead по URL списка (все страницы пагинации).
 * Сохраняет: id, слот, уровень предмета, качество, имя, распарсенные характеристики, сырой tooltip (опционально).
 * Иконки не качает.
 *
 * Требования: Node.js 18+ (встроенный fetch).
 *
 * Использование:
 *   node scripts/fetch-wowhead-item-db.mjs
 *   node scripts/fetch-wowhead-item-db.mjs "https://www.wowhead.com/items/..."
 *   node scripts/fetch-wowhead-item-db.mjs --delay 200 --out data/wowhead-db/items.json
 *   WOWHEAD_COOKIE="..." node scripts/fetch-wowhead-item-db.mjs
 *
 * Cookie из файла (рекомендуется на Windows — без проблем с ; и кавычками в консоли):
 *   Создайте файл, одна строка = полное значение заголовка Cookie из DevTools.
 *   node scripts/fetch-wowhead-item-db.mjs --cookie-file data/wowhead-db/cookie.txt
 *
 * Проверка, проходит ли запрос (без полной выгрузки):
 *   node scripts/fetch-wowhead-item-db.mjs --cookie-file data/wowhead-db/cookie.txt --probe
 *
 * Если всё равно 403: другая сеть / VPN; расширение «cookies.txt» и экспорт для curl;
 * либо база предметов через Blizzard Game Data API (без Wowhead).
 *
 * Ориентир по фильтрам: https://www.wowhead.com/items/...
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_LIST_URL =
  'https://www.wowhead.com/items/min-req-level:90/max-req-level:90/quality:3:4:5:6:7:8?filter=195:251:128;1:2:1;0:0:0';

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate',
  Referer: 'https://www.wowhead.com/',
  Origin: 'https://www.wowhead.com',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

/** Слоты в порядке от более длинных к коротким (чтобы не перепутать с подстроками). */
/** Частичное соответствие inventory-type id → слот (Blizzard / Wowhead). */
const INVENTORY_SLOT_BY_ID = {
  1: 'Head',
  2: 'Neck',
  3: 'Shoulder',
  4: 'Shirt',
  5: 'Chest',
  6: 'Waist',
  7: 'Legs',
  8: 'Feet',
  9: 'Wrist',
  10: 'Hands',
  11: 'Finger',
  12: 'Trinket',
  13: 'One-Hand',
  14: 'Shield',
  15: 'Ranged',
  16: 'Back',
  17: 'Two-Hand',
  21: 'Main Hand',
  22: 'Off Hand',
  23: 'Held In Off-hand',
  25: 'Thrown',
  28: 'Relic',
};

const KNOWN_SLOTS = [
  'Main Hand',
  'Off Hand',
  'Held In Off-hand',
  'Two-Hand',
  'One-Hand',
  'Ranged',
  'Thrown',
  'Finger',
  'Trinket',
  'Shoulder',
  'Chest',
  'Wrist',
  'Waist',
  'Hands',
  'Legs',
  'Feet',
  'Head',
  'Neck',
  'Back',
  'Shirt',
  'Tabard',
  'Relic',
  'Shield',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv) {
  let listUrl = DEFAULT_LIST_URL;
  let outFile = path.join(__dirname, '..', 'data', 'wowhead-db', 'items.json');
  let delayMs = 150;
  let maxPages = 0;
  let includeRawTooltip = false;
  let cookieFile = '';
  let probe = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' && argv[i + 1]) {
      outFile = path.resolve(argv[++i]);
    } else if (a === '--delay' && argv[i + 1]) {
      delayMs = Math.max(0, parseInt(argv[++i], 10) || 0);
    } else if (a === '--max-pages' && argv[i + 1]) {
      maxPages = Math.max(0, parseInt(argv[++i], 10) || 0);
    } else if (a === '--cookie-file' && argv[i + 1]) {
      cookieFile = path.resolve(process.cwd(), argv[++i]);
    } else if (a === '--raw-tooltip') {
      includeRawTooltip = true;
    } else if (a === '--probe') {
      probe = true;
    } else if (a.startsWith('http://') || a.startsWith('https://')) {
      listUrl = a;
    } else if (!a.startsWith('--')) {
      console.error(`Неизвестный аргумент: ${a}`);
    }
  }
  return { listUrl, outFile, delayMs, maxPages, includeRawTooltip, cookieFile, probe };
}

/**
 * Полная строка Cookie: из переменной окружения или из файла (первая непустая строка).
 * @param {string} cookieFile
 */
function loadCookieString(cookieFile) {
  let cookie = (process.env.WOWHEAD_COOKIE || '').trim();
  if (cookieFile) {
    if (!fs.existsSync(cookieFile)) {
      throw new Error(`Файл cookie не найден: ${cookieFile}`);
    }
    const raw = fs.readFileSync(cookieFile, 'utf8').replace(/^\uFEFF/, '');
    const line = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#'));
    if (!line) {
      throw new Error(`В ${cookieFile} нет непустой строки с Cookie (строки с # в начале игнорируются).`);
    }
    cookie = line;
  }
  return cookie;
}

function buildPageUrl(baseUrl, page) {
  const u = new URL(baseUrl);
  if (page <= 1) {
    u.searchParams.delete('page');
  } else {
    u.searchParams.set('page', String(page));
  }
  return u.toString();
}

/**
 * @param {string} href
 */
function absolutizeWowheadHref(href) {
  if (!href) {
    return null;
  }
  if (href.startsWith('http://') || href.startsWith('https://')) {
    return href;
  }
  if (href.startsWith('//')) {
    return `https:${href}`;
  }
  return new URL(href, 'https://www.wowhead.com').href;
}

/**
 * Следующая страница списка (Wowhead часто отдаёт link rel="next").
 * @param {string} html
 */
function extractRelNextUrl(html) {
  const m = html.match(/<link\s+[^>]*rel=["']next["'][^>]*href=["']([^"']+)["'][^>]*>/i);
  if (m) {
    return absolutizeWowheadHref(m[1]);
  }
  const m2 = html.match(/rel=["']next["'][^>]*href=["']([^"']+)["']/i);
  if (m2) {
    return absolutizeWowheadHref(m2[1]);
  }
  return null;
}

/**
 * Все id предметов со страницы списка: ссылки /item=ID и варианты.
 * @param {string} html
 * @returns {number[]}
 */
function extractItemIdsFromListHtml(html) {
  const ids = new Set();
  const re = /\/item=(\d+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    ids.add(parseInt(m[1], 10));
  }
  const re2 = /wowhead\.com\/item\/(\d+)/gi;
  while ((m = re2.exec(html)) !== null) {
    ids.add(parseInt(m[1], 10));
  }
  return [...ids].filter((n) => n > 0).sort((a, b) => a - b);
}

/**
 * Пытаемся угадать число страниц из блока пагинации Wowhead.
 * @param {string} html
 */
function guessTotalPages(html) {
  const patterns = [
    /(?:Page|Страница)\s+\d+\s+of\s+(\d+)/i,
    /data-maxpage="(\d+)"/i,
    /listview-pagination.*?(\d+)\s*<\/a>\s*<\/div>/is,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (n > 0 && n < 100000) {
        return n;
      }
    }
  }
  return null;
}

function stripTooltipHtml(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/td>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseItemLevel(text) {
  const m = text.match(/item\s*level\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function detectSlot(plainText) {
  const lower = plainText.toLowerCase();
  for (const slot of KNOWN_SLOTS) {
    if (lower.includes(slot.toLowerCase())) {
      return slot;
    }
  }
  return null;
}

/**
 * Строки вида "+83 Agility", "+390 Stamina" из текста тултипа.
 * @param {string} plainText
 */
function parseStatLines(plainText) {
  const stats = [];
  const re = /\+(\d+)\s+([A-Za-z][A-Za-z\s\-]{1,46})/g;
  let m;
  while ((m = re.exec(plainText)) !== null) {
    const value = parseInt(m[1], 10);
    let name = m[2].trim();
    const cut = name.search(/\s{2,}|Item\s+Level|Requires\s+/i);
    if (cut > 0) {
      name = name.slice(0, cut).trim();
    }
    if (name.length > 1 && name.length < 48) {
      stats.push({ name, value, text: `+${value} ${name}` });
    }
  }
  return stats;
}

/**
 * @param {string} body
 */
function parseTooltipResponse(body) {
  const t = body.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  }
  const jsonp = t.match(/^[^(]+\((.*)\)\s*;?\s*$/s);
  if (jsonp) {
    try {
      return JSON.parse(jsonp[1]);
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchText(url, headers) {
  const res = await fetch(url, { headers, redirect: 'follow' });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, url: res.url };
}

async function fetchListPage(url, extraHeaders) {
  const headers = { ...DEFAULT_HEADERS, ...extraHeaders };
  return fetchText(url, headers);
}

/**
 * @param {number} id
 */
async function fetchItemTooltipJson(id, extraHeaders) {
  const headers = { ...DEFAULT_HEADERS, ...extraHeaders };
  const bases = [
    `https://www.wowhead.com/tooltip/item/${id}?locale=0`,
    `https://www.wowhead.com/tooltip/item/${id}`,
    `https://www.wowhead.com/tooltip/item/${id}?dataEnv=1`,
  ];
  for (const u of bases) {
    const { ok, status, text } = await fetchText(u, {
      ...headers,
      Accept: 'application/json, text/javascript, */*;q=0.8',
    });
    if (!ok && status === 404) {
      continue;
    }
    const data = parseTooltipResponse(text);
    if (data && typeof data === 'object') {
      return { data, sourceUrl: u };
    }
  }
  return { data: null, sourceUrl: null, error: 'no_json' };
}

function normalizeItemRecord(id, json, opts) {
  const name = typeof json.name === 'string' ? json.name : null;
  const quality =
    typeof json.quality === 'number'
      ? json.quality
      : typeof json.quality === 'string'
        ? parseInt(json.quality, 10)
        : null;
  const tooltipHtml = typeof json.tooltip === 'string' ? json.tooltip : '';
  const plain = stripTooltipHtml(tooltipHtml);
  const itemLevel = parseItemLevel(plain) ?? (typeof json.level === 'number' ? json.level : null);
  let slot =
    typeof json.slot === 'string'
      ? json.slot
      : typeof json.slot_popup === 'string'
        ? json.slot_popup
        : null;
  if (!slot && typeof json.slot === 'number' && INVENTORY_SLOT_BY_ID[json.slot]) {
    slot = INVENTORY_SLOT_BY_ID[json.slot];
  }
  if (!slot && json.inventorySlot != null && INVENTORY_SLOT_BY_ID[json.inventorySlot]) {
    slot = INVENTORY_SLOT_BY_ID[json.inventorySlot];
  }
  if (!slot) {
    slot = detectSlot(plain);
  }
  const stats = parseStatLines(plain);

  const rec = {
    id,
    name,
    quality,
    itemLevel,
    slot,
    stats,
    statsTextSample: plain.slice(0, 2000),
  };
  if (opts.includeRawTooltip && tooltipHtml) {
    rec.rawTooltipHtml = tooltipHtml;
  }
  return rec;
}

async function main() {
  const { listUrl, outFile, delayMs, maxPages, includeRawTooltip, cookieFile, probe } = parseArgs(
    process.argv,
  );
  let cookie = '';
  try {
    cookie = loadCookieString(cookieFile);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
    return;
  }
  const extraHeaders = cookie ? { Cookie: cookie } : {};

  const outDir = path.dirname(outFile);
  fs.mkdirSync(outDir, { recursive: true });

  console.error(`List URL: ${listUrl}`);
  console.error(`Output:   ${outFile}`);
  console.error(`Delay:    ${delayMs} ms between requests`);
  console.error(`Cookie:   ${cookie ? `да (${cookie.length} символов)` : 'нет'}`);

  if (probe) {
    console.error('--- probe: один GET списка ---');
    const { ok, status, text, url } = await fetchListPage(listUrl, extraHeaders);
    console.error(`HTTP ${status} ok=${ok} finalUrl=${url}`);
    console.error(text.slice(0, 600).replace(/\s+/g, ' '));
    if (!ok || status === 403) {
      console.error(
        '\nЕсли снова 403: CloudFront часто режет Node.js даже с cookie. Варианты: другой IP/VPN; curl с -b и файлом cookie; Playwright в браузере; или данные через Blizzard API.',
      );
    }
    return;
  }

  const allIds = new Set();
  let pageIndex = 1;
  let totalPagesHint = null;
  const seenPageFingerprints = [];
  /** @type {'unset' | 'rel' | 'param'} */
  let paginationMode = 'unset';
  let nextParamPage = 2;
  let currentListUrl = listUrl;
  const fetchedListUrls = new Set();

  while (true) {
    if (maxPages > 0 && pageIndex > maxPages) {
      console.error(`Stopped: --max-pages ${maxPages}`);
      break;
    }
    if (fetchedListUrls.has(currentListUrl)) {
      console.error(`URL уже загружался (цикл пагинации), выход.`);
      break;
    }
    fetchedListUrls.add(currentListUrl);

    console.error(`Fetching list page ${pageIndex}: ${currentListUrl}`);
    const { ok, status, text } = await fetchListPage(currentListUrl, extraHeaders);
    if (!ok) {
      console.error(`List HTTP ${status}. Body starts: ${text.slice(0, 200)}`);
      if (status === 403 || status === 503) {
        console.error(
          'Подсказка: задайте WOWHEAD_COOKIE из браузера или смените сеть; CloudFront часто режет ботов.',
        );
      }
      process.exitCode = 1;
      return;
    }
    if (totalPagesHint === null) {
      totalPagesHint = guessTotalPages(text);
      if (totalPagesHint) {
        console.error(`Detected total pages (hint): ${totalPagesHint}`);
      }
    }
    const ids = extractItemIdsFromListHtml(text);
    const fp = ids.join(',');
    if (ids.length === 0) {
      console.error(`На странице ${pageIndex} нет id предметов, конец списка.`);
      break;
    }
    if (seenPageFingerprints.includes(fp)) {
      console.error(`Повтор содержимого страницы (${pageIndex}), выход.`);
      break;
    }
    seenPageFingerprints.push(fp);
    for (const id of ids) {
      allIds.add(id);
    }
    console.error(`  +${ids.length} id (всего уникальных: ${allIds.size})`);

    const relNext = extractRelNextUrl(text);
    if (paginationMode === 'unset') {
      paginationMode = relNext ? 'rel' : 'param';
      console.error(`Режим пагинации: ${paginationMode === 'rel' ? 'link rel=next' : '?page=N'}`);
    }

    if (paginationMode === 'rel') {
      if (!relNext) {
        console.error(`Нет rel=next, список закончен.`);
        break;
      }
      currentListUrl = relNext;
    } else {
      if (totalPagesHint !== null && pageIndex >= totalPagesHint) {
        console.error(`Достигнута подсказка числа страниц (${totalPagesHint}).`);
        break;
      }
      currentListUrl = buildPageUrl(listUrl, nextParamPage);
      nextParamPage += 1;
    }

    pageIndex += 1;
    if (delayMs) {
      await sleep(delayMs);
    }
  }

  const sortedIds = [...allIds].sort((a, b) => a - b);
  console.error(`Fetching tooltips for ${sortedIds.length} items...`);

  const items = [];
  let fail = 0;
  for (let i = 0; i < sortedIds.length; i++) {
    const id = sortedIds[i];
    const { data, error } = await fetchItemTooltipJson(id, extraHeaders);
    if (!data) {
      fail++;
      items.push({
        id,
        error: error || 'fetch_or_parse_failed',
        name: null,
        quality: null,
        itemLevel: null,
        slot: null,
        stats: [],
      });
    } else {
      items.push(normalizeItemRecord(id, data, { includeRawTooltip }));
    }
    if ((i + 1) % 50 === 0) {
      console.error(`  ... ${i + 1} / ${sortedIds.length}`);
    }
    if (delayMs) {
      await sleep(delayMs);
    }
  }

  const meta = {
    sourceListUrl: listUrl,
    fetchedAt: new Date().toISOString(),
    itemCount: items.length,
    uniqueIds: sortedIds.length,
    tooltipFailures: fail,
    note: 'Слот и статы извлечены из текста тултипа Wowhead; для точного BiS позже можно сопоставить с Blizzard item JSON.',
  };

  const payload = { meta, items };
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
  const jsonlPath = outFile.replace(/\.json$/i, '') + '.jsonl';
  const lines = items.map((it) => JSON.stringify(it)).join('\n');
  fs.writeFileSync(jsonlPath, lines, 'utf8');

  console.error(`Done. Wrote ${outFile} and ${jsonlPath}`);
  if (fail) {
    console.error(`Warning: ${fail} tooltips failed (см. поле error в записях).`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
