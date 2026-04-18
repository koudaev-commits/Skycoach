'use strict';

const BLIZZARD_ORIGIN = 'https://worldofwarcraft.blizzard.com';
/** Locale path must match the official search URL (Cyrillic in `q` is UTF-8 via encodeURIComponent). */
const BLIZZARD_SEARCH_LOCALE_PATH = '/en-gb/search';
const MODEL_SCRIPT_PREFIX = '<script id="model">model = ';

/**
 * @param {string} query
 */
function buildBlizzardSearchUrl(query) {
  const q = encodeURIComponent(query.trim());
  return `${BLIZZARD_ORIGIN}${BLIZZARD_SEARCH_LOCALE_PATH}?q=${q}`;
}

/**
 * Pull embedded JSON from Blizzard HTML (`<script id="model">model = {...};`).
 * @param {string} html
 * @returns {string | null}
 */
function extractModelJson(html) {
  const start = html.indexOf(MODEL_SCRIPT_PREFIX);
  if (start === -1) {
    return null;
  }
  let i = start + MODEL_SCRIPT_PREFIX.length;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === '\\') {
        esc = true;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        return html.slice(start + MODEL_SCRIPT_PREFIX.length, i + 1);
      }
    }
  }
  return null;
}

/**
 * @param {string} searchUrl
 * @returns {Promise<string>}
 */
