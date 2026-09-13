import { els } from './dom.js';
import { apiBaseUrl, apiRequest } from './online.js';
import { escapeHtml } from './utils.js';

// An answer takes seconds of real work -- retrieval, reranking, then a model writing prose -- and
// none of that can be tuned to nothing. What made it feel broken was that the panel stayed empty
// for all of it. The streaming endpoint reports its stage, hands over the sources as soon as
// retrieval has them, and then writes the answer a word at a time. If anything about that fails,
// the original single-response endpoint still answers.
const STAGE_LABELS = {
  retrieving: 'Searching the published sources',
  writing: 'Writing the answer',
};

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
    renderStage('retrieving');
    const contentType = els.assistantContentType.value;
    const filters = contentType ? { contentType } : undefined;
    try {
      await streamAnswer(question, filters);
    } catch (error) {
      try {
        const body = await apiRequest('/v1/ask', { method: 'POST', body: JSON.stringify({ question, filters }) });
        renderAnswer(body.data);
      } catch (fallbackError) {
        els.assistantResult.innerHTML = `<div class="empty-state">${escapeHtml(fallbackError.message)}</div>`;
      }
    } finally {
      els.assistantSubmit.disabled = false;
    }
  });
}

/**
 * Reads the server-sent answer. Throws if the stream cannot be used at all, so the caller can fall
 * back to the plain endpoint; an `error` event inside a stream that did start is shown as-is,
 * because by then the request really was made and its rate-limit counted.
 */
async function streamAnswer(question, filters) {
  if (!navigator.onLine) throw new Error('This section needs an internet connection.');
  const response = await fetch(`${apiBaseUrl()}/v1/ask/stream`, {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, filters }),
    // No AbortSignal.timeout here: the whole point is a response that arrives over time. The
    // stream ends when the server closes it.
    cache: 'no-store',
  });
  if (!response.ok || !response.body) throw new Error(`Fortress API returned ${response.status}.`);

  let answer = '';
  let sources = [];
  let meta = {};
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
      const name = (frame.match(/^event: (.+)$/m) || [])[1];
      const raw = (frame.match(/^data: (.+)$/m) || [])[1];
      if (!name || !raw) continue;
      let data;
      try { data = JSON.parse(raw); } catch { continue; }
      if (name === 'status') renderStage(data.stage);
      else if (name === 'sources') {
        sources = data.sources || [];
        meta = data.meta || {};
        renderProgress(answer, sources, meta);
      } else if (name === 'delta') {
        answer += data.text || '';
        renderProgress(answer, sources, meta);
      } else if (name === 'replace') {
        answer = data.answer || '';
        renderProgress(answer, sources, meta);
      } else if (name === 'done') {
        renderAnswer({ answer: data.answer ?? answer, sources, meta: data.meta || meta });
        return;
      } else if (name === 'error') {
        els.assistantResult.innerHTML = `<div class="empty-state">${escapeHtml(data.message || 'Ask could not answer that.')}</div>`;
        return;
      }
    }
  }
  // The stream ended without a `done` event -- show whatever did arrive rather than nothing.
  if (answer) renderAnswer({ answer, sources, meta });
  else throw new Error('The answer was cut short.');
}

function renderStage(stage) {
  const label = STAGE_LABELS[stage] || 'Thinking';
  els.assistantResult.innerHTML = `
    <div class="assistant-stage" role="status">
      <div class="assistant-thinking"><span></span><span></span><span></span></div>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

/** The answer as it stands so far, with a cursor while more of it is still arriving. */
function renderProgress(answer, sources, meta) {
  els.assistantResult.innerHTML = `
    ${answer ? `<article class="assistant-answer"><p>${formatAnswer(answer)}<span class="assistant-cursor" aria-hidden="true"></span></p></article>`
      : '<div class="assistant-stage" role="status"><div class="assistant-thinking"><span></span><span></span><span></span></div><span>Writing the answer</span></div>'}
    <div class="assistant-sources">${renderSources(sources)}</div>
    ${unverifiedNote(meta)}
  `;
}

function renderAnswer(data) {
  els.assistantResult.innerHTML = `
    <article class="assistant-answer"><p>${formatAnswer(data.answer)}</p></article>
    <div class="assistant-sources">${renderSources(data.sources)}</div>
    ${unverifiedNote(data.meta)}
    ${typeof data.meta.remainingToday === 'number' ? `<p class="assistant-remaining">${data.meta.remainingToday} questions remaining today on this connection.</p>` : ''}
  `;
}

const formatAnswer = (answer) => escapeHtml(answer || '').replace(/\n/g, '<br>');

const unverifiedNote = (meta) => (meta && meta.includesUnverifiedSource
  ? '<p class="assistant-note">This answer draws on at least one source that is not yet independently verified -- clearly marked above.</p>'
  : '');

function renderSources(sources) {
  return (sources || []).map((source) => {
    const isVerified = source.verificationStatus === 'verified';
    return `
    <a class="assistant-source${isVerified ? '' : ' assistant-source--unverified'}" href="${escapeHtml(source.canonicalUrl)}">
      <span>[${source.index}] ${escapeHtml(source.collection)}</span>
      <strong>${escapeHtml(source.reference)}</strong>
      <small>${isVerified ? 'Verified' : 'Not yet verified'}</small>
    </a>
  `;
  }).join('');
}
