import { els } from './dom.js';
import { state } from './state.js';

// Shown once, on first run, and skippable from every step. It exists because the app's two most
// useful behaviours are invisible: everything works offline, and half the features are off by
// default until someone finds Settings. A first-run tour is the only place to say so before the
// user has formed the impression that the app is just a list of duas.
const STORAGE_KEY = 'fortress_onboarding_seen';
// Bumped when a step is added that existing users should also see. A plain boolean would silently
// hide new steps from everyone who already ran the app once.
const VERSION = 1;

const STEPS = [
  {
    title: 'Everything here works offline',
    body: 'Duas, the full Quran with translation, prayer times, qibla and the tasbih counter all run on your device. Only Hadith search and Ask need a connection.',
    icon: '&#9729;',
  },
  {
    title: 'Read the Quran your way',
    body: 'Tajweed colouring and page-turning are on by default. In Settings you can switch to continuous scroll, choose a reciter, and turn on word-by-word meanings.',
    icon: '&#128214;',
  },
  {
    title: 'Prayer times and qibla',
    body: 'Both need your location, which stays on your device -- nothing is sent anywhere. You can also enter coordinates by hand if you would rather not share location.',
    icon: '&#128506;',
  },
  {
    title: 'Make it yours',
    body: 'Settings lets you hide anything you do not use, switch between the simple and advanced layouts, set reminders, and back everything up to a file.',
    icon: '&#9881;',
  },
];

let step = 0;

export function initOnboarding() {
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
  step = 0;
  render();
  els.onboarding.hidden = false;
  // Focus moves into the dialog so the tour is operable by keyboard and announced by a screen
  // reader, rather than leaving focus on whatever was behind it.
  els.onboarding.querySelector('[data-onboarding-next]')?.focus();
}

/** Exposed so Settings can offer "show the walkthrough again". */
export function replayOnboarding() {
  step = 0;
  render();
  els.onboarding.hidden = false;
  els.onboarding.querySelector('[data-onboarding-next]')?.focus();
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
  if (button.dataset.onboardingDot !== undefined) {
    step = Number(button.dataset.onboardingDot);
    render();
  }
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
  state.onboardingSeen = true;
}

function render() {
  const current = STEPS[step];
  const last = step === STEPS.length - 1;
  els.onboardingIcon.innerHTML = current.icon;
  els.onboardingTitle.textContent = current.title;
  els.onboardingBody.textContent = current.body;
  els.onboardingBack.hidden = step === 0;
  els.onboardingNext.textContent = last ? 'Get started' : 'Next';
  els.onboardingProgress.innerHTML = STEPS.map((item, i) => `
    <button type="button" class="onboarding-dot${i === step ? ' is-current' : ''}"
      data-onboarding-dot="${i}" aria-label="Step ${i + 1}: ${item.title}"
      ${i === step ? 'aria-current="step"' : ''}></button>
  `).join('');
}
