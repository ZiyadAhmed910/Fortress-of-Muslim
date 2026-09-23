import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allTracks, mediaBase, totalBytes, trackUrl, tracksFor } from '../js/dua-audio.js';

// Dua recitation: a public map (data/dua-audio.json) from reading and part to recordings, served by
// our media host. What is worth pinning is that the map and the text agree -- a play button on the
// wrong part plays the wrong words -- and that the test site never counts into production's numbers.

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const MAP = JSON.parse(read('data/dua-audio.json'));
const DUAS = JSON.parse(read('data/duas.json')).entries;
const SW = read('sw.js');

describe('the recording map', () => {
  it('names only readings and parts that exist', () => {
    const byUid = new Map(DUAS.map((entry) => [entry.uid, entry]));
    for (const [uid, parts] of Object.entries(MAP.readings)) {
      const entry = byUid.get(uid);
      expect(entry, `${uid} is not a reading`).toBeTruthy();
      for (const part of Object.keys(parts)) {
        expect(Number(part), `${uid} part ${part}`).toBeGreaterThanOrEqual(1);
        expect(Number(part), `${uid} part ${part}`).toBeLessThanOrEqual(entry.parts.length);
      }
    }
  });

  it('has no recording on a part with no words to recite', () => {
    // Instruction and virtue readings are guidance about the dua, not the dua itself.
    for (const [uid, parts] of Object.entries(MAP.readings)) {
      const entry = DUAS.find((candidate) => candidate.uid === uid);
      for (const part of Object.keys(parts)) {
        const role = entry.partRoles?.[Number(part) - 1] || 'supplication';
        expect(['instruction', 'virtue'], `${uid} part ${part} is ${role}`).not.toContain(role);
      }
    }
  });

  it('points every track at a versioned path on our own host', () => {
    expect(MAP.base).toBe('https://media.fortressofmuslim.org');
    for (const track of allTracks(MAP)) {
      expect(track.path).toMatch(/^duas\/v1\/dua-\d{3}\/\d+(-\d+)?\.mp3$/);
      expect(track.bytes).toBeGreaterThan(0);
      expect(track.seconds).toBeGreaterThan(0);
    }
  });

  it('labels both tracks where a part has two', () => {
    for (const parts of Object.values(MAP.readings)) {
      for (const tracks of Object.values(parts)) {
        if (tracks.length > 1) expect(tracks.every((track) => track.label)).toBe(true);
      }
    }
  });

  it('reads tracks by the reader\'s 0-based part index', () => {
    const [uid, parts] = Object.entries(MAP.readings)[0];
    const [part, tracks] = Object.entries(parts)[0];
    expect(tracksFor(uid, Number(part) - 1, MAP)).toEqual(tracks);
    expect(tracksFor(uid, 999, MAP)).toEqual([]);
    expect(tracksFor('no-such-reading', 0, MAP)).toEqual([]);
    expect(tracksFor('dua-001', 0, null)).toEqual([]);
  });

  it('adds up what a full download costs', () => {
    expect(totalBytes(MAP)).toBe(allTracks(MAP).reduce((sum, track) => sum + track.bytes, 0));
  });
});

describe('which media host', () => {
  it('plays the test site from the test host, so its listens are never counted in production', () => {
    expect(mediaBase('test.fortressofmuslim.org', MAP.base)).toBe('https://media-test.fortressofmuslim.org');
    expect(mediaBase('localhost', MAP.base)).toBe('https://media-test.fortressofmuslim.org');
  });

  it('plays everywhere else from the map\'s host', () => {
    expect(mediaBase('fortressofmuslim.org', MAP.base)).toBe(MAP.base);
    expect(trackUrl({ path: 'duas/v1/dua-001/1.mp3' }, MAP.base)).toBe('https://media.fortressofmuslim.org/duas/v1/dua-001/1.mp3');
  });
});

describe('offline playback in the service worker', () => {
  it('ships the player and the map with the app', () => {
    expect(SW).toContain('`./js/dua-audio.js?v=${APP_VERSION}`');
    expect(SW).toContain("'./data/dua-audio.json'");
  });

  it('knows both media hosts', () => {
    expect(SW).toContain("'media.fortressofmuslim.org'");
    expect(SW).toContain("'media-test.fortressofmuslim.org'");
  });

  it('leaves the download request itself to the network, so it is counted', () => {
    expect(SW).toMatch(/isDuaRecitation\(url\) && !url\.search/);
  });

  // The range cutter, lifted out of sw.js and run on its own.
  const source = SW.slice(SW.indexOf('async function rangedResponse'), SW.indexOf("self.addEventListener('install'"));
  const rangedResponse = new Function(`${source}; return rangedResponse;`)();
  const cached = () => new Response(new Uint8Array(1000).map((_, index) => index % 256), { headers: { 'content-type': 'audio/mpeg' } });
  const ranged = (range) => new Request('https://media.fortressofmuslim.org/x.mp3', { headers: range ? { range } : {} });

  it('answers a plain request with the whole file', async () => {
    const response = await rangedResponse(cached(), ranged());
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(1000);
  });

  it('answers a range with 206 and just that slice', async () => {
    // Safari will not play audio answered with a 200 to a ranged request.
    const response = await rangedResponse(cached(), ranged('bytes=100-199'));
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 100-199/1000');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBe(100);
    expect(bytes[0]).toBe(100);
  });

  it('handles open-ended and suffix ranges', async () => {
    expect((await rangedResponse(cached(), ranged('bytes=0-'))).headers.get('content-range')).toBe('bytes 0-999/1000');
    expect((await rangedResponse(cached(), ranged('bytes=-100'))).headers.get('content-range')).toBe('bytes 900-999/1000');
    expect((await rangedResponse(cached(), ranged('bytes=0-5000'))).headers.get('content-range')).toBe('bytes 0-999/1000');
  });

  it('refuses a range past the end', async () => {
    expect((await rangedResponse(cached(), ranged('bytes=2000-'))).status).toBe(416);
  });
});
