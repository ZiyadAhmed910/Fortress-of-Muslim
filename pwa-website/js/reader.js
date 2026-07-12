import { state } from './state.js';
import { els } from './dom.js';
import { escapeHtml, toast } from './utils.js';
import { applyAdvancedTitle, filterList, showAdvancedDashboard } from './home.js';

export function openEntry(index) {
  state.currentIndex = index;
  state.currentPart = 0;
  els.app.classList.add('is-reader');
  renderReader();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

export function showHome() {
  if (els.app.classList.contains('is-reader')) {
    els.app.classList.remove('is-reader');
    if (state.advancedUi && state.advancedListMode) {
      applyAdvancedTitle();
    } else {
      els.screenTitle.textContent = 'Fortress of Muslim';
      els.screenSubtitle.textContent = 'Supplications and remembrances';
    }
    return;
  }

  if (state.advancedUi && state.advancedListMode) {
    showAdvancedDashboard();
    filterList();
    return;
  }

  els.screenTitle.textContent = 'Fortress of Muslim';
  els.screenSubtitle.textContent = 'Supplications and remembrances';
}

export function renderReader() {
  const entry = currentEntry();
  const part = entry.parts[state.currentPart];
  els.screenTitle.textContent = `${entry.id}. ${entry.title}`;
  els.screenSubtitle.textContent = `${state.currentPart + 1} of ${entry.parts.length}`;
  els.duaTitle.textContent = `${entry.id}. ${entry.title}`;
  els.partCount.textContent = `${state.currentPart + 1}/${entry.parts.length}`;
  els.readerFavouriteButton.textContent = state.favourites.has(entry.uid) ? '★' : '☆';
  els.readerFavouriteButton.classList.toggle('active', state.favourites.has(entry.uid));
  els.previousButton.disabled = state.currentIndex === 0 && state.currentPart === 0;
  els.nextButton.disabled = state.currentIndex === state.filtered.length - 1 && state.currentPart === entry.parts.length - 1;
  els.duaContent.innerHTML = part.map((segment) => {
    return `<p class="segment ${segmentClass(segment)}">${escapeHtml(segment.text)}</p>`;
  }).join('');
}

export function currentEntry() {
  return state.filtered[state.currentIndex];
}

export function previousPart() {
  if (state.currentPart > 0) {
    state.currentPart -= 1;
  } else if (state.currentIndex > 0) {
    state.currentIndex -= 1;
    state.currentPart = currentEntry().parts.length - 1;
  }
  renderReader();
}

export function nextPart() {
  const entry = currentEntry();
  if (state.currentPart < entry.parts.length - 1) {
    state.currentPart += 1;
  } else if (state.currentIndex < state.filtered.length - 1) {
    state.currentIndex += 1;
    state.currentPart = 0;
  }
  renderReader();
}

export function entryText(entry) {
  const body = entry.parts.map((part, index) => {
    const lines = part.map((segment) => segment.text).join('\n');
    return entry.parts.length > 1 ? `Part ${index + 1}/${entry.parts.length}\n${lines}` : lines;
  }).join('\n\n');
  return `${entry.id}. ${entry.title}\n\n${body}`;
}

export async function shareCurrentEntry() {
  const entry = currentEntry();
  const text = entryText(entry);
  if (navigator.share) {
    try {
      await navigator.share({ title: entry.title, text });
      return;
    } catch {
      return;
    }
  }
  await navigator.clipboard.writeText(text);
  toast('Copied full dua for sharing.');
}

export async function copyCurrentEntry() {
  await navigator.clipboard.writeText(entryText(currentEntry()));
  toast('Copied full dua.');
}

export function segmentClass(segment) {
  const text = segment.text.trim();
  if (/[\u0600-\u06FF]/.test(text)) return 'arabic';
  if (/^[‘“]/.test(text)) return 'translation';
  return segment.kind;
}

export function bindSwipe() {
  let startX = 0;
  let startY = 0;
  els.readerCard.addEventListener('touchstart', (event) => {
    startX = event.changedTouches[0].clientX;
    startY = event.changedTouches[0].clientY;
  }, { passive: true });
  els.readerCard.addEventListener('touchend', (event) => {
    const endX = event.changedTouches[0].clientX;
    const endY = event.changedTouches[0].clientY;
    const dx = endX - startX;
    const dy = endY - startY;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.35) {
      dx < 0 ? nextPart() : previousPart();
    }
  }, { passive: true });
}
