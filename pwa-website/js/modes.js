import { els } from './dom.js';
import { state } from './state.js';
import { activateHadith } from './hadith.js';

export function initContentModes() {
  els.contentModeButtons.forEach((button) => button.addEventListener('click', () => setContentMode(button.dataset.contentMode)));
  setContentMode('duas');
}

export function setContentMode(mode) {
  if (!['duas', 'hadith', 'ask'].includes(mode)) return;
  state.contentMode = mode;
  const showingDuas = mode === 'duas';
  els.app.classList.remove('is-reader', 'mode-hadith', 'mode-ask');
  if (!showingDuas) els.app.classList.add(`mode-${mode}`);
  els.advancedHome.hidden = !showingDuas;
  els.simpleHome.hidden = !showingDuas;
  els.hadithHome.hidden = mode !== 'hadith';
  els.assistantHome.hidden = mode !== 'ask';
  els.contentModeButtons.forEach((button) => button.classList.toggle('active', button.dataset.contentMode === mode));
  if (mode === 'duas') {
    els.screenTitle.textContent = 'Fortress of Muslim';
    els.screenSubtitle.textContent = 'Verified canonical chapters available offline';
  } else if (mode === 'hadith') {
    els.screenTitle.textContent = 'Hadith Library';
    els.screenSubtitle.textContent = 'Bukhari, Muslim, and Tirmidhi - online';
    activateHadith();
  } else {
    els.screenTitle.textContent = 'Ask Fortress';
    els.screenSubtitle.textContent = 'Source-grounded answers - online';
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}
