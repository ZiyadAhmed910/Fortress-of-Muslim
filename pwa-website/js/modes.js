import { els } from './dom.js';
import { setScreen } from './seo.js';
import { fitAssistantHeight } from './assistant.js';
import { state } from './state.js';
import { activateHadith } from './hadith.js';
import { activateQuran } from './quran.js';
import { activatePrayerTimes, activateQibla, deactivatePrayerTimes, deactivateQibla } from './prayer.js';
import { activateTasbih } from './tasbih.js';
import { WORSHIP_TABS } from './layout.js';

const MODES = ['duas', 'quran', 'hadith', 'ask', 'prayerTimes', 'qibla', 'tasbih'];

export function initContentModes() {
  els.contentModeButtons.forEach((button) => button.addEventListener('click', () => setContentMode(button.dataset.contentMode)));
  // The group button opens whichever worship tool was last used, and Prayer Times the first time.
  els.contentGroupButtons.forEach((button) => button.addEventListener('click', () => {
    setContentMode(WORSHIP_TABS.includes(state.lastWorshipMode) ? state.lastWorshipMode : WORSHIP_TABS[0]);
  }));
  setContentMode('duas');
}

export function setContentMode(requestedMode) {
  // A mode can be requested indirectly -- a stale notification link, a saved route -- so anything
  // this app does not have falls back to Duas, which is the home tab and always exists.
  const mode = MODES.includes(requestedMode) ? requestedMode : 'duas';
  const previousMode = state.contentMode;
  state.contentMode = mode;
  const showingDuas = mode === 'duas';
  els.app.classList.remove('is-reader', 'mode-quran', 'mode-hadith', 'mode-ask', 'mode-prayerTimes', 'mode-qibla', 'mode-tasbih');
  if (!showingDuas) els.app.classList.add(`mode-${mode}`);
  els.advancedHome.hidden = !showingDuas;
  els.simpleHome.hidden = !showingDuas;
  els.quranHome.hidden = mode !== 'quran';
  els.hadithHome.hidden = mode !== 'hadith';
  els.assistantHome.hidden = mode !== 'ask';
  // Measured once it is on screen: the chat column sizes itself to what is left below the header,
  // and a hidden element has no measurable top.
  if (mode === 'ask') fitAssistantHeight();
  els.prayerTimesHome.hidden = mode !== 'prayerTimes';
  els.qiblaHome.hidden = mode !== 'qibla';
  els.tasbihHome.hidden = mode !== 'tasbih';
  els.contentModeButtons.forEach((button) => button.classList.toggle('active', button.dataset.contentMode === mode));
  applyWorshipNav(mode);
  if (previousMode === 'prayerTimes' && mode !== 'prayerTimes') deactivatePrayerTimes();
  if (previousMode === 'qibla' && mode !== 'qibla') deactivateQibla();
  if (mode === 'duas') {
    setScreen('Fortress of Muslim', 'Supplications and remembrances - works offline');
  } else if (mode === 'quran') {
    setScreen('Quran', 'Arabic with English translation - works offline');
    activateQuran();
  } else if (mode === 'hadith') {
    setScreen('Hadith Library', 'Bukhari, Muslim, and Tirmidhi - online');
    activateHadith();
  } else if (mode === 'prayerTimes') {
    setScreen('Prayer Times', 'Prayer times for where you are - works offline');
    activatePrayerTimes();
  } else if (mode === 'qibla') {
    setScreen('Qibla Direction', 'The way to the Kaaba from where you are - works offline');
    activateQibla();
  } else if (mode === 'tasbih') {
    setScreen('Tasbih Counter', 'Offline dhikr counter');
    activateTasbih();
  } else {
    setScreen('Ask Fortress', 'Answers with the sources to check them - online');
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// The sub-bar belongs to the worship modes and is shown only inside them.
function applyWorshipNav(mode) {
  const inWorship = WORSHIP_TABS.includes(mode);
  if (inWorship) state.lastWorshipMode = mode;
  els.worshipSubnav.hidden = !inWorship;
  els.worshipSubnav.querySelectorAll('[data-content-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.contentMode === mode);
  });
  els.contentGroupButtons.forEach((button) => {
    if (button.dataset.contentGroup === 'worship') button.classList.toggle('active', inWorship);
  });
}
