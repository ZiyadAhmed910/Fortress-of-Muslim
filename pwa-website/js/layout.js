import { state } from './state.js';
import { els } from './dom.js';

const STORAGE_KEY = 'fortress_layout_config';

// Duas is the permanent anchor/home -- deliberately not configurable here, always enabled, always
// visible in both Simple and Advanced UI, so the app always has at least one guaranteed-reachable
// view no matter how everything else is configured.
// Prayer is a real configurable entry rather than a label, because it is a real thing on the nav:
// one button that opens three screens. Switching it off has to take its children with it, and a
// child cannot be reachable without it -- see isTabVisible and setTabEnabled below.
export const CONFIGURABLE_TABS = [
  { id: 'quran', label: 'Quran' },
  { id: 'hadith', label: 'Hadith' },
  { id: 'ask', label: 'Ask' },
  { id: 'prayer', label: 'Prayer' },
  { id: 'prayerTimes', label: 'Prayer Times', parent: 'prayer' },
  { id: 'qibla', label: 'Qibla', parent: 'prayer' },
  { id: 'tasbih', label: 'Tasbih Counter', parent: 'prayer' },
];
const PARENT_OF = Object.fromEntries(
  CONFIGURABLE_TABS.filter((tab) => tab.parent).map((tab) => [tab.id, tab.parent]),
);

export function parentTabOf(tabId) {
  return PARENT_OF[tabId] ?? null;
}

const CONFIGURABLE_TAB_IDS = new Set(CONFIGURABLE_TABS.map((tab) => tab.id));
const VISIBILITY_VALUES = new Set(['simple', 'advanced', 'both']);
const DEFAULT_TAB_CONFIG = { enabled: true, visibility: 'both' };

let config = loadConfig();

function defaultConfig() {
  const result = {};
  CONFIGURABLE_TABS.forEach(({ id }) => { result[id] = { ...DEFAULT_TAB_CONFIG }; });
  return result;
}

function normalizeConfig(raw) {
  const result = defaultConfig();
  CONFIGURABLE_TABS.forEach(({ id }) => {
    const entry = raw?.[id];
    if (!entry) return;
    if (typeof entry.enabled === 'boolean') result[id].enabled = entry.enabled;
    if (VISIBILITY_VALUES.has(entry.visibility)) result[id].visibility = entry.visibility;
  });
  return result;
}

function loadConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed && typeof parsed === 'object') return normalizeConfig(parsed);
  } catch {
    // fall through to defaults -- a corrupted value shouldn't lock someone out of their own tabs
  }
  return defaultConfig();
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function getTabConfig(tabId) {
  return config[tabId] ? { ...config[tabId] } : { ...DEFAULT_TAB_CONFIG };
}

export function setTabEnabled(tabId, enabled) {
  if (!config[tabId]) return;
  config[tabId].enabled = Boolean(enabled);
  // Switching a child on implies its parent: Qibla cannot be reached with Prayer switched off, so
  // asking for Qibla is asking for Prayer. Switching a parent off does NOT clear its children's own
  // settings -- they are hidden by isTabVisible while it is off, and come back as they were when it
  // returns, rather than being silently rewritten.
  const parent = PARENT_OF[tabId];
  if (enabled && parent && config[parent] && !config[parent].enabled) config[parent].enabled = true;
  persist();
}

export function setTabVisibility(tabId, visibility) {
  if (!config[tabId] || !VISIBILITY_VALUES.has(visibility)) return;
  config[tabId].visibility = visibility;
  persist();
}

// Re-reads the stored config from localStorage -- used after a backup import, since that writes
// localStorage directly rather than going through setTabEnabled/setTabVisibility.
export function readLayoutStorage() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeLayoutStorage(raw) {
  config = normalizeConfig(raw);
  persist();
}

// Whether `tabId` should currently be reachable: enabled, and its visibility either covers both UI
// modes or matches the one currently active.
export function isTabVisible(tabId) {
  if (!CONFIGURABLE_TAB_IDS.has(tabId)) return true; // Duas, or anything not under this system
  const entry = getTabConfig(tabId);
  if (!entry.enabled) return false;
  if (entry.visibility !== 'both' && entry.visibility !== (state.advancedUi ? 'advanced' : 'simple')) {
    return false;
  }
  // A child is only reachable through its parent, so the parent's own rules apply to it too -- both
  // its enabled state and its Simple/Advanced visibility.
  const parent = PARENT_OF[tabId];
  return parent ? isTabVisible(parent) : true;
}

// Prayer Times, Qibla and Tasbih sit behind one "Prayer" tab, so that tab follows its members: it
// appears when any of them is visible, and its sub-bar only offers the ones that are. With a single
// member left the sub-bar is pointless, so it is suppressed and the tab acts as a direct link.
export const WORSHIP_TABS = ['prayerTimes', 'qibla', 'tasbih'];

export function visibleWorshipTabs() {
  return WORSHIP_TABS.filter(isTabVisible);
}

/** Hides/shows each non-Duas nav button per the current config + Simple/Advanced UI state. */
export function applyLayoutToNav() {
  els.contentModeButtons.forEach((button) => {
    const tabId = button.dataset.contentMode;
    if (tabId === 'duas') return;
    button.hidden = !isTabVisible(tabId);
  });
  const worship = visibleWorshipTabs();
  els.contentGroupButtons.forEach((button) => {
    if (button.dataset.contentGroup === 'worship') button.hidden = worship.length === 0;
  });
}
