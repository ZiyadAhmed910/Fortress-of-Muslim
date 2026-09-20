import { describe, expect, it } from 'vitest';
import { RECITERS, DEFAULT_RECITER } from '../js/quran-audio.js';

// everyayah.com names each folder after the reciter and the bitrate it was encoded at, so the id
// carries the quality. A reciter this CDN only publishes at a low bitrate does not get a slot:
// offering a recitation nobody wants to listen to is worse than offering one fewer voice.
const MINIMUM_BITRATE = 128;

describe('reciters', () => {
  it('offers no recitation below 128kbps', () => {
    for (const reciter of RECITERS) {
      const bitrate = Number((reciter.id.match(/_(\d+)kbps$/) || [])[1]);
      expect(bitrate, `${reciter.id} has no parseable bitrate`).toBeGreaterThan(0);
      expect(bitrate, `${reciter.name} is only ${bitrate}kbps`).toBeGreaterThanOrEqual(MINIMUM_BITRATE);
    }
  });

  it('does not label any voice as a data-saving compromise', () => {
    for (const reciter of RECITERS) {
      expect(reciter.name.toLowerCase()).not.toContain('low data');
      expect(reciter.name.toLowerCase()).not.toContain('kbps');
    }
  });

  it('has unique ids and a default that is actually in the list', () => {
    const ids = RECITERS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_RECITER);
  });

  it('names every reciter for a human, not for a CDN folder', () => {
    for (const reciter of RECITERS) {
      expect(reciter.name).not.toBe(reciter.id);
      expect(reciter.name.length).toBeGreaterThan(3);
      expect(reciter.name).not.toMatch(/[_]/);
    }
  });
});
