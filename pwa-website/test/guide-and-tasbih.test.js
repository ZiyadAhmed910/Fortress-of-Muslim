import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Two things a reader can see but a unit test usually cannot: the first-run guide pointing at a
// control that does not look like the real one, and a confirmation dialog standing between someone
// and a counter they reset constantly. Both were reported from the phone, so both get held here.
const read = (file) => readFileSync(resolve(process.cwd(), file), 'utf8');
const html = read('index.html');
const onboarding = read('js/onboarding.js');
const tasbih = read('js/tasbih.js');

describe('first-run guide', () => {
  it('shows the same Settings glyph the header shows', () => {
    // The header's control is a text glyph, so the guide uses that glyph rather than a drawn gear.
    const headerGlyph = html.match(/<button class="icon-button" id="settingsButton"[\s\S]*?<span aria-hidden="true">([^<]+)<\/span>/)[1];
    expect(onboarding).toContain(`>${headerGlyph}</span>`);
  });

  it('does not draw its own gear lookalike', () => {
    expect(onboarding).not.toMatch(/settings:\s*'<circle/);
  });

  it('still offers to open Settings from that step', () => {
    expect(onboarding).toMatch(/action:\s*\{\s*label:\s*'Open Settings',\s*settings:\s*true\s*\}/);
  });
});

describe('tasbih reset', () => {
  const resetHandler = tasbih.match(/tasbihResetButton\.addEventListener\('click',[\s\S]*?\n  \}\);/)[0];

  it('resets on the tap, with no dialog in the way', () => {
    expect(resetHandler).toContain('activePreset().count = 0');
    expect(resetHandler).not.toContain('showModal');
  });

  it('persists the reset rather than only repainting it', () => {
    expect(resetHandler).toContain('persist()');
    expect(resetHandler).toContain('renderCount()');
  });

  it('leaves the lifetime total alone', () => {
    expect(resetHandler).not.toContain('totalLifetimeCount');
  });
});

describe('deleting a phrase, which cannot be undone, still asks', () => {
  it('opens the confirmation dialog', () => {
    const deleteHandler = tasbih.match(/tasbihDeletePresetButton\.addEventListener\('click',[\s\S]*?\n  \}\);/)[0];
    expect(deleteHandler).toContain('tasbihDeleteConfirmDialog');
    expect(deleteHandler).toContain('showModal()');
  });

  it('labels its confirm button Delete, not Reset', () => {
    // The dialog used to be shared with reset, so deleting a phrase offered a button reading "Reset".
    const dialog = html.match(/<dialog[^>]*id="tasbihDeleteConfirmDialog"[\s\S]*?<\/dialog>/)[0];
    expect(dialog).toMatch(/value="confirm"[^>]*>Delete</);
    expect(dialog).not.toMatch(/>Reset</);
  });
});
