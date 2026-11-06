import { apiBaseUrl } from './online.js';

// Settings the platform owner changes from the Admin Console, read once per launch.
//
// Today one: where Quran recitation and word-by-word audio play from -- 'own', our media host (the
// default), or 'external', everyayah.com and audio.qurancdn.com (see migration 0030 and
// GET /v1/app-config). The point is a way back that needs no release: if the media host had a
// problem, flipping the switch moves every phone on its next launch.
//
// Nothing waits on this. The app starts on the last value it saw -- or the default, on a first
// launch -- and asks again in the background. Offline, or if the request fails, the last value stands.

const STORAGE_KEY = 'fortress_app_config';
export const DEFAULT_CONFIG = Object.freeze({ audioSource: 'own' });
const AUDIO_SOURCES = ['own', 'external'];
let fetched = false;

/** Only values the app knows what to do with; anything else is the default. */
export function sanitizeConfig(raw) {
  return { audioSource: AUDIO_SOURCES.includes(raw?.audioSource) ? raw.audioSource : DEFAULT_CONFIG.audioSource };
}

export function appConfig(storage = globalThis.localStorage) {
  try {
    return sanitizeConfig(JSON.parse(storage?.getItem(STORAGE_KEY) || 'null'));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Asks the API for the current settings, once per launch. Never throws and never blocks: the result
 * applies from the next thing that reads appConfig() -- the next ayah, in practice.
 */
export async function refreshAppConfig({ storage = globalThis.localStorage, fetcher = globalThis.fetch } = {}) {
  if (fetched) return appConfig(storage);
  fetched = true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return appConfig(storage);
  try {
    const response = await fetcher(`${apiBaseUrl()}/v1/app-config`);
    if (!response.ok) return appConfig(storage);
    const config = sanitizeConfig((await response.json())?.data);
    storage?.setItem(STORAGE_KEY, JSON.stringify(config));
    return config;
  } catch {
    return appConfig(storage);
  }
}

/** For tests: forget that this launch already asked. */
export function resetAppConfigFetch() {
  fetched = false;
}
