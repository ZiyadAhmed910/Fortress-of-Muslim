import { els } from './dom.js';
import { apiBaseUrl, apiRequest } from './online.js';
import { escapeHtml, toast } from './utils.js';
import { openCanonicalRoute } from './routes.js';

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
/** Whether the thread should keep scrolling to the newest turn -- false once the reader scrolls up. */
let followingLatest = true;

export function initAssistant() {
  // Enter sends; Ctrl/Alt/Cmd+Enter inserts a newline. This is the reverse of what it was, and the
  // reverse of the usual editor convention, because a chat composer is not an editor: nearly every
  // question here is one line, and making the common action the modified one is what made the box
  // feel unresponsive.
  els.assistantQuestion.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    if (event.ctrlKey || event.altKey || event.metaKey) {
      event.preventDefault();
      insertNewline();
      return;
    }
    if (event.shiftKey) return;        // shift+Enter is a newline everywhere; leave it alone
    event.preventDefault();
    els.assistantForm.requestSubmit();
  });
  els.assistantQuestion.addEventListener('input', autoGrow);
  els.assistantResult.addEventListener('click', async (event) => {
    if (event.target.closest('[data-new-conversation]')) return resetConversation();
    // A citation opens the record it points at, through the same router that resolves these paths
    // on load -- so "open the hadith" means exactly what /bukhari/book1/1 has always meant.
    const open = event.target.closest('[data-open-source]');
    if (!open) return;
    const source = currentSources().find((item) => item.id === open.dataset.openSource);
    if (!source) return;
    const path = new URL(source.canonicalUrl, location.origin).pathname;
    const opened = await openCanonicalRoute(path);
    if (!opened) toast('That source could not be opened in the app.');
  });
  els.assistantReset.addEventListener('click', resetConversation);
  els.assistantResult.addEventListener('scroll', () => {
    const thread = els.assistantResult;
    // A small tolerance: "at the bottom" has to survive sub-pixel heights and a growing answer.
    followingLatest = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 48;
  }, { passive: true });
  els.assistantForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = els.assistantQuestion.value.trim();
    if (question.length < 5) return;
    els.assistantSubmit.disabled = true;
    const scope = els.assistantContentType.value;
    // Quran is a scope the server understands now: verses are retrieved and reranked alongside duas
    // and hadith, and cited the same way. "All sources" genuinely means all of them.
    const filters = scope ? { contentType: scope } : undefined;
    const history = conversation.slice(-HISTORY_TURNS).map((turn) => ({
      question: turn.question,
      answer: turn.answer,
    }));

    const turn = { question, answer: '', sources: [], meta: {}, stage: 'retrieving', scope };
    conversation.push(turn);
    followingLatest = true;
    els.assistantQuestion.value = '';
    autoGrow();
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
  fitAssistantHeight();
  window.addEventListener('resize', fitAssistantHeight);
}

function insertNewline() {
  const box = els.assistantQuestion;
  const { selectionStart: start, selectionEnd: end, value } = box;
  box.value = `${value.slice(0, start)}\n${value.slice(end)}`;
  box.selectionStart = box.selectionEnd = start + 1;
  autoGrow();
}

/**
 * Sizes the chat column to whatever is actually left below the header and tabs, rather than a
 * guessed constant. Measured because the chrome above it is not a fixed height -- it differs
 * between phone and desktop, and between this app's header states -- and a guess that is 57px out
 * leaves the whole page scrolling, which is the thing the layout exists to stop.
 */
export function fitAssistantHeight() {
  const home = els.assistantHome;
  if (!home || home.hidden || !home.getClientRects().length) return;
  // Where the column starts. The stylesheet pins it from there to the bottom of the viewport, so
  // this is the only number it needs -- and it has to be measured, because the header and tabs
  // above are not the same height on a phone as on a desktop.
  //
  // Read with the pin temporarily released: once the element is fixed, its own top is whatever was
  // last set here, and measuring that would just echo the previous value back.
  home.style.position = 'static';
  const top = Math.round(home.getBoundingClientRect().top);
  home.style.position = '';
  document.documentElement.style.setProperty('--ask-top', `${top}px`);
}

