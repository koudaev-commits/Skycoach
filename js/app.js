'use strict';

/**
 * @param {string} characterName
 */
function runAnalysis(characterName) {
  const trimmed = characterName.trim();
  if (!trimmed) {
    return;
  }
  // Business logic will run here.
  console.info('[Skycoach] analyze:', trimmed);
}

function renderLanding() {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }

  root.innerHTML = `
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
          <button type="submit" class="armory-btn">Анализировать</button>
        </div>
      </form>
    </section>
    <p class="armory-footnote">
      Локальный режим: данные персонажа будут подставляться из моков без обращения к серверам Blizzard.
    </p>
  `;

  const form = document.getElementById('armory-form');
  const input = document.getElementById('character-name');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runAnalysis(input.value);
  });
}

document.addEventListener('DOMContentLoaded', renderLanding);