async function fetchSearchPageHtml(searchUrl) {
  try {
    const res = await fetch(searchUrl, { credentials: 'omit', cache: 'no-store' });
    if (res.ok) {
      return await res.text();
    }
  } catch {
    /* CORS or network — try proxy */
  }
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(searchUrl)}`;
  const res2 = await fetch(proxyUrl, { credentials: 'omit', cache: 'no-store' });
  if (!res2.ok) {
    throw new Error(`Поиск недоступен (HTTP ${res2.status}).`);
  }
  return await res2.text();
}

/**
 * @param {unknown} model
 * @returns {Array<Record<string, unknown>>}
 */
function getCharacterResults(model) {
  if (!model || typeof model !== 'object' || !Array.isArray(model.categories)) {
    return [];
  }
  const cat = model.categories.find((c) => c && c.enum === 'CHARACTER');
  if (!cat || !Array.isArray(cat.results)) {
    return [];
  }
  return cat.results;
}

/**
 * @param {string} s
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {Record<string, unknown>} c
 */
function renderCharacterCard(c) {
  const url = typeof c.url === 'string' ? c.url : '';
  const href = url.startsWith('http') ? url : `${BLIZZARD_ORIGIN}${url}`;
  const name = escapeHtml(typeof c.name === 'string' ? c.name : '');
  const level = typeof c.level === 'number' ? c.level : '';
  const cls = c.class && typeof c.class === 'object' && typeof c.class.name === 'string' ? c.class.name : '';
  const realm =
    c.realm && typeof c.realm === 'object' && typeof c.realm.name === 'string' ? c.realm.name : '';
  const factionEnum = c.faction && typeof c.faction === 'object' && typeof c.faction.enum === 'string' ? c.faction.enum : '';
  const facClass =
    factionEnum === 'HORDE' ? 'armory-char--horde' : factionEnum === 'ALLIANCE' ? 'armory-char--alliance' : '';
  const avatarUrl =
    c.avatar && typeof c.avatar === 'object' && typeof c.avatar.url === 'string' ? c.avatar.url : '';
  const style = avatarUrl ? ` style="background-image:url('${escapeHtml(avatarUrl)}')"` : '';

  const facExtra = facClass ? ` ${facClass}` : '';
  return `
    <a class="armory-char${facExtra}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
      <div class="armory-char__row">
        <div class="armory-char__avatar"${style} role="img" aria-label=""></div>
        <div class="armory-char__meta">
          <div class="armory-char__name">${name}</div>
          <div class="armory-char__line"><b>${escapeHtml(String(level))}</b> ${escapeHtml(cls)}</div>
          <div class="armory-char__realm">${escapeHtml(realm)}</div>
        </div>
      </div>
    </a>
  `;
}

function renderLanding() {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }

  root.innerHTML = `
    <div class="armory-main">
      <header class="armory-topbar" aria-hidden="true"></header>
      <div class="armory-brand">
        <h1 class="armory-brand__title">Армори</h1>
        <p class="armory-brand__subtitle">Анализ персонажа</p>
      </div>
      <section class="armory-panel" aria-labelledby="armory-form-title">
        <h2 id="armory-form-title" class="armory-panel__heading">Поиск героя</h2>
        <form id="armory-form" novalidate>
          <div class="armory-field">
            <label class="armory-label" for="character-name">Имя персонажа</label>
            <input
              id="character-name"
              class="armory-input"
              name="characterName"
              type="text"
              autocomplete="off"
              spellcheck="false"
              placeholder="Имя персонажа"
              maxlength="48"
            />
          </div>
          <div class="armory-actions">
            <button type="submit" class="armory-btn" id="armory-submit">Анализировать</button>
          </div>
        </form>
      </section>
      <div id="armory-status" class="armory-status armory-status--info hidden" role="status"></div>
      <section id="armory-results" class="armory-results hidden" aria-live="polite"></section>
      <p class="armory-footnote">
        Поиск совпадает с официальной страницей
        <a href="https://worldofwarcraft.blizzard.com/en-gb/search" target="_blank" rel="noopener noreferrer">worldofwarcraft.blizzard.com/…/search</a>.
        Из-за ограничений браузера (CORS) запрос может идти через сервис allorigins.win; имя в запросе передаётся в кодировке UTF-8 (кириллица поддерживается).
      </p>
    </div>
  `;

  const form = document.getElementById('armory-form');
  const input = document.getElementById('character-name');
  const submitBtn = document.getElementById('armory-submit');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runAnalysis(input.value, { input, submitBtn });
  });
}

/**
 * @param {string} characterName
 * @param {{ input: HTMLInputElement, submitBtn: HTMLButtonElement }} els
 */
async function runAnalysis(characterName, els) {
  const trimmed = characterName.trim();
  if (!trimmed) {
    return;
  }

  const statusEl = document.getElementById('armory-status');
  const resultsEl = document.getElementById('armory-results');

  const setLoading = (on) => {
    els.submitBtn.disabled = on;
    els.input.disabled = on;
  };

  const clearStatus = () => {
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.classList.add('hidden');
      statusEl.classList.remove('armory-status--error');
    }
  };

  const showError = (msg) => {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = msg;
    statusEl.classList.remove('hidden', 'armory-status--info');
    statusEl.classList.add('armory-status--error');
  };

  clearStatus();
  if (resultsEl) {
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
  }

  setLoading(true);
  if (statusEl) {
    statusEl.textContent = 'Запрос к поиску Blizzard…';
    statusEl.classList.remove('hidden', 'armory-status--error');
    statusEl.classList.add('armory-status--info');
  }

  try {
    const searchUrl = buildBlizzardSearchUrl(trimmed);
    const html = await fetchSearchPageHtml(searchUrl);
    const jsonStr = extractModelJson(html);
    if (!jsonStr) {
      throw new Error('Не удалось разобрать ответ: нет блока model на странице поиска.');
    }
    const model = JSON.parse(jsonStr);
    const chars = getCharacterResults(model);

    clearStatus();

    if (!resultsEl) {
      return;
    }

    if (chars.length === 0) {
      resultsEl.classList.remove('hidden');
      resultsEl.innerHTML = '<p class="armory-results__heading">Персонажи не найдены</p>';
      return;
    }

    const charCat = Array.isArray(model.categories)
      ? model.categories.find((c) => c && c.enum === 'CHARACTER')
      : null;
    const totalOnServer =
      charCat && typeof charCat.total === 'number' ? charCat.total : null;
    const headingText =
      totalOnServer !== null && totalOnServer > chars.length
        ? `Персонажи (${chars.length} из ${totalOnServer} по данным поиска)`
        : `Персонажи (${chars.length})`;

    resultsEl.classList.remove('hidden');
    resultsEl.innerHTML = `
      <h3 class="armory-results__heading">${escapeHtml(headingText)}</h3>
      <div class="armory-grid">
        ${chars.map((c) => renderCharacterCard(c)).join('')}
      </div>
    `;
  } catch (e) {
    clearStatus();
    const msg = e instanceof Error ? e.message : 'Неизвестная ошибка';
    showError(msg);
  } finally {
    setLoading(false);
  }
}

document.addEventListener('DOMContentLoaded', renderLanding);
