import { els } from './dom.js';

// Shown once, on first run, and skippable from every step. It exists because the app's most useful
// properties are invisible on arrival: nearly everything works offline, the duas can be heard as
// well as read, and the things worth setting up -- a reciter, reminders, offline downloads -- are
// behind Settings, where nobody looks first.
//
// Each step shows the actual control it is describing -- the same icons, at the same weight, that
// the app uses -- and offers to take you straight there. A tour that only describes things in prose
// leaves the reader to go and find them afterwards, by which point they have forgotten which icon
// was which.
const STORAGE_KEY = 'fortress_onboarding_seen';
// A version rather than a boolean, so a step added later can be shown to people who already ran the
// app once. Deliberately still 2 after the 0.50.2 rewrite: the tour had fallen behind the app (it
// still offered to hide tabs, a setting removed in 0.39.0, and knew nothing of dua recitation, the
// calendar or offline downloads), but the owner's call was that people who have already seen a tour
// need not be shown it again -- new installs get the new one, and anyone can replay it from Settings.
// test/guide-and-tasbih.test.js holds the tour to what the app actually has.
const VERSION = 2;

// Traced from the real navigation and control markup so the tour and the app cannot drift apart
// visually. Kept here rather than cloned from the DOM at runtime: the nav is re-rendered by the
// layout config, and cloning would sometimes catch it mid-update or with tabs already hidden.
const ICONS = {
  duas: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22V5.5Z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v17h4.5A2.5 2.5 0 0 1 20 22V5.5Z"/>',
  quran: '<path d="M12 6.5S9.5 4 6 4a2 2 0 0 0-2 2v11a2 2 0 0 1 2-2c3.5 0 6 2.5 6 2.5"/><path d="M12 6.5S14.5 4 18 4a2 2 0 0 1 2 2v11a2 2 0 0 0-2-2c-3.5 0-6 2.5-6 2.5"/><path d="M12 6.5V17"/>',
  hadith: '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  ask: '<path d="M12 3a7 7 0 0 0-4 12.7V20l4-2 4 2v-4.3A7 7 0 0 0 12 3Z"/><path d="M9.5 10a2.5 2.5 0 1 1 4.2 1.8c-.9.7-1.7 1.1-1.7 2.2M12 16h.01"/>',
  prayer: '<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 2"/>',
  qibla: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
  tasbih: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="4" r="1.6"/><circle cx="20" cy="12" r="1.6"/><circle cx="12" cy="20" r="1.6"/><circle cx="4" cy="12" r="1.6"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  offline: '<path d="M3 15a4 4 0 0 1 3.6-4 6 6 0 0 1 11.6 1.2A3.5 3.5 0 0 1 17.5 19H7a4 4 0 0 1-4-4Z"/><path d="m9 12 2 2 4-4"/>',
  // The Calendar tab's own icon (index.html), so the tour shows the button it is talking about.
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  listen: '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  shortcut: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 18.5h4"/><path d="M9 8.5h6M9 11.5h6"/>',
};

const icon = (name, className = '') => `<svg class="onboarding-glyph ${className}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

// A miniature of the real tab bar, with one tab lit, so "the Quran tab" is something you have
// already seen before you go looking for it.
const navStrip = (active) => `
  <div class="onboarding-nav" aria-hidden="true">
    ${[['duas', 'Duas'], ['quran', 'Quran'], ['hadith', 'Hadith'], ['ask', 'Ask'], ['prayer', 'Prayer']]
      .map(([key, label]) => `
        <span class="onboarding-tab${key === active ? ' is-active' : ''}">
          ${icon(key)}<small>${label}</small>
        </span>
      `).join('')}
  </div>
`;

// Settings is a text glyph in a round button, not an SVG like the nav icons, so the tour shows that
// same glyph in the same chrome rather than a drawing of a gear. The drawn one looked nothing like
// the control it was pointing at, which is the whole thing this tour is supposed to avoid.
const settingsControl = () => `
  <div class="onboarding-hero">
    <span class="icon-button onboarding-control" aria-hidden="true">⚙</span>
  </div>
