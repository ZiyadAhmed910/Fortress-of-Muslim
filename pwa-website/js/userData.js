import { APP_VERSION } from './constants.js';
import { state } from './state.js';
import { toast } from './utils.js';
import { applySettings } from './settings.js';
import { filterList } from './home.js';
import { ASR_METHODS, CALCULATION_METHODS, DEFAULT_ASR_METHOD, DEFAULT_CALCULATION_METHOD, DEFAULT_HIGH_LATITUDE_RULE, HIGH_LATITUDE_RULES } from './prayer-times.js';
import { scheduleToday as scheduleRemindersToday } from './reminders.js';
import { activateTasbih, TASBIH_STORAGE_KEY } from './tasbih.js';
import { readLayoutStorage, writeLayoutStorage } from './layout.js';
import { readQuranStorage, writeQuranStorage } from './quran.js';
import { readQuranAudioStorage, writeQuranAudioStorage } from './quran-audio.js';
import { refreshLayoutVisibility } from './modes.js';
import { syncLayoutConfigControls } from './layout-settings.js';

const BACKUP_KIND = 'fortress-of-muslim-user-data';

export function exportUserData() {
  const payload = {
    kind: BACKUP_KIND,
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    favourites: [...state.favourites],
    settings: {
      fontScale: state.fontScale,
      darkMode: state.darkMode,
      largeArabic: state.largeArabic,
      advancedUi: state.advancedUi,
      calculationMethod: state.calculationMethod,
      asrMethod: state.asrMethod,
      highLatitudeRule: state.highLatitudeRule,
      manualLatitude: state.manualLatitude,
      manualLongitude: state.manualLongitude,
      remindersEnabled: state.remindersEnabled,
      prayerAdhanEnabled: state.prayerAdhanEnabled,
      morningAdhkarEnabled: state.morningAdhkarEnabled,
      eveningAdhkarEnabled: state.eveningAdhkarEnabled,
    },
    // Tasbih keeps its own localStorage key (a structured {presets, activePresetId,
    // totalLifetimeCount} object, not a handful of independent primitives like the settings
    // above) -- read/written directly here rather than duplicating its shape into `settings`.
    tasbih: readTasbihStorage(),
    // Per-tab enable/Simple-Advanced-visibility config -- its own localStorage key/shape too,
    // same reasoning as tasbih above.
    layout: readLayoutStorage(),
    // Favourite surahs and ayahs, reading position and reader preferences -- its own key/shape too.
    quran: readQuranStorage(),
    // Reciter, repeat mode, word mode and follow-along -- again its own key and shape.
    quranAudio: readQuranAudioStorage(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `fortress-of-muslim-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast('Backup exported.');
}

export function importUserDataFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    try {
      importUserData(JSON.parse(reader.result));
    } catch {
      toast('Backup file could not be read.');
    }
  });
  reader.readAsText(file);
}

function importUserData(payload) {
  if (!payload || payload.kind !== BACKUP_KIND) {
    toast('This is not a Fortress backup.');
    return;
  }

  const settings = payload.settings || {};
  state.favourites = new Set(Array.isArray(payload.favourites) ? payload.favourites : []);
  state.fontScale = clampNumber(settings.fontScale, 0.82, 1.9, state.fontScale);
  state.darkMode = Boolean(settings.darkMode);
  state.largeArabic = Boolean(settings.largeArabic);
  state.advancedUi = Boolean(settings.advancedUi);
  state.calculationMethod = CALCULATION_METHODS[settings.calculationMethod] ? settings.calculationMethod : DEFAULT_CALCULATION_METHOD;
  state.asrMethod = ASR_METHODS[settings.asrMethod] ? settings.asrMethod : DEFAULT_ASR_METHOD;
  state.highLatitudeRule = HIGH_LATITUDE_RULES[settings.highLatitudeRule] ? settings.highLatitudeRule : DEFAULT_HIGH_LATITUDE_RULE;
  state.manualLatitude = typeof settings.manualLatitude === 'number' ? clampNumber(settings.manualLatitude, -90, 90, null) : null;
  state.manualLongitude = typeof settings.manualLongitude === 'number' ? clampNumber(settings.manualLongitude, -180, 180, null) : null;
  state.remindersEnabled = Boolean(settings.remindersEnabled);
  state.prayerAdhanEnabled = Boolean(settings.prayerAdhanEnabled);
  state.morningAdhkarEnabled = settings.morningAdhkarEnabled !== false;
  state.eveningAdhkarEnabled = settings.eveningAdhkarEnabled !== false;

  localStorage.setItem('favourites', JSON.stringify([...state.favourites]));
  localStorage.setItem('fontScale', String(state.fontScale));
  localStorage.setItem('darkMode', String(state.darkMode));
  localStorage.setItem('largeArabic', String(state.largeArabic));
  localStorage.setItem('advancedUi', String(state.advancedUi));
  localStorage.setItem('calculationMethod', state.calculationMethod);
  localStorage.setItem('asrMethod', state.asrMethod);
  localStorage.setItem('highLatitudeRule', state.highLatitudeRule);
  if (state.manualLatitude !== null && state.manualLongitude !== null) {
    localStorage.setItem('manualLatitude', String(state.manualLatitude));
    localStorage.setItem('manualLongitude', String(state.manualLongitude));
  } else {
    localStorage.removeItem('manualLatitude');
    localStorage.removeItem('manualLongitude');
  }
  localStorage.setItem('remindersEnabled', String(state.remindersEnabled));
  localStorage.setItem('prayerAdhanEnabled', String(state.prayerAdhanEnabled));
  localStorage.setItem('morningAdhkarEnabled', String(state.morningAdhkarEnabled));
  localStorage.setItem('eveningAdhkarEnabled', String(state.eveningAdhkarEnabled));
  writeTasbihStorage(payload.tasbih);
  writeLayoutStorageIfPresent(payload.layout);
  if (payload.quran && typeof payload.quran === 'object') writeQuranStorage(payload.quran);
  if (payload.quranAudio && typeof payload.quranAudio === 'object') writeQuranAudioStorage(payload.quranAudio);

  applySettings();
  filterList();
  scheduleRemindersToday();
  activateTasbih();
  syncLayoutConfigControls();
  refreshLayoutVisibility();
  toast('Backup imported.');
}

function readTasbihStorage() {
  try {
    return JSON.parse(localStorage.getItem(TASBIH_STORAGE_KEY));
  } catch {
    return null;
  }
}

// Only overwrites the stored tasbih data when the backup actually has a recognizable one --
// a backup from before this feature existed simply won't have a `tasbih` field, and the counter
// should keep whatever's already on this device rather than being wiped by an old backup.
function writeTasbihStorage(value) {
  if (!value || !Array.isArray(value.presets) || value.presets.length === 0) return;
  const presets = value.presets
    .filter((preset) => preset && typeof preset.id === 'string' && typeof preset.label === 'string')
    .map((preset) => ({
      id: preset.id,
      label: preset.label,
      labelArabic: typeof preset.labelArabic === 'string' ? preset.labelArabic : '',
      count: Number.isFinite(preset.count) && preset.count >= 0 ? Math.floor(preset.count) : 0,
      target: Number.isFinite(preset.target) && preset.target > 0 ? Math.floor(preset.target) : 33,
    }));
  if (presets.length === 0) return;
  localStorage.setItem(TASBIH_STORAGE_KEY, JSON.stringify({
    presets,
    activePresetId: presets.some((preset) => preset.id === value.activePresetId) ? value.activePresetId : presets[0].id,
    totalLifetimeCount: Number.isFinite(value.totalLifetimeCount) && value.totalLifetimeCount >= 0 ? Math.floor(value.totalLifetimeCount) : 0,
  }));
}

// Only overwrites the stored layout config when the backup actually has one -- a backup from
// before this feature existed simply won't have a `layout` field, and the current device's tab
// choices should stick rather than being reset to defaults by an old backup.
function writeLayoutStorageIfPresent(value) {
  if (!value || typeof value !== 'object') return;
  writeLayoutStorage(value);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
