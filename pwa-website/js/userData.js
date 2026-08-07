import { APP_VERSION } from './constants.js';
import { state } from './state.js';
import { toast } from './utils.js';
import { applySettings } from './settings.js';
import { filterList } from './home.js';
import { ASR_METHODS, CALCULATION_METHODS, DEFAULT_ASR_METHOD, DEFAULT_CALCULATION_METHOD } from './prayer-times.js';

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
      manualLatitude: state.manualLatitude,
      manualLongitude: state.manualLongitude,
    },
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
  state.manualLatitude = typeof settings.manualLatitude === 'number' ? clampNumber(settings.manualLatitude, -90, 90, null) : null;
  state.manualLongitude = typeof settings.manualLongitude === 'number' ? clampNumber(settings.manualLongitude, -180, 180, null) : null;

  localStorage.setItem('favourites', JSON.stringify([...state.favourites]));
  localStorage.setItem('fontScale', String(state.fontScale));
  localStorage.setItem('darkMode', String(state.darkMode));
  localStorage.setItem('largeArabic', String(state.largeArabic));
  localStorage.setItem('advancedUi', String(state.advancedUi));
  localStorage.setItem('calculationMethod', state.calculationMethod);
  localStorage.setItem('asrMethod', state.asrMethod);
  if (state.manualLatitude !== null && state.manualLongitude !== null) {
    localStorage.setItem('manualLatitude', String(state.manualLatitude));
    localStorage.setItem('manualLongitude', String(state.manualLongitude));
  } else {
    localStorage.removeItem('manualLatitude');
    localStorage.removeItem('manualLongitude');
  }

  applySettings();
  filterList();
  toast('Backup imported.');
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
