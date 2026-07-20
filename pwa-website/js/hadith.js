import { els } from './dom.js';
import { apiRequest } from './online.js';
import { escapeHtml } from './utils.js';

const view = { collection: '', query: '', cursor: null, loading: false, initialized: false, controller: null };

export function initHadith() {
  els.hadithSearchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    view.query = els.hadithSearchInput.value.trim();
    loadHadith(true);
  });
  els.hadithLoadMore.addEventListener('click', () => loadHadith(false));
  els.hadithList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-hadith-id]');
    if (button) openHadith(button.dataset.hadithId);
  });
  els.hadithDetail.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-hadith]')) showBrowse();
  });
}

export async function activateHadith() {
  if (view.initialized) return;
  view.initialized = true;
  await Promise.all([loadCollections(), loadHadith(true)]);
}

async function loadCollections() {
  try {
    const body = await apiRequest('/v1/collections?type=hadith');
    const collections = [{ slug: '', title: 'All', recordCount: body.data.reduce((sum, item) => sum + item.recordCount, 0) }, ...body.data];
    els.hadithCollections.innerHTML = collections.map((collection) => `
      <button class="online-filter ${collection.slug === view.collection ? 'active' : ''}" data-hadith-collection="${escapeHtml(collection.slug)}" type="button">
        <span>${escapeHtml(collection.title)}</span><small>${collection.recordCount.toLocaleString()}</small>
      </button>
    `).join('');
    els.hadithCollections.querySelectorAll('[data-hadith-collection]').forEach((button) => {
      button.addEventListener('click', () => {
        view.collection = button.dataset.hadithCollection;
        els.hadithCollections.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
        loadHadith(true);
      });
    });
  } catch (error) {
    els.hadithCollections.innerHTML = `<span class="online-error">${escapeHtml(error.message)}</span>`;
  }
}

async function loadHadith(reset) {
  if (view.loading && !reset) return;
  if (!reset && !view.cursor) return;
  if (reset) view.controller?.abort();
  view.loading = true;
  view.controller = new AbortController();
  if (reset) {
    view.cursor = null;
    els.hadithList.innerHTML = loadingRows();
  }
  els.hadithLoadMore.disabled = true;
  try {
    const params = new URLSearchParams({ limit: '24' });
    if (view.collection) params.set('collection', view.collection);
    if (view.cursor) params.set('cursor', view.cursor);
    const useSearch = view.query.length >= 2;
    if (useSearch) params.set('q', view.query);
    const body = await apiRequest(`/v1/hadith${useSearch ? '/search' : ''}?${params}`, { signal: view.controller.signal });
    const rows = body.data.map(hadithRow).join('');
    els.hadithList.innerHTML = reset ? rows : els.hadithList.innerHTML + rows;
    view.cursor = body.pagination.nextCursor;
    const total = body.meta.total ?? body.data.length;
    els.hadithResultCount.textContent = `${Number(total).toLocaleString()} Hadith${Number(total) === 1 ? '' : 's'}`;
    els.hadithLoadMore.hidden = !view.cursor;
    if (!body.data.length && reset) els.hadithList.innerHTML = '<div class="empty-state">No Hadith matched this query.</div>';
  } catch (error) {
    if (error.name !== 'AbortError') {
      els.hadithResultCount.textContent = 'Hadith unavailable';
      els.hadithList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  } finally {
    view.loading = false;
    els.hadithLoadMore.disabled = false;
  }
}

async function openHadith(id) {
  els.hadithBrowse.hidden = true;
  els.hadithDetail.hidden = false;
  els.hadithDetail.innerHTML = loadingRows(3);
  window.scrollTo({ top: 0, behavior: 'instant' });
  try {
    const body = await apiRequest(`/v1/hadith/${encodeURIComponent(id)}`);
    const hadith = body.data;
    const sourceId = providerId(hadith.id);
    const segments = hadith.segments.map((segment) => `<p class="segment ${segment.kind}" ${segment.kind === 'arabic' ? 'dir="rtl" lang="ar"' : ''}>${escapeHtml(segment.text)}</p>`).join('');
    els.hadithDetail.innerHTML = `
      <button class="inline-back" data-close-hadith type="button" aria-label="Back to Hadith results">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg><span>Results</span>
      </button>
      <header><span>${escapeHtml(hadith.collection.title)} ${escapeHtml(hadith.displayNumber)}</span><h2>${escapeHtml(hadith.chapter?.title || hadith.title)}</h2></header>
      <dl class="hadith-metadata">
        <div><dt>Book</dt><dd>${escapeHtml(hadith.book?.title || 'Not specified')}</dd></div>
        <div><dt>Narrator</dt><dd>${escapeHtml(hadith.narrator || 'Not specified')}</dd></div>
        <div><dt>Grade</dt><dd>${escapeHtml(hadith.grade?.value || 'Not supplied')}</dd></div>
        <div><dt>Verification</dt><dd>${escapeHtml(hadith.verificationStatus)}</dd></div>
      </dl>
      <div class="hadith-text">${segments}</div>
      <a class="source-link" href="https://sunnah.com/${encodeURIComponent(sourceId)}" target="_blank" rel="noopener noreferrer">Open source record</a>
    `;
  } catch (error) {
    els.hadithDetail.innerHTML = `<button class="inline-back" data-close-hadith type="button">Results</button><div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function showBrowse() {
  els.hadithDetail.hidden = true;
  els.hadithBrowse.hidden = false;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function hadithRow(item) {
  const location = [item.book?.title, item.chapter?.title].filter(Boolean).join(' | ');
  return `<button class="hadith-row" data-hadith-id="${escapeHtml(item.id)}" type="button">
    <span class="hadith-reference">${escapeHtml(item.collection.title)} ${escapeHtml(item.displayNumber)}</span>
    <strong>${escapeHtml(item.chapter?.title || item.title)}</strong>
    <small>${escapeHtml(location || item.narrator || '')}</small>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
  </button>`;
}

function providerId(id) {
  const parts = id.split('.');
  return `${parts[1]}:${parts.slice(2).join('.')}`;
}

function loadingRows(count = 6) {
  return Array.from({ length: count }, () => '<div class="skeleton-row" aria-hidden="true"></div>').join('');
}
