import { els } from './dom.js';
import { apiRequest } from './online.js';
import { escapeHtml } from './utils.js';

export function initAssistant() {
  // The question box is a <textarea> so a person can write a multi-part question -- plain Enter
  // has to keep inserting a newline, not submit. Ctrl+Enter/Alt+Enter (Cmd+Enter on Mac) submits
  // without reaching for the mouse, the same shortcut convention code editors and note apps use
  // when Enter alone is reserved for line breaks.
  els.assistantQuestion.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.altKey || event.metaKey)) {
      event.preventDefault();
      els.assistantForm.requestSubmit();
    }
  });
  els.assistantForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = els.assistantQuestion.value.trim();
    if (question.length < 5) return;
    els.assistantSubmit.disabled = true;
    els.assistantResult.innerHTML = '<div class="assistant-thinking"><span></span><span></span><span></span></div>';
    const contentType = els.assistantContentType.value;
    const filters = contentType ? { contentType } : undefined;
    try {
      const body = await apiRequest('/v1/ask', { method: 'POST', body: JSON.stringify({ question, filters }) });
      renderAnswer(body.data);
    } catch (error) {
      els.assistantResult.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    } finally {
      els.assistantSubmit.disabled = false;
    }
  });
}

function renderAnswer(data) {
  const answer = escapeHtml(data.answer).replace(/\n/g, '<br>');
  const sources = data.sources.map((source) => {
    const isVerified = source.verificationStatus === 'verified';
    return `
    <a class="assistant-source${isVerified ? '' : ' assistant-source--unverified'}" href="${escapeHtml(source.canonicalUrl)}">
      <span>[${source.index}] ${escapeHtml(source.collection)}</span>
      <strong>${escapeHtml(source.reference)}</strong>
      <small>${isVerified ? 'Verified' : 'Not yet verified'}</small>
    </a>
  `;
  }).join('');
  els.assistantResult.innerHTML = `
    <article class="assistant-answer"><p>${answer}</p></article>
    <div class="assistant-sources">${sources}</div>
    ${data.meta.includesUnverifiedSource ? '<p class="assistant-note">This answer draws on at least one source that is not yet independently verified -- clearly marked above.</p>' : ''}
    ${data.meta.retrievalMode === 'empty_dataset' ? '' : `<p class="assistant-remaining">${data.meta.remainingToday} questions remaining today on this connection.</p>`}
  `;
}
