import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Hisn al-Muslim holds four kinds of reading. Before these were modelled, everything that was not a
// plain supplication was forced into the supplication's shape: 57 of 266 readings had "--" or English
// prose where a transliteration belongs, and two translations stopped mid-sentence. These hold the
// restructure in place. See tools/apply-reading-roles.mjs for how each reading was judged.
const data = JSON.parse(readFileSync(resolve(process.cwd(), 'data/duas.json'), 'utf8'));
const ROLES = ['supplication', 'framed', 'instruction', 'virtue'];
const MACRON = /[āīūḥṣḍṭẓĀĪŪḤṢ`]/;
const ENGLISH_WORD = /\b(said|the|you|and|when|then|whoever|with|his|from|there|if|say|recite|would|used|is|are)\b/i;

const readings = data.entries.flatMap((entry) => entry.parts.map((part, i) => ({
  key: `${entry.id}:${i + 1}`,
  role: entry.partRoles?.[i],
  part,
  text: (kind) => part.filter((s) => s.kind === kind).map((s) => s.text).join(' '),
})));

describe('reading roles', () => {
  it('gives every reading exactly one role', () => {
    for (const entry of data.entries) {
      expect(entry.partRoles, `entry ${entry.id}`).toHaveLength(entry.parts.length);
    }
    for (const r of readings) expect(ROLES, r.key).toContain(r.role);
  });

  it('keeps supplications the overwhelming majority, as the book is', () => {
    const count = (role) => readings.filter((r) => r.role === role).length;
    expect(count('supplication')).toBeGreaterThan(readings.length * 0.7);
    expect(count('framed') + count('instruction') + count('virtue')).toBeGreaterThan(0);
  });

  it('never shows "--" where a transliteration belongs', () => {
    for (const r of readings) {
      expect(r.text('transliteration'), r.key).not.toMatch(/^[-–—\s.]+$/);
    }
  });

  it('never holds English prose in the transliteration slot', () => {
    for (const r of readings) {
      const tr = r.text('transliteration');
      if (!tr) continue;
      // A real transliteration carries macrons and dots; English carries neither. Bracketed notes
      // like "[Recite three times]" sit inside real transliterations and are fine.
      expect(!MACRON.test(tr) && ENGLISH_WORD.test(tr), `${r.key}: "${tr.slice(0, 50)}"`).toBe(false);
    }
  });

  it('gives guidance and virtue readings no transliteration, since there is nothing to recite', () => {
    for (const r of readings.filter((x) => x.role === 'instruction' || x.role === 'virtue')) {
      expect(r.text('transliteration'), r.key).toBe('');
      expect(r.text('translation'), `${r.key} must still say what it means`).not.toBe('');
    }
  });

  it('keeps context lines to framed readings', () => {
    for (const r of readings.filter((x) => x.part.some((s) => s.kind === 'context'))) {
      expect(r.role, r.key).toBe('framed');
    }
  });

  it('still has Arabic for every reading', () => {
    for (const r of readings) expect(r.text('arabic').trim(), r.key).not.toBe('');
  });
});

describe('specific repairs', () => {
  const find = (key) => readings.find((r) => r.key === key);

  it('restores the adhan and adhkar readings of chapter 45 as guidance', () => {
    const e45 = data.entries.find((e) => e.id === 45);
    expect(e45.partRoles).toEqual(['supplication', 'instruction', 'instruction']);
    expect(find('45:2').text('arabic')).toBe('الْأَذَانُ');
    expect(find('45:3').text('arabic')).toBe('الْأَذْكَارُ وَقِرَاءَةُ الْقُرْآنِ');
  });

  it('keeps the corrected Arabic of the seeking-refuge reading', () => {
    expect(find('45:1').text('arabic')).toBe('أَعُوذُ بِاللَّهِ مِنَ الشَّيطَانِ الرَّجِيمِ');
  });

  it('finishes the two translations that had been cut off mid-sentence', () => {
    // 108:2 stopped at "...has completed his faith:" and 131:1 at "Abdullah bin 'Amr said:".
    expect(find('108:2').text('translation')).toMatch(/to be just, to spread greetings/);
    expect(find('131:1').text('translation')).toMatch(/counting the glorification of his Lord on his right hand/);
  });

  it('keeps the narration of 48 and 51:2 as context rather than losing it', () => {
    expect(find('48:1').text('context')).toMatch(/seek Allah's protection for Al-Hasan and Al-Husain/);
    expect(find('51:2').text('context')).toMatch(/dipped his hands in water/);
  });

  it('leaves the transliterations with bracketed notes alone', () => {
    // A pattern-based first attempt would have deleted these; they are correct.
    expect(find('27:5').text('transliteration')).toMatch(/^Allāhumma bika aṣbaḥnā/);
    expect(find('33:1').text('transliteration')).toMatch(/Subḥāna/);
    expect(find('56:1').text('transliteration')).toMatch(/a`idh’hu/);
  });
});
