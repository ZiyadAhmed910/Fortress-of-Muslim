import { DATA_VERSION } from './constants.js';
import { enrichEntry } from './categories.js';

export async function loadDuas() {
  const response = await fetch(`data/duas.json?v=${DATA_VERSION}`, { cache: 'reload' });
  if (!response.ok) throw new Error(`Content request failed: ${response.status}`);
  const data = await response.json();
  return {
    ...data,
    entries: data.entries.map(enrichEntry),
  };
}
