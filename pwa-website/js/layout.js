import { state } from './state.js';
import { els } from './dom.js';

const STORAGE_KEY = 'fortress_layout_config';

// Duas is the permanent anchor/home -- deliberately not configurable here, always enabled, always
// visible in both Simple and Advanced UI, so the app always has at least one guaranteed-reachable
// view no matter how everything else is configured.
export const CONFIGURABLE_TABS = [
  { id: 'hadith', label: 'Hadith' },
  { id: 'ask', label: 'Ask' },
  { id: 'prayerTimes', label: 'Prayer Times' },
  { id: 'qibla', label: 'Qibla' },
  { id: 'tasbih', label: 'Tasbih Counter' },
];
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
  persist();
}

export function setTabVisibility(tabId, visibility) {
  if (!config[tabId] || !VISIBILITY_VALUES.has(visibility)) return;
  config[tabId].visibility = visibility;
  persist();
}

// Re-reads the stored config from localStorage -- used after a backup import, since that writes
// localStorage directly rather than going through setTabEnabled/setTabVisibility.
export function reloadLayoutConfig() {
  config = loadConfig();
}

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
  if (entry.visibility === 'both') return true;
  return entry.visibility === (state.advancedUi ? 'advanced' : 'simple');
}

/** Hides/shows each non-Duas nav button per the current config + Simple/Advanced UI state. */
export function applyLayoutToNav() {
  els.contentModeButtons.forEach((button) => {
    const tabId = button.dataset.contentMode;
    if (tabId === 'duas') return;
    button.hidden = !isTabVisible(tabId);
  });
}
