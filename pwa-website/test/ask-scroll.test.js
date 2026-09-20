import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keyboardInset, shouldStickToBottom } from '../js/assistant.js';

// Ask answered correctly and then threw the reader away: on a long conversation the thread ended up
// at the top the moment an answer finished, and on a phone the keyboard closed and reopened around
// it. Both had the same shape -- something moved the view that the reader had not asked to move.
//
// The arithmetic of "is this reader still at the bottom" and "how much is the keyboard covering" is
// what these cover; the rest of the fix is about not moving anything else, which is what the source
// checks below are for.
const assistant = readFileSync(resolve(process.cwd(), 'js/assistant.js'), 'utf8');
const css = readFileSync(resolve(process.cwd(), 'css/online.css'), 'utf8');

describe('following the newest turn', () => {
  it('follows a reader sitting exactly at the bottom', () => {
    expect(shouldStickToBottom(500, 1031, 531)).toBe(true);
  });

  it('follows one a few pixels short of it, which is where a growing answer leaves them', () => {
    expect(shouldStickToBottom(470, 1031, 531)).toBe(true);
  });

  it('lets go of a reader who has scrolled up to re-read an earlier answer', () => {
    expect(shouldStickToBottom(200, 1031, 531)).toBe(false);
  });

  it('lets go at the top of a long conversation', () => {
    expect(shouldStickToBottom(0, 4000, 531)).toBe(false);
  });

  it('follows when there is nothing to scroll at all', () => {
    expect(shouldStickToBottom(0, 531, 531)).toBe(true);
  });

  it('follows through a sub-pixel height, which is what a raw comparison failed on', () => {
    expect(shouldStickToBottom(499.6, 1030.625, 531)).toBe(true);
  });
});

describe('what the soft keyboard is covering', () => {
  it('is nothing when the browser does not report a visual viewport', () => {
    expect(keyboardInset(812, undefined)).toBe(0);
  });

  it('is nothing with no keyboard open', () => {
    expect(keyboardInset(812, { height: 812, offsetTop: 0 })).toBe(0);
  });

  it('is the keyboard on iOS, where the layout viewport does not change', () => {
    expect(keyboardInset(812, { height: 476, offsetTop: 0 })).toBe(336);
  });

  it('is nothing on Android, where the keyboard shrinks the layout viewport itself', () => {
    expect(keyboardInset(476, { height: 476, offsetTop: 0 })).toBe(0);
  });

  it('never goes negative when the visual viewport is the larger of the two', () => {
    // Pinch-zoom out reports a visual viewport taller than the layout one; a negative bottom would
    // hang the composer off the screen.
    expect(keyboardInset(812, { height: 900, offsetTop: 0 })).toBe(0);
  });

  it('discounts a visual viewport that has been scrolled down the page', () => {
    expect(keyboardInset(812, { height: 476, offsetTop: 100 })).toBe(236);
  });
});

describe('the things that used to move the view', () => {
  it('scrolls the thread instantly, never as an animation', () => {
    // A smooth scroll is an animation, and an animation reports its own intermediate positions back
    // through the scroll listener as though the reader had scrolled away.
    expect(assistant).toContain("behavior: 'instant'");
    expect(css).not.toMatch(/\.assistant-result\s*\{[^}]*scroll-behavior:\s*smooth/);
  });

  it('never replaces the whole thread, which reset its scroll position to the top', () => {
    expect(assistant).not.toMatch(/assistantResult\.innerHTML\s*=\s*conversation/);
  });

  it('does not reach for the composer once an answer has landed', () => {
    // Focusing the box when the answer arrived reopened a keyboard the reader had watched close.
    const submitHandler = assistant.slice(assistant.indexOf("assistantForm.addEventListener('submit'"));
    expect(submitHandler.slice(0, submitHandler.indexOf('updatePlaceholder();'))).not.toContain('.focus()');
  });

  it('keeps the caret in the box when the send button is tapped', () => {
    expect(assistant).toMatch(/assistantSubmit\.addEventListener\('pointerdown'/);
  });
});
