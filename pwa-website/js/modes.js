import { els } from './dom.js';
import { state } from './state.js';
import { activateHadith } from './hadith.js';
import { activateQuran } from './quran.js';
import { activatePrayerTimes, activateQibla, deactivatePrayerTimes, deactivateQibla } from './prayer.js';
import { activateTasbih } from './tasbih.js';
import { applyLayoutToNav, isTabVisible, visibleWorshipTabs, WORSHIP_TABS } from './layout.js';

const MODES = ['duas', 'quran', 'hadith', 'ask', 'prayerTimes', 'qibla', 'tasbih'];

export function initContentModes() {
  els.contentModeButtons.forEach((button) => button.addEventListener('click', () => setContentMode(button.dataset.contentMode)));
  // The group button opens whichever worship tool was last used, falling back to the first one still
  // enabled, so it never lands on a tab the reader has switched off.
  els.contentGroupButtons.forEach((button) => button.addEventListener('click', () => {
    const available = visibleWorshipTabs();
    if (!available.length) return;
    setContentMode(available.includes(state.lastWorshipMode) ? state.lastWorshipMode : available[0]);
  }));
  applyLayoutToNav();
  setContentMode('duas');
}

export function setContentMode(requestedMode) {
  // A disabled/hidden tab (per the layout config, or a Simple/Advanced UI mismatch) can still be
  // requested indirectly (e.g. a stale notification link) -- fall back to Duas, the one tab that's
  // always guaranteed reachable, rather than showing a tab the user chose to hide.
  const mode = MODES.includes(requestedMode) && isTabVisible(requestedMode) ? requestedMode : 'duas';
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
  els.prayerTimesHome.hidden = mode !== 'prayerTimes';
  els.qiblaHome.hidden = mode !== 'qibla';
  els.tasbihHome.hidden = mode !== 'tasbih';
  els.contentModeButtons.forEach((button) => button.classList.toggle('active', button.dataset.contentMode === mode));
  applyWorshipNav(mode);
  if (previousMode === 'prayerTimes' && mode !== 'prayerTimes') deactivatePrayerTimes();
  if (previousMode === 'qibla' && mode !== 'qibla') deactivateQibla();
  if (mode === 'duas') {
    els.screenTitle.textContent = 'Fortress of Muslim';
    els.screenSubtitle.textContent = 'Verified canonical chapters available offline';
  } else if (mode === 'quran') {
    els.screenTitle.textContent = 'Quran';
    els.screenSubtitle.textContent = 'Arabic with English translation - works offline';
    activateQuran();
  } else if (mode === 'hadith') {
    els.screenTitle.textContent = 'Hadith Library';
    els.screenSubtitle.textContent = 'Bukhari, Muslim, and Tirmidhi - online';
    activateHadith();
  } else if (mode === 'prayerTimes') {
    els.screenTitle.textContent = 'Prayer Times';
    els.screenSubtitle.textContent = 'Computed on this device - works offline';
    activatePrayerTimes();
  } else if (mode === 'qibla') {
    els.screenTitle.textContent = 'Qibla Direction';
    els.screenSubtitle.textContent = 'Computed on this device - works offline';
    activateQibla();
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

// The sub-bar is only shown inside the worship modes, and only when more than one of them is
// enabled -- with a single member it would be a bar with one button.
function applyWorshipNav(mode) {
  const inWorship = WORSHIP_TABS.includes(mode);
  if (inWorship) state.lastWorshipMode = mode;
  const available = visibleWorshipTabs();
  els.worshipSubnav.hidden = !inWorship || available.length < 2;
  els.worshipSubnav.querySelectorAll('[data-content-mode]').forEach((button) => {
    button.hidden = !available.includes(button.dataset.contentMode);
    button.classList.toggle('active', button.dataset.contentMode === mode);
  });
  els.contentGroupButtons.forEach((button) => {
    if (button.dataset.contentGroup === 'worship') button.classList.toggle('active', inWorship);
  });
}

/** Re-applies the layout config to the nav and, if the currently active tab just became hidden
 * (disabled, or a Simple/Advanced visibility mismatch after a toggle), falls back to Duas. Call
 * this after any layout config change or Simple/Advanced UI toggle. */
export function refreshLayoutVisibility() {
  applyLayoutToNav();
  if (!isTabVisible(state.contentMode)) setContentMode('duas');
}
