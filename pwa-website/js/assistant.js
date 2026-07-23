import { els } from './dom.js';
import { apiRequest } from './online.js';
import { escapeHtml } from './utils.js';

export function initAssistant() {
  els.assistantForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = els.assistantQuestion.value.trim();
    if (question.length < 5) return;
    els.assistantSubmit.disabled = true;
    els.assistantResult.innerHTML = '<div class="assistant-thinking"><span></span><span></span><span></span></div>';
    try {
      const body = await apiRequest('/v1/ask', { method: 'POST', body: JSON.stringify({ question }) });
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
  const sources = data.sources.map((source) => `
    <a class="assistant-source" href="${escapeHtml(source.canonicalUrl)}">
      <span>[${source.index}] ${escapeHtml(source.collection)}</span>
      <strong>${escapeHtml(source.reference)}</strong>
      <small>${escapeHtml(source.verificationStatus)} verification</small>
    </a>
  `).join('');
  els.assistantResult.innerHTML = `
    <article class="assistant-answer"><p>${answer}</p></article>
    <div class="assistant-sources">${sources}</div>
    <p class="assistant-remaining">${data.meta.remainingToday} questions remaining today on this connection.</p>
  `;
}