`;

const STEPS = [
  {
    title: 'Works without a connection',
    body: 'Duas and their recitation, the whole Quran, prayer times, qibla, the tasbih counter and the Islamic calendar all run on your device. Only Hadith and Ask need the internet.',
    visual: () => `<div class="onboarding-hero">${icon('offline', 'is-large')}</div>`,
  },
  {
    title: 'Everything sits on one bar',
    body: 'These five tabs are the whole app. Prayer holds prayer times, qibla, the tasbih counter and the Islamic calendar.',
    visual: () => navStrip('prayer'),
  },
  {
    title: 'Read and listen to the duas',
    body: 'Hisn al-Muslim, with Arabic, transliteration and translation. Tap Listen on a dua to hear it recited -- morning and evening wordings each have their own. Star the ones you return to.',
    visual: () => `<div class="onboarding-hero">${icon('duas', 'is-large')}<span class="onboarding-plus">+</span>${icon('listen', 'is-large')}</div>`,
    action: { label: 'Open the duas', mode: 'duas' },
  },
  {
    title: 'Read and listen to the Quran',
    body: 'All 114 surahs with English translation and tajweed colouring. Tap play on any ayah and the recitation carries on through the surah.',
    visual: () => `<div class="onboarding-hero">${icon('quran', 'is-large')}<span class="onboarding-plus">+</span>${icon('play', 'is-large')}</div>`,
    action: { label: 'Open the Quran', mode: 'quran' },
  },
  {
    title: 'Prayer times, qibla and the calendar',
    body: 'Worked out from your location, which never leaves your device -- or type coordinates in by hand. The Islamic calendar follows the moon-sighting practice where you are, and you can move it a day to match your local announcement.',
    visual: () => `<div class="onboarding-hero">${icon('prayer', 'is-large')}<span class="onboarding-plus">+</span>${icon('calendar', 'is-large')}</div>`,
    action: { label: 'Show prayer times', mode: 'prayerTimes' },
  },
  {
    title: 'Make it yours',
    body: 'Settings is behind this icon, at the top right. Choose a reciter, turn on word-by-word meanings, set prayer and adhkar reminders, and under Data save the recitation for offline listening and see what is stored on your phone.',
    visual: () => settingsControl(),
    action: { label: 'Open Settings', settings: true },
  },
  {
    title: 'Add it to your home screen',
    body: 'Install the app from Settings, or your browser menu. On Android, press and hold its icon to jump straight to Prayer Times, Qibla, Tasbih or the Quran.',
    visual: () => `<div class="onboarding-hero">${icon('shortcut', 'is-large')}</div>`,
  },
];

let step = 0;
let nav = { goTo: null, canGoTo: () => true, openSettings: null };

export function initOnboarding({ goTo, canGoTo, openSettings } = {}) {
  nav = { goTo, canGoTo: canGoTo || (() => true), openSettings };
  els.onboarding.addEventListener('click', onClick);
  document.addEventListener('keydown', (event) => {
    if (els.onboarding.hidden) return;
    if (event.key === 'Escape') finish();
    if (event.key === 'ArrowRight') go(1);
    if (event.key === 'ArrowLeft') go(-1);
  });
}

export function maybeShowOnboarding() {
  if (seenVersion() >= VERSION) return;
  open();
}

/** Exposed so Settings can offer "show the walkthrough again". */
export function replayOnboarding() {
  open();
}

function open() {
  step = 0;
  render();
  els.onboarding.hidden = false;
  // Focus moves into the dialog so the tour is operable by keyboard and announced by a screen
  // reader, rather than leaving focus on whatever was behind it.
  els.onboardingNext.focus();
}

function seenVersion() {
  const raw = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(raw) ? raw : 0;
}

function onClick(event) {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.onboardingSkip !== undefined) return finish();
  if (button.dataset.onboardingNext !== undefined) return go(1);
  if (button.dataset.onboardingBack !== undefined) return go(-1);
  if (button.dataset.onboardingAction !== undefined) return runAction();
  if (button.dataset.onboardingDot !== undefined) {
    step = Number(button.dataset.onboardingDot);
    render();
  }
}

// Taking the offer ends the tour rather than resuming it afterwards: you asked to go somewhere, so
// go there. The tour is replayable from Settings if it was cut short by mistake.
function runAction() {
  const { action } = STEPS[step];
  if (!action) return;
  finish();
  if (action.settings) nav.openSettings?.();
  else if (action.mode) nav.goTo?.(action.mode);
}

function go(delta) {
  const next = step + delta;
  if (next < 0) return;
  if (next >= STEPS.length) return finish();
  step = next;
  render();
}

function finish() {
  localStorage.setItem(STORAGE_KEY, String(VERSION));
  els.onboarding.hidden = true;
}

function render() {
  const current = STEPS[step];
  const last = step === STEPS.length - 1;
  els.onboardingVisual.innerHTML = current.visual();
  els.onboardingTitle.textContent = current.title;
  els.onboardingBody.textContent = current.body;
  els.onboardingBack.hidden = step === 0;
  els.onboardingNext.textContent = last ? 'Done' : 'Next';

  // The offer is withheld for a tab the layout config has hidden -- pointing someone at a screen
  // they have switched off would be worse than saying nothing.
  const reachable = current.action
    && (current.action.settings || nav.canGoTo(current.action.mode));
  els.onboardingAction.hidden = !reachable;
  if (reachable) els.onboardingAction.textContent = current.action.label;

  els.onboardingProgress.innerHTML = STEPS.map((item, i) => `
    <button type="button" class="onboarding-dot${i === step ? ' is-current' : ''}"
      data-onboarding-dot="${i}" aria-label="Step ${i + 1}: ${item.title}"
      ${i === step ? 'aria-current="step"' : ''}></button>
  `).join('');
}
