import { els } from './dom.js';
import { state } from './state.js';
import { activateHadith } from './hadith.js';
import { activatePrayer, deactivatePrayer } from './prayer.js';
import { activateTasbih } from './tasbih.js';

const MODES = ['duas', 'hadith', 'ask', 'prayer', 'tasbih'];

export function initContentModes() {
  els.contentModeButtons.forEach((button) => button.addEventListener('click', () => setContentMode(button.dataset.contentMode)));
  setContentMode('duas');
}

export function setContentMode(mode) {
  if (!MODES.includes(mode)) return;
  const previousMode = state.contentMode;
  state.contentMode = mode;
  const showingDuas = mode === 'duas';
  els.app.classList.remove('is-reader', 'mode-hadith', 'mode-ask', 'mode-prayer', 'mode-tasbih');
  if (!showingDuas) els.app.classList.add(`mode-${mode}`);
  els.advancedHome.hidden = !showingDuas;
  els.simpleHome.hidden = !showingDuas;
  els.hadithHome.hidden = mode !== 'hadith';
  els.assistantHome.hidden = mode !== 'ask';
  els.prayerHome.hidden = mode !== 'prayer';
  els.tasbihHome.hidden = mode !== 'tasbih';
  els.contentModeButtons.forEach((button) => button.classList.toggle('active', button.dataset.contentMode === mode));
  if (previousMode === 'prayer' && mode !== 'prayer') deactivatePrayer();
  if (mode === 'duas') {
    els.screenTitle.textContent = 'Fortress of Muslim';
    els.screenSubtitle.textContent = 'Verified canonical chapters available offline';
  } else if (mode === 'hadith') {
    els.screenTitle.textContent = 'Hadith Library';
    els.screenSubtitle.textContent = 'Bukhari, Muslim, and Tirmidhi - online';
    activateHadith();
  } else if (mode === 'prayer') {
    els.screenTitle.textContent = 'Prayer Times & Qibla';
    els.screenSubtitle.textContent = 'Computed on this device - works offline';
    activatePrayer();
  } else if (mode === 'tasbih') {
    els.screenTitle.textContent = 'Tasbih Counter';
    els.screenSubtitle.textContent = 'Offline dhikr counter';
    activateTasbih();
  } else {
    els.screenTitle.textContent = 'Ask Fortress';
    els.screenSubtitle.textContent = 'Source-grounded answers - online';
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}
