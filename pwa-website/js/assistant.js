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
  els.assistantResult.addEventListener('click', (event) => {
    if (event.target.closest('[data-new-conversation]')) resetConversation();
  });
  els.assistantForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = els.assistantQuestion.value.trim();
    if (question.length < 5) return;
    els.assistantSubmit.disabled = true;
    const scope = els.assistantContentType.value;
    // Quran is a different question, not a filter on this one: the ayahs are not part of the corpus
    // Ask answers from, and nothing here should imply an AI is interpreting a verse. Picking it
    // searches the verses and shows them, with no answer written over the top.
    const filters = scope && scope !== 'quran' ? { contentType: scope } : undefined;
    const history = conversation.slice(-HISTORY_TURNS).map((turn) => ({
      question: turn.question,
      answer: turn.answer,
    }));

    const turn = { question, answer: '', sources: [], meta: {}, stage: 'retrieving', scope };
    conversation.push(turn);
    els.assistantQuestion.value = '';
    autoGrow();
    render();

    if (scope === 'quran') {
      try {
        await findVerses(question, turn);
      } catch (error) {
        Object.assign(turn, { stage: null, error: error.message });
      } finally {
        els.assistantSubmit.disabled = false;
        updatePlaceholder();
        render();
      }
      return;
    }

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

function insertNewline() {
  const box = els.assistantQuestion;
  const { selectionStart: start, selectionEnd: end, value } = box;
  box.value = `${value.slice(0, start)}\n${value.slice(end)}`;
  box.selectionStart = box.selectionEnd = start + 1;
  autoGrow();
}

/** Grows the composer to fit what is typed, up to the max-height the stylesheet sets. */
function autoGrow() {
  const box = els.assistantQuestion;
  box.style.height = 'auto';
  box.style.height = `${box.scrollHeight}px`;
}

function resetConversation() {
  conversation = [];
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
  els.assistantResult.innerHTML = `
    ${conversation.length > 1 ? '<button class="text-button assistant-reset" type="button" data-new-conversation>Start a new conversation</button>' : ''}
    ${conversation.map(renderTurn).join('')}
  `;
  const last = els.assistantResult.querySelector('.assistant-turn:last-child');
  if (conversation.length > 1) last?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/**
 * Quran scope: find the verses and show them. No answer is generated over the top, because finding
 * which verses relate to a theme is retrieval and saying what one means is tafsir. The API returns
 * references only -- the translation it searches is not redistributable -- so the words come from
 * the copy this app already ships.
 */
async function findVerses(query, turn) {
  if (!navigator.onLine) throw new Error('Verse search needs an internet connection.');
  const url = `${apiBaseUrl()}/v1/quran/search?q=${encodeURIComponent(query)}&limit=8`;
  const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Verse search returned ${response.status}.`);
  const body = await response.json();
  const matches = body.data || [];
  turn.stage = null;
  turn.verses = await Promise.all(matches.map(async (match) => {
    const surah = await loadSurahText(match.surah);
    const ayah = surah?.ayahs?.find((item) => item.n === match.ayah);
    return { ...match, arabic: ayah?.ar || '', translation: ayah?.en || '' };
  }));
  if (turn.verses.length === 0) turn.answer = 'No verses matched that.';
}

const surahCache = new Map();
async function loadSurahText(number) {
  if (surahCache.has(number)) return surahCache.get(number);
  try {
    const response = await fetch(`./data/quran/surah-${number}.json`);
    const surah = await response.json();
    surahCache.set(number, surah);
    return surah;
  } catch {
    return null;
  }
}

function renderVerses(verses) {
  return `
    <div class="assistant-verses">
      ${verses.map((verse) => `
        <article class="verse-result">
          <header>
            <strong>${escapeHtml(verse.surahName)} ${verse.surah}:${verse.ayah}</strong>
            <small>${escapeHtml(verse.surahNameEnglish)}</small>
          </header>
          ${verse.arabic ? `<p class="verse-arabic" dir="rtl" lang="ar">${escapeHtml(verse.arabic)}</p>` : ''}
          ${verse.translation ? `<p class="verse-translation">${escapeHtml(verse.translation)}</p>` : ''}
        </article>
      `).join('')}
      <p class="verse-search-note">Translation: Saheeh International. Arabic: Tanzil Project (CC BY 3.0).
      These are the verses the search matched, not an interpretation of them.</p>
    </div>
  `;
}

function renderTurn(turn, index) {
  const streaming = turn.stage === 'writing' && turn.answer;
  return `
    <section class="assistant-turn" aria-label="Question ${index + 1}">
      <p class="assistant-question">${escapeHtml(turn.question)}${turn.scope === 'quran' ? ' <span class="assistant-scope">Quran</span>' : ''}</p>
      ${turn.error ? `<div class="empty-state">${escapeHtml(turn.error)}</div>` : ''}
      ${turn.verses?.length ? renderVerses(turn.verses) : ''}
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
