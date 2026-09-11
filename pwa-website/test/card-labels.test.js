import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupLabel } from '../js/categories.js';
import { subtitleForFilter } from '../js/home.js';

// The Advanced-home cards print a title and subtitle, and the screen each card opens prints a title
// and subtitle too. They are written in two places -- the markup, so the words are on screen before
// any script runs, and home.js, which sets the screen header -- so this holds them together. A card
// promising one thing and opening onto a screen named another is the drift this exists to catch.
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const cards = [...html.matchAll(/data-advanced-filter="([a-z]+)"[\s\S]*?<span class="advanced-card-title">([^<]+)<\/span><span class="advanced-card-sub" id="card-\1-sub">([^<]+)<\/span>/g)]
  .map(([, filter, title, sub]) => ({ filter, title, sub }));

describe('Advanced-home card labels', () => {
  it('labels all nine cards', () => {
    expect(cards.map((card) => card.filter)).toEqual([
      'all', 'morning', 'evening', 'sleep', 'salah', 'travel', 'favourites', 'moods', 'ruqyah',
    ]);
  });

  it.each(cards)('titles "$filter" exactly as the screen it opens', ({ filter, title }) => {
    expect(title).toBe(groupLabel(filter));
  });

  it.each(cards)('describes "$filter" exactly as the screen it opens', ({ filter, sub }) => {
    expect(sub).toBe(subtitleForFilter(filter));
  });

  it('keeps the artwork free of text, so the title is only ever the document text', () => {
    for (const { filter } of cards) {
      const img = html.match(new RegExp(`data-advanced-filter="${filter}"[\\s\\S]*?<img[^>]*src="([^"]+)"`))[1];
      const svg = readFileSync(resolve(process.cwd(), img), 'utf8');
      expect(svg, img).not.toMatch(/<text[\s>]/);
    }
  });

  it('names each card by its visible title rather than a hidden aria-label', () => {
    // An aria-label would override the visible text and hide the reading count from screen readers.
    for (const { filter } of cards) {
      const button = html.match(new RegExp(`<button[^>]*data-advanced-filter="${filter}"[^>]*>`))[0];
      expect(button, filter).not.toMatch(/aria-label=/);
      expect(button, filter).toMatch(new RegExp(`aria-describedby="card-${filter}-sub card-${filter}-count"`));
    }
  });
});
