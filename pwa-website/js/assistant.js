import { els } from './dom.js';
import { apiBaseUrl, apiRequest } from './online.js';
import { escapeHtml } from './utils.js';

// Ask is a conversation now, because research is. Someone asks about travelling, reads the answer,
// and the next thing they want is "what about returning?" -- which used to mean retyping the whole
// question. Follow-ups carry the earlier turns so the server can rewrite the short one into
// something retrievable.
//
// The history is used to rewrite the query and for nothing else: the model that writes an answer
// still sees only retrieved sources, so nothing it said earlier can be quoted back as though it had
// a citation. Every turn keeps its own sources, visible against that turn.
//
// An answer takes seconds of real work -- retrieval, reranking, then a model writing prose. The
// streaming endpoint reports its stage, hands over the sources as soon as retrieval has them, and
// writes the answer a word at a time. If any of that fails, the single-response endpoint answers.
const STAGE_LABELS = {
  retrieving: 'Searching the published sources',
  writing: 'Writing the answer',
};
// What the server accepts, and about two turns further back than a follow-up usually reaches.
const HISTORY_TURNS = 4;

/** Every turn asked in this conversation. Cleared by "New conversation", never persisted. */
let conversation = [];

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
  els.assistantResult.addEventListener('click', (event) => {
    if (event.target.closest('[data-new-conversation]')) resetConversation();
  });
  els.assistantForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = els.assistantQuestion.value.trim();
    if (question.length < 5) return;
    els.assistantSubmit.disabled = true;
    const contentType = els.assistantContentType.value;
    const filters = contentType ? { contentType } : undefined;
    const history = conversation.slice(-HISTORY_TURNS).map((turn) => ({
      question: turn.question,
      answer: turn.answer,
    }));

    const turn = { question, answer: '', sources: [], meta: {}, stage: 'retrieving' };
    conversation.push(turn);
    els.assistantQuestion.value = '';
    render();

    try {
      await streamAnswer(question, filters, history, turn);
    } catch (error) {
      try {
        const body = await apiRequest('/v1/ask', {
          method: 'POST',
          body: JSON.stringify({ question, filters, history }),
        });
        Object.assign(turn, { answer: body.data.answer, sources: body.data.sources, meta: body.data.meta, stage: null });
      } catch (fallbackError) {
        Object.assign(turn, { stage: null, error: fallbackError.message });
      }
      render();
    } finally {
      els.assistantSubmit.disabled = false;
      updatePlaceholder();
      els.assistantQuestion.focus();
    }
  });
  updatePlaceholder();
}

function resetConversation() {
  conversation = [];
  els.assistantResult.innerHTML = '';
  updatePlaceholder();
  els.assistantQuestion.focus();
}

function updatePlaceholder() {
  els.assistantQuestion.placeholder = conversation.length
    ? 'Ask a follow-up, or start something new'
    : 'What do the sources say about intentions?';
}

/**
 * Reads the server-sent answer into `turn`, re-rendering as it arrives. Throws if the stream cannot
 * be opened at all so the caller can fall back; an `error` event inside a stream that did start is
 * shown as-is, because by then the request really was made and counted against the daily limit.
 */
async function streamAnswer(question, filters, history, turn) {
  if (!navigator.onLine) throw new Error('This section needs an internet connection.');
  const response = await fetch(`${apiBaseUrl()}/v1/ask/stream`, {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, filters, history }),
    // No AbortSignal.timeout: the whole point is a response that arrives over time. The stream
    // ends when the server closes it.
    cache: 'no-store',
  });
  if (!response.ok || !response.body) throw new Error(`Fortress API returned ${response.status}.`);

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
      if (name === 'status') turn.stage = data.stage;
      else if (name === 'sources') {
        turn.sources = data.sources || [];
        turn.meta = data.meta || {};
      } else if (name === 'delta') turn.answer += data.text || '';
      else if (name === 'replace') turn.answer = data.answer || '';
      else if (name === 'done') {
        turn.answer = data.answer ?? turn.answer;
        turn.meta = data.meta || turn.meta;
        turn.stage = null;
        render();
        return;
      } else if (name === 'error') {
        turn.stage = null;
        turn.error = data.message || 'Ask could not answer that.';
        render();
        return;
      }
      render();
    }
  }
  turn.stage = null;
  if (!turn.answer) throw new Error('The answer was cut short.');
  render();
}

function render() {
  els.assistantResult.innerHTML = `
    ${conversation.length > 1 ? '<button class="text-button assistant-reset" type="button" data-new-conversation>Start a new conversation</button>' : ''}
    ${conversation.map(renderTurn).join('')}
  `;
  const last = els.assistantResult.querySelector('.assistant-turn:last-child');
  if (conversation.length > 1) last?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function renderTurn(turn, index) {
  const streaming = turn.stage === 'writing' && turn.answer;
  return `
    <section class="assistant-turn" aria-label="Question ${index + 1}">
      <p class="assistant-question">${escapeHtml(turn.question)}</p>
      ${turn.error ? `<div class="empty-state">${escapeHtml(turn.error)}</div>` : ''}
      ${turn.stage && !turn.answer ? `
        <div class="assistant-stage" role="status">
          <div class="assistant-thinking"><span></span><span></span><span></span></div>
          <span>${escapeHtml(STAGE_LABELS[turn.stage] || 'Thinking')}</span>
        </div>` : ''}
      ${turn.answer ? `<article class="assistant-answer"><p>${formatAnswer(turn.answer)}${streaming ? '<span class="assistant-cursor" aria-hidden="true"></span>' : ''}</p></article>` : ''}
      ${turn.sources.length ? `<div class="assistant-sources">${renderSources(turn.sources)}</div>` : ''}
      ${unverifiedNote(turn.meta)}
      ${!turn.stage && typeof turn.meta.remainingToday === 'number'
        ? `<p class="assistant-remaining">${turn.meta.remainingToday} questions remaining today on this connection.</p>` : ''}
    </section>
  `;
}

const formatAnswer = (answer) => escapeHtml(answer || '').replace(/\n/g, '<br>');

const unverifiedNote = (meta) => (meta && meta.includesUnverifiedSource
  ? '<p class="assistant-note">This answer draws on at least one source that is not yet independently verified -- clearly marked above.</p>'
  : '');

function renderSources(sources) {
  return sources.map((source) => {
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
