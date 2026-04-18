'use strict';

const BLIZZARD_ORIGIN = 'https://worldofwarcraft.blizzard.com';
const BLIZZARD_SEARCH_LOCALE_PATH = '/en-gb/search';
const BLIZZARD_UI_LOCALE = '/en-gb';
const MODEL_SCRIPT_PREFIX = '<script id="model">model = ';
const PROFILE_STATE_PREFIX = 'var characterProfileInitialState = ';

const GEAR_SLOT_ORDER = [
  'head',
  'neck',
  'shoulder',
  'back',
  'chest',
  'tabard',
  'hand',
  'waist',
  'leg',
  'foot',
  'leftFinger',
  'rightFinger',
  'leftTrinket',
  'rightTrinket',
  'weapon',
  'mainHand',
  'offHand',
];

const GEAR_SLOT_RU = {
  head: 'Голова',
  neck: 'Шея',
  shoulder: 'Плечи',
  back: 'Спина',
  chest: 'Грудь',
  tabard: 'Гербовая накидка',
  hand: 'Кисти рук',
  waist: 'Пояс',
  leg: 'Ноги',
  foot: 'Ступни',
  leftFinger: 'Палец I',
  rightFinger: 'Палец II',
  leftTrinket: 'Аксессуар I',
  rightTrinket: 'Аксессуар II',
  weapon: 'Оружие',
  mainHand: 'Правая рука',
  offHand: 'Левая рука',
};

const STAT_SLUG_RU = {
  health: 'Здоровье',
  mana: 'Мана',
  'item-level': 'Уровень предметов',
  'movement-speed': 'Скорость передвижения',
  strength: 'Сила',
  agility: 'Ловкость',
  intellect: 'Интеллект',
  stamina: 'Выносливость',
  haste: 'Скорость',
  mastery: 'Искусность',
  versatility: 'Универсальность',
  'critical-strike': 'Критический удар',
  leech: 'Самоисцеление',
  avoidance: 'Избегание',
  dodge: 'Уклонение',
  parry: 'Парирование',
  block: 'Блок',
  speed: 'Скорость',
};

/**
 * @param {string} html
 * @param {string} prefix
 * @returns {string | null}
 */
function extractBalancedJsonAfterPrefix(html, prefix) {
  const start = html.indexOf(prefix);
  if (start === -1) {
    return null;
  }
  let i = start + prefix.length;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let started = false;
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
      started = true;
    } else if (c === '}') {
      depth--;
      if (started && depth === 0) {
        return html.slice(start + prefix.length, i + 1);
      }
    }
  }
  return null;
}

function extractModelJson(html) {
  return extractBalancedJsonAfterPrefix(html, MODEL_SCRIPT_PREFIX);
}

function extractCharacterProfileJson(html) {
  return extractBalancedJsonAfterPrefix(html, PROFILE_STATE_PREFIX);
}

/**
 * @param {string} query
 */
function buildBlizzardSearchUrl(query) {
  const q = encodeURIComponent(query.trim());
  return `${BLIZZARD_ORIGIN}${BLIZZARD_SEARCH_LOCALE_PATH}?q=${q}`;
}

/**
 * @param {string} relativePath e.g. /character/eu/realm/name/
 */
function buildCharacterProfileUrl(relativePath) {
  let p = relativePath.trim();
  if (!p.startsWith('/')) {
    p = `/${p}`;
  }
  if (!p.endsWith('/')) {
    p = `${p}/`;
  }
  return `${BLIZZARD_ORIGIN}${BLIZZARD_UI_LOCALE}${p}`;
}