/** Grows the composer to fit what is typed, up to the max-height the stylesheet sets. */
function autoGrow() {
  const box = els.assistantQuestion;
  box.style.height = 'auto';
  box.style.height = `${box.scrollHeight}px`;
}

const currentSources = () => conversation.flatMap((turn) => turn.sources || []);

function resetConversation() {
  conversation = [];
  followingLatest = true;
  els.assistantResult.innerHTML = '';
  updatePlaceholder();
  autoGrow();
  els.assistantQuestion.focus();
}

function updatePlaceholder() {
  els.assistantQuestion.placeholder = conversation.length
    ? 'Ask a follow-up, or something new'
    : 'Ask about a dua, a hadith, or a verse';
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
  els.assistantResult.innerHTML = conversation.map(renderTurn).join('');
  // Offered as soon as one question has been answered -- it used to wait for a second, by which
  // point a reader wanting to start over had already scrolled looking for it.
  els.assistantReset.hidden = !conversation.some((turn) => !turn.stage);
  // Keep the newest turn in view as it streams, the way a chat does -- but only while the reader is
  // already at the bottom. Yanking the view back while someone is scrolled up reading an earlier
  // answer is worse than not following at all.
  const thread = els.assistantResult;
  if (followingLatest) thread.scrollTop = thread.scrollHeight;
}

function renderTurn(turn, index) {
  const streaming = turn.stage === 'writing' && turn.answer;
  return `
    <section class="assistant-turn" aria-label="Question ${index + 1}">
      <p class="assistant-question">${escapeHtml(turn.question)}${turn.scope === 'quran' ? ' <span class="assistant-scope">Quran</span>' : ''}</p>
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

/**
 * A citation opens. Seeing "[1] Sahih al-Bukhari 6499" and having to go and find it is the point at
 * which a grounded answer stops being checkable, so the words travel with the citation and the
 * source expands in place. "Open" then goes to the record itself -- the verse in the reader, the
 * dua, the hadith -- rather than leaving the reader to search for it.
 */
function renderSources(sources) {
  return sources.map((source) => {
    const isVerified = source.verificationStatus === 'verified';
    const hasText = Boolean(source.arabic || source.translation);
    return `
    <details class="assistant-source${isVerified ? '' : ' assistant-source--unverified'}">
      <summary>
        <span class="assistant-source-ref">
          <span>[${source.index}] ${escapeHtml(source.collection)}</span>
          <strong>${escapeHtml(withoutCollection(source))}</strong>
        </span>
        <small>${isVerified ? 'Verified' : 'Not yet verified'}</small>
      </summary>
      <div class="assistant-source-body">
        ${source.arabic ? `<p class="verse-arabic" dir="rtl" lang="ar">${escapeHtml(source.arabic)}</p>` : ''}
        ${source.translation ? `<p class="verse-translation">${escapeHtml(source.translation)}</p>` : ''}
        ${hasText ? '' : '<p class="verse-translation">Open the source to read it.</p>'}
        <button class="text-button" type="button" data-open-source="${escapeHtml(source.id)}"
          data-content-type="${escapeHtml(source.contentType)}"
          ${source.surah ? `data-surah="${source.surah}" data-ayah="${source.ayah}"` : ''}>
          Open ${escapeHtml(sourceKindLabel(source.contentType))}
        </button>
      </div>
    </details>
  `;
  }).join('');
}

const sourceKindLabel = (contentType) => (
  contentType === 'quran' ? 'in the Quran' : contentType === 'hadith' ? 'the hadith' : 'the dua'
);

/**
 * A hadith's reference already names its collection ("Sahih al-Bukhari 6472"), which the line above
 * it also names -- so the citation read "Sahih al-Bukhari Sahih al-Bukhari 6472". The collection
 * stays on the muted line; the strong line is what distinguishes this source from its neighbours.
 */
function withoutCollection(source) {
  const reference = source.reference || '';
  const collection = source.collection || '';
  return collection && reference.startsWith(collection)
    ? reference.slice(collection.length).trim() || reference
    : reference;
}