/**
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchBlizzardHtml(url) {
  try {
    const res = await fetch(url, { credentials: 'omit', cache: 'no-store' });
    if (res.ok) {
      return await res.text();
    }
  } catch {
    /* CORS — fallback */
  }
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  const res2 = await fetch(proxyUrl, { credentials: 'omit', cache: 'no-store' });
  if (!res2.ok) {
    throw new Error(`Запрос недоступен (HTTP ${res2.status}).`);
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

/** Пока открыт профиль — для тултипов по строкам таблицы. */
let profileGearCache = /** @type {Record<string, unknown> | null} */ (null);

/**
 * @param {Record<string, unknown> | null | undefined} c
 */
function rgbaFromBlizzardColor(c) {
  if (!c || typeof c !== 'object') {
    return '';
  }
  const a = typeof c.a === 'number' ? c.a : 1;
  const r = typeof c.r === 'number' ? c.r : 255;
  const g = typeof c.g === 'number' ? c.g : 255;
  const b = typeof c.b === 'number' ? c.b : 255;
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * @param {Record<string, unknown>} item
 */
function getItemIconUrl(item) {
  const assets = item.media && item.media.content && item.media.content.assets;
  if (!Array.isArray(assets)) {
    return '';
  }
  const icon = assets.find((a) => a && a.key === 'icon');
  return icon && typeof icon.value === 'string' ? icon.value : '';
}

/**
 * @param {Record<string, unknown>} item
 */
function getItemIlvlNumeric(item) {
  const L = item.level;
  if (L && typeof L === 'object' && typeof L.value === 'number') {
    return L.value;
  }
  return null;
}

/**
 * @param {Record<string, unknown>} item
 */
function getItemLevelDisplay(item) {
  const L = item.level;
  if (L && typeof L === 'object') {
    if (typeof L.display_string === 'string') {
      return L.display_string;
    }
    if (typeof L.value === 'number') {
      return String(L.value);
    }
  }
  return '—';
}

/**
 * Заглушка «силы» слота относительно условного топа BiS (без реальных таблиц предметов).
 * @param {string} slotKey
 * @param {number | null} ilvl
 */
function stubTierVsBiS(slotKey, ilvl) {
  const seed = `${slotKey}:${ilvl ?? 0}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 33 + seed.charCodeAt(i)) | 0;
  }
  const pct = 60 + (Math.abs(h) % 38);
  const grade = pct >= 94 ? 'S' : pct >= 87 ? 'A' : pct >= 78 ? 'B' : pct >= 68 ? 'C' : 'D';
  return {
    pct,
    grade,
    label: `${pct}%`,
    note: `Грейд ${grade} · заглушка к топу BiS`,
  };
}

/**
 * Текст тултипа в духе Armory: строки из display_string в данных предмета Blizzard.
 * @param {Record<string, unknown>} item
 */
function buildItemTooltipHtml(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }
  const parts = [];

  const name = typeof item.name === 'string' ? item.name : '';
  const qType =
    item.quality && typeof item.quality === 'object' && typeof item.quality.type === 'string'
      ? item.quality.type.toLowerCase()
      : '';
  const qClass = qType ? `armory-tip-q-${escapeHtml(qType)}` : '';
  parts.push(`<div class="armory-tip-name ${qClass}">${escapeHtml(name)}</div>`);

  if (item.quality && typeof item.quality.name === 'string') {
    parts.push(`<div class="armory-tip-line armory-tip-muted">${escapeHtml(item.quality.name)}</div>`);
  }

  if (item.binding && typeof item.binding.name === 'string') {
    parts.push(`<div class="armory-tip-line armory-tip-muted">${escapeHtml(item.binding.name)}</div>`);
  }

  const inv =
    item.inventory_type && typeof item.inventory_type.name === 'string' ? item.inventory_type.name : '';
  const sub =
    item.item_subclass && typeof item.item_subclass.name === 'string' ? item.item_subclass.name : '';
  if (inv || sub) {
    parts.push(
      `<div class="armory-tip-line armory-tip-gold">${escapeHtml([inv, sub].filter(Boolean).join(' • '))}</div>`,
    );
  }

  if (item.level && typeof item.level === 'object' && typeof item.level.display_string === 'string') {
    parts.push(
      `<div class="armory-tip-line armory-tip-ilvl">${escapeHtml(item.level.display_string)}</div>`,
    );
  }

  const uq = item.unique_equipped;
  if (typeof uq === 'string') {
    parts.push(`<div class="armory-tip-line armory-tip-muted">${escapeHtml(uq)}</div>`);
  } else if (uq && typeof uq === 'object' && typeof uq.display_string === 'string') {
    parts.push(`<div class="armory-tip-line armory-tip-muted">${escapeHtml(uq.display_string)}</div>`);
  }

  const weapon = item.weapon;
  if (weapon && typeof weapon === 'object') {
    const w = weapon;
    if (w.damage && typeof w.damage.display_string === 'string') {
      parts.push(`<div class="armory-tip-line">${escapeHtml(w.damage.display_string)}</div>`);
    }
    if (w.attack_speed && typeof w.attack_speed.display_string === 'string') {
      parts.push(`<div class="armory-tip-line">${escapeHtml(w.attack_speed.display_string)}</div>`);
    }
    if (w.dps && typeof w.dps.display_string === 'string') {
      parts.push(`<div class="armory-tip-line">${escapeHtml(w.dps.display_string)}</div>`);
    }
  }

  if (item.armor && typeof item.armor === 'object' && typeof item.armor.value === 'number') {
    parts.push(
      `<div class="armory-tip-line">${escapeHtml(String(item.armor.value))} ${escapeHtml('Броня')}</div>`,
    );
  }

  if (Array.isArray(item.stats)) {
    item.stats.forEach((st) => {
      if (!st || typeof st !== 'object' || !st.display || typeof st.display !== 'object') {
        return;
      }
      const ds = st.display.display_string;
      if (typeof ds !== 'string') {
        return;
      }
      const col = st.display.color;
      const style = col && typeof col === 'object' ? ` style="color:${rgbaFromBlizzardColor(col)}"` : '';
      parts.push(`<div class="armory-tip-line"${style}>${escapeHtml(ds)}</div>`);
    });
  }

  if (Array.isArray(item.enchantments)) {
    item.enchantments.forEach((en) => {
      if (!en || typeof en !== 'object') {
        return;
      }
      const line =
        typeof en.display_string === 'string'
          ? en.display_string
          : en.enchantment &&
              typeof en.enchantment === 'object' &&
              typeof en.enchantment.display_string === 'string'
            ? en.enchantment.display_string
            : '';
      if (line) {
        parts.push(`<div class="armory-tip-line armory-tip-enchant">${escapeHtml(line)}</div>`);
      }
    });
  }

  if (Array.isArray(item.sockets)) {
    item.sockets.forEach((sock) => {
      if (!sock || typeof sock !== 'object') {
        return;
      }
      const line =
        typeof sock.display_string === 'string'
          ? sock.display_string
          : sock.socket_type &&
              typeof sock.socket_type === 'object' &&
              typeof sock.socket_type.name === 'string'
            ? sock.socket_type.name
            : '';
      if (line) {
        parts.push(`<div class="armory-tip-line armory-tip-socket">${escapeHtml(line)}</div>`);
      }
    });
  }

  if (Array.isArray(item.spells)) {
    item.spells.forEach((sp) => {
      if (sp && typeof sp === 'object' && typeof sp.description === 'string') {
        parts.push(`<div class="armory-tip-line armory-tip-use">${escapeHtml(sp.description)}</div>`);
      }
    });
  }

  if (item.set && typeof item.set === 'object') {
    const set = item.set;
    if (typeof set.display_string === 'string') {
      parts.push(`<div class="armory-tip-line armory-tip-set">${escapeHtml(set.display_string)}</div>`);
    }
    if (Array.isArray(set.effects)) {
      set.effects.forEach((ef) => {
        if (ef && typeof ef === 'object' && typeof ef.display_string === 'string') {
          parts.push(`<div class="armory-tip-line armory-tip-set">${escapeHtml(ef.display_string)}</div>`);
        }
      });
    }
  }

  if (item.requirements && typeof item.requirements === 'object') {
    const req = item.requirements;
    ['level', 'playable_classes', 'faction', 'skill'].forEach((k) => {
      const o = req[k];
      if (o && typeof o === 'object' && typeof o.display_string === 'string') {
        parts.push(`<div class="armory-tip-line armory-tip-muted">${escapeHtml(o.display_string)}</div>`);
      }
    });
  }

  if (
    item.durability &&
    typeof item.durability === 'object' &&
    typeof item.durability.display_string === 'string'
  ) {
    parts.push(`<div class="armory-tip-line armory-tip-muted">${escapeHtml(item.durability.display_string)}</div>`);
  }

  if (
    item.timewalker_level &&
    typeof item.timewalker_level === 'object' &&
    typeof item.timewalker_level.display_string === 'string'
  ) {
    parts.push(
      `<div class="armory-tip-line armory-tip-muted">${escapeHtml(item.timewalker_level.display_string)}</div>`,
    );
  }

  if (item.sell_price && typeof item.sell_price === 'object' && item.sell_price.display_strings) {
    const ds = item.sell_price.display_strings;
    if (typeof ds === 'object' && ds !== null) {
      const header = typeof ds.header === 'string' ? ds.header : 'Sell Price:';
      const gold = typeof ds.gold === 'string' ? ds.gold : '';
      const silver = typeof ds.silver === 'string' ? ds.silver : '';
      const copper = typeof ds.copper === 'string' ? ds.copper : '';
      const priceStr = [gold && `${gold}g`, silver && `${silver}s`, copper && `${copper}c`]
        .filter(Boolean)
        .join(' ');
      parts.push(
        `<div class="armory-tip-line armory-tip-muted">${escapeHtml(header + (priceStr ? ` ${priceStr}` : ''))}</div>`,
      );
    }
  }

  return parts.join('');
}

function ensureItemTooltipEl() {
  let tip = document.getElementById('armory-item-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'armory-item-tooltip';
    tip.className = 'armory-item-tooltip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}

function hideGearTooltip() {
  const tip = document.getElementById('armory-item-tooltip');
  if (tip) {
    tip.classList.remove('is-visible');
    tip.innerHTML = '';
  }
}

/**
 * @param {number} x
 * @param {number} y
 */
function positionGearTooltip(x, y) {
  const tip = document.getElementById('armory-item-tooltip');
  if (!tip || !tip.classList.contains('is-visible')) {
    return;
  }
  const pad = 16;
  tip.style.left = '-9999px';
  tip.style.top = '0';
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let left = x + pad;
  let top = y + pad;
  if (left + w > window.innerWidth - 10) {
    left = x - w - 8;
  }
  if (top + h > window.innerHeight - 10) {
    top = y - h - 8;
  }
  if (left < 8) {
    left = 8;
  }
  if (top < 8) {
    top = 8;
  }
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

/**
 * @param {HTMLElement} container
 */
function attachGearRowTooltips(container) {
  ensureItemTooltipEl();
  if (!window.__armoryGearTipScroll) {
    window.__armoryGearTipScroll = true;
    window.addEventListener(
      'scroll',
      () => {
        hideGearTooltip();
      },
      true,
    );
  }
  container.querySelectorAll('[data-gear-slot]').forEach((el) => {
    const show = (clientX, clientY) => {
      const slot = el.getAttribute('data-gear-slot');
      if (!slot || !profileGearCache || typeof profileGearCache !== 'object') {
        hideGearTooltip();
        return;
      }
      const raw = profileGearCache[slot];
      const item = raw && typeof raw === 'object' ? raw : null;
      if (!item) {
        hideGearTooltip();
        return;
      }
      const tip = ensureItemTooltipEl();
      tip.innerHTML = buildItemTooltipHtml(item);
      tip.classList.add('is-visible');
      positionGearTooltip(clientX, clientY);
    };
    el.addEventListener('mouseenter', (e) => show(e.clientX, e.clientY));
    el.addEventListener('mousemove', (e) => {
      if (document.getElementById('armory-item-tooltip')?.classList.contains('is-visible')) {
        positionGearTooltip(e.clientX, e.clientY);
      }
    });
    el.addEventListener('mouseleave', hideGearTooltip);
    el.addEventListener('focus', () => {
      const r = el.getBoundingClientRect();
      show(r.right + 8, r.top + 4);
    });
    el.addEventListener('blur', hideGearTooltip);
  });
}

/**
 * @param {Record<string, unknown> | null | undefined} v
 */
function formatTypedValue(v) {
  if (!v || typeof v !== 'object') {
    return '';
  }
  const t = v.type;
  const n = v.value;
  if (typeof n !== 'number') {
    return '';
  }
  if (t === 'WHOLE' || t === 'INTEGER') {
    return String(Math.round(n));
  }
  if (t === 'PERCENTAGE') {
    return `${n.toFixed(1)}%`;
  }
  if (t === 'DECIMAL') {
    return String(n);
  }
  return String(n);
}

/**
 * @param {Record<string, unknown>} stat
 */
function formatPrimaryStat(stat) {
  let val = formatTypedValue(stat.value);
  if (
    !val &&
    stat.details &&
    typeof stat.details === 'object' &&
    stat.details !== null
  ) {
    const d = stat.details;
    if ('effective' in d && d.effective) {
      val = formatTypedValue(d.effective);
    }
  }
  return val;
}

/**
 * @param {unknown} list
 */
function renderStatBlock(list, title) {
  if (!Array.isArray(list) || list.length === 0) {
    return '';
  }
  const rows = list
    .map((stat) => {
      if (!stat || typeof stat !== 'object') {
        return '';
      }
      const slug = typeof stat.slug === 'string' ? stat.slug : '';
      const label =
        STAT_SLUG_RU[slug] ||
        (typeof stat.enum === 'string' ? stat.enum.replace(/_/g, ' ') : slug || '—');
      const val = formatPrimaryStat(stat);
      if (!val) {
        return '';
      }
      return `<div class="armory-stat-row"><span class="armory-stat-row__k">${escapeHtml(label)}</span><span class="armory-stat-row__v">${escapeHtml(val)}</span></div>`;
    })
    .filter(Boolean)
    .join('');
  if (!rows) {
    return '';
  }
  return `
    <div class="armory-profile__block">
      <h4 class="armory-profile__block-title">${escapeHtml(title)}</h4>
      <div class="armory-stat-grid">${rows}</div>
    </div>
  `;
}

/**
 * @param {unknown} stats
 */
function renderStatsSection(stats) {
  if (!stats || typeof stats !== 'object' || stats === null || !stats.basic) {
    return '';
  }
  const b = stats.basic;
  if (typeof b !== 'object' || b === null) {
    return '';
  }
  const primary = renderStatBlock(b.primary, 'Основные');
  const secondary = renderStatBlock(b.secondary, 'Вторичные');
  if (!primary && !secondary) {
    return '';
  }
  return `<div class="armory-profile__section"><h3 class="armory-profile__section-title">Характеристики</h3>${primary}${secondary}</div>`;
}

/**
 * @param {unknown} gear
 */
function renderGearSection(gear) {
  if (!gear || typeof gear !== 'object' || gear === null) {
    profileGearCache = null;
    return '';
  }
  profileGearCache = gear;
  const rows = GEAR_SLOT_ORDER.map((slot) => {
    const item = gear[slot];
    if (!item || typeof item !== 'object' || typeof item.name !== 'string') {
      return '';
    }
    const slotLabel = GEAR_SLOT_RU[slot] || slot;
    const q =
      item.quality && typeof item.quality === 'object' && typeof item.quality.type === 'string'
        ? item.quality.type
        : '';
    const qClass = q ? ` armory-gear__name--q-${escapeHtml(q.toLowerCase())}` : '';
    const ilvlDisp = getItemLevelDisplay(item);
    const ilvlNum = getItemIlvlNumeric(item);
    const stub = stubTierVsBiS(slot, ilvlNum);
    const iconUrl = getItemIconUrl(item);
    const iconCell = iconUrl
      ? `<td class="armory-gear__icon"><img src="${escapeHtml(iconUrl)}" width="40" height="40" alt="" loading="lazy" decoding="async" /></td>`
      : '<td class="armory-gear__icon armory-gear__icon--empty">—</td>';
    return `<tr class="armory-gear-row" data-gear-slot="${escapeHtml(slot)}" tabindex="0" title="">
      ${iconCell}
      <td class="armory-gear__slot">${escapeHtml(slotLabel)}</td>
      <td class="armory-gear__name${qClass}">${escapeHtml(item.name)}</td>
      <td class="armory-gear__ilvl">${escapeHtml(ilvlDisp)}</td>
      <td class="armory-gear__tier"><span class="armory-gear__tier-pct">${escapeHtml(stub.label)}</span><span class="armory-gear__tier-note">${escapeHtml(stub.note)}</span></td>
    </tr>`;
  })
    .filter(Boolean)
    .join('');
  if (!rows) {
    return '';
  }
  return `
    <div class="armory-profile__section">
      <h3 class="armory-profile__section-title">Экипировка</h3>
      <p class="armory-gear-hint">Наведите на строку или сфокусируйте её — полная подсказка предмета, как в Armory.</p>
      <div class="armory-profile__table-wrap">
        <table class="armory-gear-table">
          <thead>
            <tr>
              <th class="armory-gear__th-icon"></th>
              <th>Слот</th>
              <th>Предмет</th>
              <th>Ур. предмета</th>
              <th>К условному топу <span class="armory-th-sub">(заглушка)</span></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * @param {unknown} specs
 * @param {unknown} active
 */
function renderSpecsSection(specs, active) {
  if (!Array.isArray(specs) || specs.length === 0) {
    return '';
  }
  const activeId = active && typeof active === 'object' && active !== null && 'id' in active ? active.id : null;
  const items = specs
    .map((sp) => {
      if (!sp || typeof sp !== 'object') {
        return '';
      }
      const name = typeof sp.name === 'string' ? sp.name : '';
      const role =
        sp.role && typeof sp.role === 'object' && typeof sp.role.name === 'string'
          ? sp.role.name
          : '';
      const isOn = activeId !== null && sp.id === activeId;
      const mark = isOn ? ' ★' : '';
      return `<li class="${isOn ? 'armory-spec--active' : ''}">${escapeHtml(name)}${role ? ` — ${escapeHtml(role)}` : ''}${mark}</li>`;
    })
    .filter(Boolean)
    .join('');
  if (!items) {
    return '';
  }
  return `
    <div class="armory-profile__section">
      <h3 class="armory-profile__section-title">Специализации</h3>
      <ul class="armory-spec-list">${items}</ul>
    </div>
  `;
}

/**
 * @param {unknown} pve
 */
function renderPveSection(pve) {
  if (!pve || typeof pve !== 'object' || pve === null) {
    return '';
  }
  const name = typeof pve.name === 'string' ? pve.name : '';
  let raidsHtml = '';
  if (Array.isArray(pve.raids)) {
    raidsHtml = pve.raids
      .map((r) => {
        if (!r || typeof r !== 'object') {
          return '';
        }
        const rn = typeof r.name === 'string' ? r.name : '';
        if (!rn) {
          return '';
        }
        let extra = '';
        if (typeof r.normalCount === 'number' && typeof r.normalTotal === 'number') {
          extra = ` <span class="armory-muted">Нормал: ${r.normalCount}/${r.normalTotal}</span>`;
        }
        return `<li>${escapeHtml(rn)}${extra}</li>`;
      })
      .filter(Boolean)
      .join('');
  }
  if (!name && !raidsHtml) {
    return '';
  }
  return `
    <div class="armory-profile__section">
      <h3 class="armory-profile__section-title">PvE</h3>
      ${name ? `<p class="armory-profile__p">${escapeHtml(name)}</p>` : ''}
      ${raidsHtml ? `<ul class="armory-raid-list">${raidsHtml}</ul>` : ''}
    </div>
  `;
}

/**
 * @param {Record<string, unknown>} data parsed characterProfileInitialState
 * @param {string} profileUrl absolute Blizzard URL for optional link
 */
function renderProfileView(data, profileUrl) {
  const ch = data.character;
  if (!ch || typeof ch !== 'object') {
    return '<p class="armory-profile__err">Нет данных персонажа.</p>';
  }

  const name = typeof ch.name === 'string' ? ch.name : '';
  const title = typeof ch.title === 'string' ? ch.title : '';
  const level = typeof ch.level === 'number' ? ch.level : '';
  const ilvl = typeof ch.averageItemLevel === 'number' ? ch.averageItemLevel : '';
  const achieve = typeof ch.achievement === 'number' ? ch.achievement : '';
  const realm = ch.realm && typeof ch.realm === 'object' && typeof ch.realm.name === 'string' ? ch.realm.name : '';
  const region = typeof ch.region === 'string' ? ch.region.toUpperCase() : '';
  const faction =
    ch.faction && typeof ch.faction === 'object' && typeof ch.faction.name === 'string'
      ? ch.faction.name
      : '';
  const race = ch.race && typeof ch.race === 'object' && typeof ch.race.name === 'string' ? ch.race.name : '';
  const cls = ch.class && typeof ch.class === 'object' && typeof ch.class.name === 'string' ? ch.class.name : '';
  const spec = ch.spec && typeof ch.spec === 'object' && typeof ch.spec.name === 'string' ? ch.spec.name : '';

  const bustUrl = ch.bust && typeof ch.bust === 'object' && typeof ch.bust.url === 'string' ? ch.bust.url : '';
  const avatarUrl =
    ch.avatar && typeof ch.avatar === 'object' && typeof ch.avatar.url === 'string' ? ch.avatar.url : '';

  let guildBlock = '';
  if (ch.guild && typeof ch.guild === 'object' && typeof ch.guild.name === 'string') {
    const gRealm =
      ch.guild.realm &&
      typeof ch.guild.realm === 'object' &&
      typeof ch.guild.realm.name === 'string'
        ? ch.guild.realm.name
        : '';
    guildBlock = `
      <div class="armory-profile__guild">
        <span class="armory-profile__guild-label">Гильдия</span>
        <span class="armory-profile__guild-name">${escapeHtml(ch.guild.name)}</span>
        ${gRealm ? `<span class="armory-profile__guild-realm">${escapeHtml(gRealm)}</span>` : ''}
      </div>
    `;
  }

  const facEnum =
    ch.faction && typeof ch.faction === 'object' && typeof ch.faction.enum === 'string' ? ch.faction.enum : '';
  const facExtra =
    facEnum === 'HORDE' ? ' armory-profile__hero--horde' : facEnum === 'ALLIANCE' ? ' armory-profile__hero--alliance' : '';

  const outdated =
    ch.isOutdated === true
      ? '<p class="armory-profile__warn">Данные профиля на сайте Blizzard помечены как устаревшие.</p>'
      : '';

  const metaRows = [
    ['Уровень', level],
    ['Класс', cls],
    ['Спек', spec],
    ['Раса', race],
    ['Фракция', faction],
    ['Мир', realm],
    ['Регион', region],
    ['Средний ilvl', ilvl],
    ['Достижения', achieve],
  ]
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(
      ([k, v]) =>
        `<div class="armory-meta-row"><span class="armory-meta-row__k">${escapeHtml(k)}</span><span class="armory-meta-row__v">${escapeHtml(String(v))}</span></div>`,
    )
    .join('');

  const bustBg = bustUrl ? ` style="background-image:url('${escapeHtml(bustUrl)}')"` : '';
  const avatarBg = avatarUrl ? ` style="background-image:url('${escapeHtml(avatarUrl)}')"` : '';

  const statsHtml = renderStatsSection(ch.stats);
  const gearHtml = renderGearSection(ch.gear);
  const specsHtml = renderSpecsSection(ch.specs, ch.spec);
  const pveHtml = renderPveSection(ch.pve);

  const blizzardLink = profileUrl
    ? `<p class="armory-profile__source"><a href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer">Открыть оригинал на сайте Blizzard</a></p>`
    : '';

  return `
    <div class="armory-profile__inner">
      <button type="button" class="armory-btn armory-btn--secondary armory-profile__back">← К результатам поиска</button>
      ${outdated}
      <div class="armory-profile__hero${facExtra}">
        <div class="armory-profile__bust"${bustBg} role="img" aria-label=""></div>
        <div class="armory-profile__hero-text">
          <div class="armory-profile__avatar"${avatarBg} role="img" aria-label=""></div>
          <h2 class="armory-profile__name">${escapeHtml(name)}</h2>
          ${title ? `<p class="armory-profile__title">${escapeHtml(title)}</p>` : ''}
          ${guildBlock}
        </div>
      </div>
      <div class="armory-profile__meta-grid">${metaRows}</div>
      ${statsHtml}
      ${gearHtml}
      ${specsHtml}
      ${pveHtml}
      ${blizzardLink}
    </div>
  `;
}

/**
 * @param {Record<string, unknown>} c
 */
function renderCharacterCard(c) {
  const path = typeof c.url === 'string' ? c.url : '';
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
    <button type="button" class="armory-char armory-char-btn${facExtra}" data-profile-path="${escapeHtml(path)}">
      <div class="armory-char__row">
        <div class="armory-char__avatar"${style} role="img" aria-label=""></div>
        <div class="armory-char__meta">
          <div class="armory-char__name">${name}</div>
          <div class="armory-char__line"><b>${escapeHtml(String(level))}</b> ${escapeHtml(cls)}</div>
          <div class="armory-char__realm">${escapeHtml(realm)}</div>
        </div>
      </div>
    </button>
  `;
}

function bindArmoryNav() {
  const content = document.getElementById('armory-content');
  if (!content) {
    return;
  }
  content.addEventListener('click', (event) => {
    const back = event.target.closest('.armory-profile__back');
    if (back) {
      event.preventDefault();
      closeProfile();
      return;
    }
    const btn = event.target.closest('.armory-char-btn');
    if (btn) {
      const path = btn.getAttribute('data-profile-path');
      if (path) {
        openProfile(path);
      }
    }
  });
}

function closeProfile() {
  hideGearTooltip();
  profileGearCache = null;
  const profileEl = document.getElementById('armory-profile');
  const resultsEl = document.getElementById('armory-results');
  if (profileEl) {
    profileEl.innerHTML = '';
    profileEl.classList.add('hidden');
  }
  if (resultsEl) {
    resultsEl.classList.remove('hidden');
  }
}

/**
 * @param {string} relativePath
 */
async function openProfile(relativePath) {
  const profileEl = document.getElementById('armory-profile');
  const resultsEl = document.getElementById('armory-results');
  const statusEl = document.getElementById('armory-status');

  if (!profileEl) {
    return;
  }

  if (resultsEl) {
    resultsEl.classList.add('hidden');
  }
  profileEl.classList.remove('hidden');
  hideGearTooltip();
  profileEl.innerHTML =
    '<div class="armory-profile armory-profile--loading"><p>Загрузка профиля…</p></div>';

  if (statusEl) {
    statusEl.textContent = '';
    statusEl.classList.add('hidden');
  }

  try {
    const profileUrl = buildCharacterProfileUrl(relativePath);
    const html = await fetchBlizzardHtml(profileUrl);
    const jsonStr = extractCharacterProfileJson(html);
    if (!jsonStr) {
      throw new Error('Не удалось разобрать профиль: нет characterProfileInitialState.');
    }
    const data = JSON.parse(jsonStr);
    profileEl.innerHTML = `<div class="armory-profile">${renderProfileView(data, profileUrl)}</div>`;
    attachGearRowTooltips(profileEl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка загрузки';
    profileEl.innerHTML = `<div class="armory-profile"><p class="armory-profile__err">${escapeHtml(msg)}</p>
      <button type="button" class="armory-btn armory-btn--secondary armory-profile__back">← Назад</button></div>`;
  }
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
      <div id="armory-content">
        <section id="armory-results" class="armory-stack armory-results hidden" aria-live="polite"></section>
        <section id="armory-profile" class="armory-stack hidden" aria-live="polite"></section>
      </div>
      <p class="armory-footnote">
        Поиск совпадает с официальной страницей
        <a href="https://worldofwarcraft.blizzard.com/en-gb/search" target="_blank" rel="noopener noreferrer">worldofwarcraft.blizzard.com/…/search</a>.
        Карточки открывают профиль здесь (данные с armory). При блокировке CORS используется allorigins.win.
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

  bindArmoryNav();
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

  closeProfile();

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
    const html = await fetchBlizzardHtml(searchUrl);
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
