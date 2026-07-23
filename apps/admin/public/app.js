const authBase = location.hostname.startsWith('admin-test.')
  ? 'https://auth-test.fortressofmuslim.org'
  : ['localhost', '127.0.0.1'].includes(location.hostname)
    ? 'http://127.0.0.1:8788'
    : 'https://auth.fortressofmuslim.org';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  session: null,
  loaded: new Set(),
  record: null,
  lookups: null,
  queue: { params: {}, offset: 0, limit: 50, total: 0 },
};
const reviewFields = [
  'arabic', 'translation', 'transliteration', 'narrator', 'collection', 'book',
  'chapter', 'number', 'references', 'grades', 'formatting', 'completeness',
  'duplicate_detection',
];
const resourceNames = {
  'api-keys': 'API keys',
  'oauth-clients': 'Connected apps',
  devices: 'Devices',
  'mcp-servers': 'MCP toolsets',
  'mcp-tools': 'External tool review',
  'named-queries': 'Named queries',
};

for (const section of $$('[data-resource]')) {
  $('resource-header', section).outerHTML = `<header><div><span class="kicker">PLATFORM RESOURCES</span><h1>${resourceNames[section.dataset.resource]}</h1><p>Inspect ownership and change platform access state.</p></div></header>`;
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#login-message').textContent = 'Signing in...';
  try {
    await api('/api/auth/sign-in/email', { method: 'POST', body: Object.fromEntries(new FormData(event.currentTarget)) });
    await bootstrap();
  } catch (error) {
    $('#login-message').textContent = error.message;
  }
});
$$('[data-sign-out]').forEach((button) => button.addEventListener('click', async () => {
  await api('/api/auth/sign-out', { method: 'POST' }).catch(() => {});
  location.reload();
}));
$('[data-profile]').addEventListener('click', () => {
  const menu = $('[data-profile-menu]');
  menu.hidden = !menu.hidden;
  $('[data-profile]').setAttribute('aria-expanded', String(!menu.hidden));
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('[data-profile], [data-profile-menu]')) $('[data-profile-menu]').hidden = true;
});
$('[data-menu]').addEventListener('click', () => $('#console').classList.toggle('nav-open'));
$('[data-scrim]').addEventListener('click', () => $('#console').classList.remove('nav-open'));
$$('[data-nav]').forEach((link) => link.addEventListener('click', () => $('#console').classList.remove('nav-open')));
window.addEventListener('hashchange', route);
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    event.preventDefault();
    $('#global-search input').focus();
  }
});

$('#global-search').addEventListener('submit', (event) => {
  event.preventDefault();
  const query = new FormData(event.currentTarget).get('q');
  location.hash = 'search';
  $('#search-form input').value = query;
  runSearch(query);
});
$('#search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch(new FormData(event.currentTarget).get('q'));
});
$$('[data-filter]').forEach((form) => form.addEventListener('submit', (event) => {
  event.preventDefault();
  loadView(form.dataset.filter, true, Object.fromEntries(new FormData(form)));
}));
$('[data-refresh]').addEventListener('click', () => loadOverview());

async function bootstrap() {
  let session;
  try {
    session = await api('/api/auth/get-session');
  } catch {
    session = null;
  }
  if (!session?.user) {
    $('#login').hidden = false;
    $('#console').hidden = true;
    return;
  }
  try {
    state.session = (await api('/v1/admin/session')).data;
  } catch (error) {
    if (error.status === 403) {
      $('#denied').hidden = false;
      $('#login').hidden = true;
      return;
    }
    throw error;
  }
  $('#login').hidden = true;
  $('#denied').hidden = true;
  $('#console').hidden = false;
  $('[data-user-name]').textContent = state.session.user.name;
  $('[data-user-email]').textContent = state.session.user.email;
  $('[data-role]').textContent = human(state.session.role);
  $('[data-editorial-role]').textContent = human(state.session.editorialRole);
  $('[data-initials]').textContent = initials(state.session.user.name || state.session.user.email);
  route();
}

function route() {
  let id = location.hash.slice(1) || 'overview';
  if (!document.getElementById(id)?.classList.contains('view')) id = 'overview';
  $$('.view').forEach((view) => { view.hidden = view.id !== id; });
  $$('[data-nav]').forEach((link) => link.classList.toggle('active', link.hash === `#${id}`));
  loadView(id);
}

async function loadView(id, force = false, params = {}) {
  if (state.loaded.has(id) && !force) return;
  try {
    if (id === 'overview') await loadOverview();
    else if (id === 'queue') await loadQueue(params);
    else if (id === 'assignments') await Promise.all([loadLookups(), loadAssignments()]);
    else if (id === 'batches') await Promise.all([loadBatches(), loadDatasets()]);
    else if (id === 'roles') await loadRoles();
    else if (id === 'users') await loadUsers(params);
    else if (id === 'taxonomy') await loadTaxonomy(params);
    else if (id === 'services') await loadServices();
    else if (id === 'audit') await loadAudit(params);
    else if (resourceNames[id]) await loadResources(id);
    state.loaded.add(id);
  } catch (error) {
    notify(error.message, true);
  }
}

async function loadOverview() {
  const [platform, editorial] = await Promise.all([
    api('/v1/admin/overview'),
    api('/v1/admin/editorial/overview'),
  ]);
  const labels = {
    users: 'Users',
    apiKeys: 'Active API keys',
    oauthClients: 'Connected apps',
    canonicalRecords: 'Canonical candidates',
    pendingEditorial: 'Awaiting publication',
    publishedRecords: 'Published records',
    disagreements: 'Open disagreements',
  };
  $('#metrics').innerHTML = Object.entries(platform.data.counts)
    .filter(([key]) => labels[key])
    .map(([key, value]) => `<div class="metric"><span>${labels[key]}</span><strong>${value}</strong></div>`)
    .join('');
  $('#overview-queues').innerHTML = Object.entries(editorial.data.queues)
    .map(([key, value]) => `<button class="service-line" data-queue-state="${esc(key)}"><span><strong>${esc(human(key))}</strong><small>Editorial records</small></span><span class="badge">${value}</span></button>`)
    .join('') || empty();
  $('#overview-services').innerHTML = platform.data.services
    .map((service) => `<div class="service-line"><span><strong>${esc(service.displayName)}</strong><small>${esc(service.enforcement)} enforcement</small></span><span class="badge ${esc(service.status)}">${esc(service.status)}</span></div>`)
    .join('');
}
$('#overview-queues').addEventListener('click', (event) => {
  const button = event.target.closest('[data-queue-state]');
  if (!button) return;
  location.hash = 'queue';
  $('[data-filter="queue"] [name="state"]').value = button.dataset.queueState;
  loadQueue({ state: button.dataset.queueState });
});

async function runSearch(value) {
  const query = String(value || '').trim();
  if (query.length < 2) return;
  const rows = (await api(`/v1/admin/search?q=${encodeURIComponent(query)}`)).data;
  $('#search-results').innerHTML = rows.length
    ? rows.map((item) => `<button class="search-item" data-result-type="${esc(item.type)}" data-result-id="${esc(item.id)}"><span class="badge">${esc(human(item.type))}</span><span><strong>${esc(item.label)}</strong><small>${esc(item.detail || item.id)}</small></span><span>Open</span></button>`).join('')
    : empty('No matching platform records.');
}
$('#search-results').addEventListener('click', (event) => {
  const item = event.target.closest('[data-result-type]');
  if (!item) return;
  if (item.dataset.resultType === 'editorial-record') return showRecord(item.dataset.resultId);
  if (item.dataset.resultType === 'user') return showUser(item.dataset.resultId);
  const routes = { 'api-key': 'api-keys', 'oauth-client': 'oauth-clients', device: 'devices', 'mcp-server': 'mcp-servers', 'named-query': 'named-queries' };
  location.hash = routes[item.dataset.resultType] || 'search';
});

async function loadQueue(params = {}) {
  const offset = Number(params.offset ?? 0);
  const query = { ...params, offset, limit: state.queue.limit };
  const response = await api(`/v1/admin/editorial/queue?${new URLSearchParams(query)}`);
  const rows = response.data;
  state.queue = {
    params: Object.fromEntries(Object.entries(params).filter(([key]) => key !== 'offset')),
    offset,
    limit: response.pagination.limit,
    total: response.pagination.total,
  };
  $('#queue-table').innerHTML = tableHead(['Record', 'Collection', 'Revision', 'State', ''])
    + (rows.map((row) => `<div class="row"><span><strong>${esc(row.title)}</strong><small>${esc(row.canonicalId)}</small></span><span><strong>${esc(row.collection || 'Unassigned')}</strong><small>${esc(row.contentType)}${row.assignedTo ? ` &middot; assigned` : ''}</small></span><span>${row.revisionNumber}</span><span class="badge ${esc(row.workflowState)}">${esc(human(row.workflowState))}</span><span class="actions"><button data-record="${esc(row.canonicalId)}">Review</button></span></div>`).join('') || empty());
  const start = rows.length ? offset + 1 : 0;
  const end = offset + rows.length;
  $('#queue-pagination').innerHTML = `<span>${start}-${end} of ${response.pagination.total}</span><div><button data-queue-page="${Math.max(0, offset - response.pagination.limit)}" ${offset === 0 ? 'disabled' : ''}>Previous</button><button data-queue-page="${offset + response.pagination.limit}" ${!response.pagination.hasMore ? 'disabled' : ''}>Next</button></div>`;
}
$('#queue-table').addEventListener('click', (event) => {
  const button = event.target.closest('[data-record]');
  if (button) showRecord(button.dataset.record);
});
$('#queue-pagination').addEventListener('click', (event) => {
  const button = event.target.closest('[data-queue-page]');
  if (!button || button.disabled) return;
  loadQueue({ ...state.queue.params, offset: Number(button.dataset.queuePage) });
});

async function loadLookups() {
  if (state.lookups) return;
  state.lookups = (await api('/v1/admin/editorial/lookups')).data;
  fillSelect($('#assignment-form [name="assignedTo"]'), state.lookups.reviewers, (row) => ({
    value: row.id,
    label: `${row.name} (${human(row.role)})`,
  }));
  fillSelect($('#assignment-form [name="collectionId"]'), state.lookups.collections, (row) => ({
    value: row.id,
    label: row.title,
  }));
  fillSelect($('#assignment-form [name="bookId"]'), state.lookups.books, (row) => ({
    value: row.id,
    label: `${row.collectionTitle} / ${row.number} ${row.title}`,
  }));
  fillSelect($('#assignment-form [name="chapterId"]'), state.lookups.chapters, (row) => ({
    value: row.id,
    label: `${row.bookTitle} / ${row.number} ${row.title}`,
  }));
}

async function showRecord(id) {
  const data = (await api(`/v1/admin/editorial/records/${encodeURIComponent(id)}`)).data;
  state.record = data;
  const reviewed = new Map(data.fieldReviews
    .filter((item) => item.reviewerId === state.session.user.id)
    .map((item) => [item.fieldName, item]));
  const grouped = groupSegments(data.segments);
  const reviewers = [...new Set(data.fieldReviews.map((item) => item.reviewerId))];
  const priorRevisions = data.revisions.filter((revision) => revision.id !== data.record.revisionId);
  $('#record-detail').innerHTML = `
    <header class="editor-head"><div><span class="kicker">CANONICAL RECORD</span><h2>${esc(data.record.title)}</h2><p>${esc(data.record.canonicalId)} &middot; revision ${data.record.revisionNumber}</p></div><button type="button" data-close-dialog aria-label="Close">&times;</button></header>
    <div class="verification-banner"><strong>${esc(human(data.record.workflowState))}</strong><span>${esc(data.record.collectionTitle || 'Collection pending editorial confirmation')}</span><small>${reviewers.length} reviewer${reviewers.length === 1 ? '' : 's'} started &middot; ${data.decisions.length} decisions</small></div>
    <section class="editor-section"><header><div><h3>Revision content</h3><p>Review the immutable text snapshot currently assigned to this record.</p></div></header>
      ${grouped.map((part) => `<div class="revision-part"><strong>Part ${part.position}</strong>${part.segments.map((segment) => `<label>${esc(human(segment.kind))}<textarea rows="${segment.kind === 'arabic' ? 4 : 3}" dir="${segment.kind === 'arabic' ? 'rtl' : 'ltr'}" data-segment="${part.position}:${segment.segmentPosition}">${esc(segment.text)}</textarea></label>`).join('')}</div>`).join('')}
      <form id="revision-form" class="inline-control"><input name="title" value="${esc(data.record.title)}" aria-label="Corrected title"><input name="reason" placeholder="Correction reason (required)" minlength="10"><button type="submit">Create correction revision</button></form>
    </section>
    <section class="editor-section"><header><div><h3>Revision history</h3><p>Compare the current immutable snapshot with any earlier correction.</p></div></header>
      ${priorRevisions.map((revision) => `<div class="history-row"><span><strong>Revision ${revision.revisionNumber}</strong><small>${esc(revision.correctionReason || 'Imported candidate')} &middot; ${date(revision.createdAt)}</small></span><button data-compare-revision="${esc(revision.id)}">Compare</button></div>`).join('') || empty('This is the first revision.')}
    </section>
    <section class="editor-section"><header><div><h3>Duplicate assistance</h3><p>Title similarity is a reviewer aid only; it never makes an editorial decision.</p></div><button data-find-duplicates>Check candidates</button></header><div data-duplicate-results></div></section>
    <section class="editor-section"><header><div><h3>Canonical references</h3><p>Reference locators are Fortress-owned evidence metadata, not provider links.</p></div></header>
      <div id="reference-list">${data.references.map(referenceRow).join('') || empty('No canonical references attached.')}</div>
      <form id="reference-form" class="inline-control"><input name="referenceType" placeholder="Reference type" value="primary" required><input name="locator" placeholder="Canonical locator" required><button type="submit">Add reference</button></form>
    </section>
    <section class="editor-section"><header><div><h3>Field verification</h3><p>All 13 checks are required from each independent reviewer.</p></div></header>
      <form id="field-review-form" class="field-review-grid">${reviewFields.map((field) => {
        const previous = reviewed.get(field);
        return `<label><span>${esc(human(field))}</span><select name="${esc(field)}" ${previous ? 'disabled' : ''}><option value="verified" ${previous?.decision === 'verified' ? 'selected' : ''}>Verified</option><option value="correction_required" ${previous?.decision === 'correction_required' ? 'selected' : ''}>Correction required</option><option value="not_applicable" ${previous?.decision === 'not_applicable' ? 'selected' : ''}>Not applicable</option></select></label>`;
      }).join('')}<button class="primary" type="submit" ${reviewed.size === reviewFields.length ? 'disabled' : ''}>Submit remaining field checks</button></form>
    </section>
    <section class="editor-section"><header><div><h3>Decisions</h3><p>Two independent reviewers must approve before a separate senior approval.</p></div></header>
      <div class="decision-bar"><button data-decision="approved" data-stage="independent_review">Independent approve</button><button data-decision="changes_requested" data-stage="independent_review">Request changes</button><button class="primary" data-decision="approved" data-stage="senior_approval">Senior approve</button></div>
      ${data.decisions.map((item) => `<div class="history-row"><span><strong>${esc(human(item.decision))}</strong><small>${esc(human(item.reviewStage))} by ${esc(item.reviewerId)}</small></span><small>${date(item.decidedAt)}</small></div>`).join('') || empty('No review decisions yet.')}
    </section>`;
  if (!$('#record-dialog').open) $('#record-dialog').showModal();
}

function referenceRow(reference) {
  const actions = reference.verificationStatus === 'pending'
    ? `<button data-reference="${esc(reference.id)}" data-reference-decision="verified">Verify</button><button class="danger" data-reference="${esc(reference.id)}" data-reference-decision="rejected">Reject</button>`
    : '';
  return `<div class="evidence-row"><span><strong>${esc(human(reference.referenceType))}</strong><small>${esc(reference.locator)}</small></span><span><span class="badge ${esc(reference.verificationStatus)}">${esc(reference.verificationStatus)}</span>${actions}</span></div>`;
}

$('#record-detail').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = state.record?.record?.canonicalId;
  if (!id) return;
  try {
    if (event.target.id === 'field-review-form') {
      const reviews = [...new FormData(event.target)].map(([field, decision]) => ({ field, decision }));
      await api(`/v1/admin/editorial/records/${encodeURIComponent(id)}/field-reviews`, { method: 'POST', body: { reviews } });
      notify('Immutable field review submitted.');
    } else if (event.target.id === 'reference-form') {
      await api(`/v1/admin/editorial/records/${encodeURIComponent(id)}/references`, { method: 'POST', body: Object.fromEntries(new FormData(event.target)) });
      notify('Canonical reference added for independent verification.');
    } else if (event.target.id === 'revision-form') {
      const body = Object.fromEntries(new FormData(event.target));
      body.segments = $$('[data-segment]', $('#record-detail')).map((input) => {
        const [partPosition, segmentPosition] = input.dataset.segment.split(':').map(Number);
        return { partPosition, segmentPosition, text: input.value };
      });
      await api(`/v1/admin/editorial/records/${encodeURIComponent(id)}/revisions`, { method: 'POST', body });
      notify('New immutable revision created.');
    }
    await showRecord(id);
    state.loaded.delete('queue');
  } catch (error) {
    notify(error.message, true);
  }
});

$('#record-detail').addEventListener('click', async (event) => {
  const id = state.record?.record?.canonicalId;
  if (!id) return;
  const decision = event.target.closest('[data-decision]');
  const reference = event.target.closest('[data-reference-decision]');
  const compare = event.target.closest('[data-compare-revision]');
  const duplicates = event.target.closest('[data-find-duplicates]');
  try {
    if (compare) {
      return showRevisionComparison(id, compare.dataset.compareRevision);
    } else if (duplicates) {
      const rows = (await api(`/v1/admin/editorial/records/${encodeURIComponent(id)}/duplicates`)).data;
      $('[data-duplicate-results]', $('#record-detail')).innerHTML = rows.length
        ? rows.map((row) => `<button class="duplicate-row" data-record="${esc(row.canonicalId)}"><span><strong>${esc(row.title)}</strong><small>${esc(row.canonicalId)} &middot; ${human(row.workflowState)}</small></span><span>${Math.round(row.score * 100)}%</span></button>`).join('')
        : empty('No likely title duplicates found.');
      return;
    } else if (event.target.closest('[data-duplicate-results] [data-record]')) {
      return showRecord(event.target.closest('[data-record]').dataset.record);
    } else if (decision) {
      await api(`/v1/admin/editorial/records/${encodeURIComponent(id)}/decision`, {
        method: 'POST',
        body: { decision: decision.dataset.decision, stage: decision.dataset.stage },
      });
      notify('Editorial decision recorded.');
    } else if (reference) {
      await api(`/v1/admin/editorial/records/${encodeURIComponent(id)}/references/${encodeURIComponent(reference.dataset.reference)}/review`, {
        method: 'POST',
        body: { decision: reference.dataset.referenceDecision },
      });
      notify('Canonical reference reviewed.');
    } else {
      return;
    }
    await showRecord(id);
    state.loaded.delete('queue');
  } catch (error) {
    notify(error.message, true);
  }
});

async function showRevisionComparison(canonicalId, revisionId) {
  const previous = (await api(`/v1/admin/editorial/records/${encodeURIComponent(canonicalId)}/revisions/${encodeURIComponent(revisionId)}`)).data;
  const current = state.record;
  const dialog = document.createElement('dialog');
  dialog.className = 'editor-dialog compare-dialog';
  dialog.innerHTML = `<header class="editor-head"><div><span class="kicker">REVISION COMPARISON</span><h2>Revision ${previous.revision.revisionNumber} to ${current.record.revisionNumber}</h2><p>${esc(canonicalId)}</p></div><button data-close-dialog aria-label="Close">&times;</button></header>
    <div class="comparison-grid">
      <section><h3>Revision ${previous.revision.revisionNumber}</h3>${revisionText(previous.segments)}</section>
      <section><h3>Current revision ${current.record.revisionNumber}</h3>${revisionText(current.segments)}</section>
    </div>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

function revisionText(segments) {
  return groupSegments(segments).map((part) => `<div class="revision-part"><strong>Part ${part.position}</strong>${part.segments.map((segment) => `<label>${esc(human(segment.kind))}<div class="compare-text" dir="${segment.kind === 'arabic' ? 'rtl' : 'ltr'}">${esc(segment.text)}</div></label>`).join('')}</div>`).join('');
}

$('#assignment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = compactForm(event.target);
  try {
    const response = await api('/v1/admin/editorial/assignments', { method: 'POST', body });
    event.target.reset();
    notify(`Editorial assignment created for ${response.data.matchedRecords} record${response.data.matchedRecords === 1 ? '' : 's'}.`);
    loadAssignments();
  } catch (error) {
    notify(error.message, true);
  }
});
async function loadAssignments() {
  const rows = (await api('/v1/admin/editorial/assignments')).data;
  $('#assignments-table').innerHTML = tableHead(['Scope', 'Target', 'Reviewer', 'Status', 'Created'])
    + rows.map((row) => `<div class="row"><span><strong>${esc(human(row.scopeType))}</strong><small>${esc(row.id)}</small></span><span>${esc(row.canonicalId || row.chapterId || row.bookId || row.collectionId || `${row.rangeStart || ''}-${row.rangeEnd || ''}`)}</span><code>${esc(row.assignedTo)}</code><span class="badge ${esc(row.status)}">${esc(row.status)}</span><span>${date(row.createdAt)}</span></div>`).join('');
}

$('#batch-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/v1/admin/editorial/batches', { method: 'POST', body: Object.fromEntries(new FormData(event.target)) });
    event.target.reset();
    notify('Publication batch created.');
    loadBatches();
  } catch (error) {
    notify(error.message, true);
  }
});
async function loadBatches() {
  const rows = (await api('/v1/admin/editorial/batches')).data;
  $('#batches-table').innerHTML = tableHead(['Batch', 'Items', 'Status', 'Created', ''])
    + rows.map((row) => `<div class="row"><span><strong>${esc(row.label)}</strong><small>${esc(row.id)}</small></span><span>${row.itemCount}</span><span class="badge ${esc(row.status)}">${esc(row.status)}</span><span>${date(row.createdAt)}</span><span class="actions">${batchActions(row)}</span></div>`).join('');
}
function batchActions(row) {
  const inspect = `<button data-batch-view="${esc(row.id)}">Inspect</button>`;
  if (row.status === 'draft') return `${inspect}<button data-batch-add="${esc(row.id)}">Add records</button><button data-batch-action="validate" data-batch="${esc(row.id)}">Validate</button>`;
  if (row.status === 'validated') return `${inspect}<button data-batch-action="approve" data-batch="${esc(row.id)}">Approve</button>`;
  if (row.status === 'approved') return `${inspect}<button class="primary" data-batch-action="publish" data-batch="${esc(row.id)}">Publish</button>`;
  return inspect;
}
$('#batches-table').addEventListener('click', async (event) => {
  const view = event.target.closest('[data-batch-view]');
  if (view) return showBatch(view.dataset.batchView);
  const add = event.target.closest('[data-batch-add]');
  if (add) {
    $('#batch-action-form').reset();
    $('#batch-action-form').elements.batchId.value = add.dataset.batchAdd;
    return $('#batch-dialog').showModal();
  }
  const action = event.target.closest('[data-batch-action]');
  if (!action) return;
  if (!await confirmChange(`${human(action.dataset.batchAction)} batch`, 'This advances the canonical publication workflow and is recorded in the audit history.')) return;
  try {
    await api(`/v1/admin/editorial/batches/${encodeURIComponent(action.dataset.batch)}/${action.dataset.batchAction}`, { method: 'POST' });
    notify(`Batch ${action.dataset.batchAction} complete.`);
    loadBatches();
    loadOverview();
  } catch (error) {
    notify(error.message, true);
  }
});

async function showBatch(id) {
  const data = (await api(`/v1/admin/editorial/batches/${encodeURIComponent(id)}`)).data;
  const report = data.batch.validationReport || {};
  const dialog = document.createElement('dialog');
  dialog.className = 'editor-dialog batch-detail';
  dialog.innerHTML = `<header class="editor-head"><div><span class="kicker">PUBLICATION BATCH</span><h2>${esc(data.batch.label)}</h2><p>${esc(data.batch.id)} &middot; ${human(data.batch.status)}</p></div><button data-close-dialog aria-label="Close">&times;</button></header>
    <section class="editor-section"><h3>Validation report</h3>${report.itemCount !== undefined
      ? `<div class="validation-summary"><span class="badge ${report.valid ? 'verified' : 'rejected'}">${report.valid ? 'Valid' : 'Blocked'}</span><span>${report.itemCount} records checked</span></div>${(report.invalidRecords || []).map((item) => `<div class="validation-error"><strong>${esc(item.canonicalId)}</strong><ul>${item.issues.map((issue) => `<li>${esc(issue)}</li>`).join('')}</ul></div>`).join('')}`
      : empty('This draft has not been validated.')}</section>
    <section class="editor-section"><h3>Records</h3>${data.items.map((item) => `<div class="history-row"><span><strong>${esc(item.title)}</strong><small>${esc(item.canonicalId)} &middot; revision ${item.revisionNumber} &middot; ${human(item.workflowState)}</small></span>${data.batch.status === 'draft' ? `<button class="danger" data-remove-batch-record="${esc(item.canonicalId)}">Remove</button>` : ''}</div>`).join('') || empty('No records have been added.')}</section>`;
  dialog.addEventListener('click', async (event) => {
    const remove = event.target.closest('[data-remove-batch-record]');
    if (!remove) return;
    try {
      await api(`/v1/admin/editorial/batches/${encodeURIComponent(id)}/items`, {
        method: 'DELETE',
        body: { canonicalIds: [remove.dataset.removeBatchRecord] },
      });
      notify('Record removed from the draft batch.');
      dialog.close();
      await Promise.all([loadBatches(), showBatch(id)]);
    } catch (error) {
      notify(error.message, true);
    }
  });
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

async function loadDatasets() {
  const rows = (await api('/v1/admin/editorial/datasets')).data;
  $('#datasets-table').innerHTML = tableHead(['Dataset', 'Records', 'Status', 'Published', ''])
    + rows.map((row) => `<div class="row"><span><strong>${esc(row.versionLabel)}</strong><small>${esc(row.id)}</small></span><span>${row.recordCount}<small>${row.snapshotCount} snapshotted</small></span><span class="badge ${esc(row.publicationStatus)}">${esc(human(row.publicationStatus))}</span><span>${date(row.publishedAt)}</span><span class="actions">${row.publicationStatus !== 'published' && Number(row.snapshotCount) === Number(row.recordCount) ? `<button class="danger" data-rollback-dataset="${esc(row.id)}">Rollback to this</button>` : ''}</span></div>`).join('');
}

$('#datasets-table').addEventListener('click', (event) => {
  const button = event.target.closest('[data-rollback-dataset]');
  if (!button) return;
  showRollbackDialog(button.dataset.rollbackDataset);
});

function showRollbackDialog(datasetId) {
  const dialog = document.createElement('dialog');
  dialog.className = 'editor-dialog rollback-dialog';
  dialog.innerHTML = `<form><header><div><span class="kicker">DATASET ROLLBACK</span><h2>Restore prior snapshot</h2><p>${esc(datasetId)}</p></div><button type="button" data-close-dialog aria-label="Close">&times;</button></header><div class="form-grid"><label class="wide">Reason<textarea name="reason" rows="4" minlength="10" maxlength="1000" required></textarea></label><div class="warning wide"><span>This creates a new immutable dataset and immediately changes every public API, MCP, RAG, and PWA snapshot source.</span></div></div><footer><button type="button" data-close-dialog>Cancel</button><button class="danger" type="submit">Confirm rollback</button></footer></form>`;
  dialog.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api(`/v1/admin/editorial/datasets/${encodeURIComponent(datasetId)}/rollback`, {
        method: 'POST',
        body: Object.fromEntries(new FormData(event.target)),
      });
      dialog.close();
      notify('Canonical dataset rollback published.');
      await Promise.all([loadDatasets(), loadBatches(), loadOverview()]);
    } catch (error) {
      notify(error.message, true);
    }
  });
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}
$('#batch-action-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target));
  const canonicalIds = String(values.canonicalIds).split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  try {
    await api(`/v1/admin/editorial/batches/${encodeURIComponent(values.batchId)}/items`, { method: 'POST', body: { canonicalIds } });
    $('#batch-dialog').close();
    notify('Approved records added to batch.');
    loadBatches();
  } catch (error) {
    notify(error.message, true);
  }
});

async function loadRoles() {
  const rows = (await api('/v1/admin/editorial/roles')).data;
  const roles = ['viewer', 'reviewer', 'senior_reviewer', 'editor', 'publisher', 'super_administrator'];
  $('#roles-table').innerHTML = tableHead(['User', 'Editorial role', 'Status', ''])
    + rows.map((row) => `<div class="row"><span><strong>${esc(row.name)}</strong><small>${esc(row.email)}</small></span><select data-role-user="${esc(row.userId)}">${roles.map((role) => `<option ${role === row.role ? 'selected' : ''}>${role}</option>`).join('')}</select><select data-role-status="${esc(row.userId)}"><option ${row.status === 'active' ? 'selected' : ''}>active</option><option ${row.status !== 'active' ? 'selected' : ''}>inactive</option></select><span><button data-save-role="${esc(row.userId)}">Save</button></span></div>`).join('');
}
$('#roles-table').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-save-role]');
  if (!button) return;
  const userId = button.dataset.saveRole;
  try {
    await api('/v1/admin/editorial/roles', {
      method: 'PATCH',
      body: {
        userId,
        role: $(`[data-role-user="${CSS.escape(userId)}"]`).value,
        status: $(`[data-role-status="${CSS.escape(userId)}"]`).value,
      },
    });
    notify('Editorial role updated.');
    loadRoles();
  } catch (error) {
    notify(error.message, true);
  }
});

async function loadUsers(params = {}) {
  const rows = (await api(`/v1/admin/users?${new URLSearchParams(params)}`)).data;
  $('#users-table').innerHTML = tableHead(['User', 'Plan', 'Credentials', 'Status', ''])
    + rows.map((user) => `<div class="row"><span><strong>${esc(user.name)}</strong><small>${esc(user.email)}</small></span><span>${esc(user.planCode)}</span><span>${user.apiKeyCount} keys &middot; ${user.oauthClientCount} apps</span><span class="badge ${esc(user.status)}">${esc(user.status)}</span><span class="actions"><button data-user-view="${esc(user.id)}">Inspect</button>${user.status === 'active' ? `<button class="danger" data-user-status="suspended" data-id="${esc(user.id)}">Suspend</button>` : `<button data-user-status="active" data-id="${esc(user.id)}">Activate</button>`}</span></div>`).join('');
}
$('#users-table').addEventListener('click', async (event) => {
  const view = event.target.closest('[data-user-view]');
  if (view) return showUser(view.dataset.userView);
  const button = event.target.closest('[data-user-status]');
  if (!button) return;
  const status = button.dataset.userStatus;
  if (await confirmChange(`${human(status)} user`, 'This changes account and credential access immediately.')) {
    await api(`/v1/admin/users/${encodeURIComponent(button.dataset.id)}`, { method: 'PATCH', body: { status } });
    notify(`User ${status}.`);
    loadUsers();
  }
});
async function showUser(id) {
  const data = (await api(`/v1/admin/users/${encodeURIComponent(id)}`)).data;
  const dialog = document.createElement('dialog');
  dialog.className = 'detail-dialog';
  dialog.innerHTML = `<form method="dialog"><h2>${esc(data.user.name)}</h2><p>${esc(data.user.email)} &middot; ${esc(data.user.status)} &middot; ${esc(data.user.planCode)}</p><div class="metrics"><div class="metric"><span>API keys</span><strong>${data.apiKeys.length}</strong></div><div class="metric"><span>Apps</span><strong>${data.oauthClients.length}</strong></div><div class="metric"><span>Devices</span><strong>${data.devices.length}</strong></div><div class="metric"><span>MCP</span><strong>${data.mcpServers.length}</strong></div></div><code>${esc(data.user.id)}</code><div><button>Close</button></div></form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

async function loadResources(type) {
  const rows = (await api(`/v1/admin/resources?type=${encodeURIComponent(type)}`)).data;
  $(`#${type} .resource-table`).innerHTML = tableHead(['Resource', 'Owner', 'Created', 'Status', ''])
    + rows.map((row) => {
      const current = resourceStatus(type, row.status);
      return `<div class="row"><span><strong>${esc(row.name || row.start || row.id)}</strong><small>${esc(row.id)}</small></span><span><strong>${esc(row.ownerName || 'Unknown')}</strong><small>${esc(row.ownerEmail || '')}</small></span><span>${date(row.createdAt)}</span><span class="badge ${esc(current)}">${esc(current)}</span><span class="actions">${resourceActions(type, row.id, current)}</span></div>`;
    }).join('');
}
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-resource-status]');
  if (!button) return;
  const { type, id, resourceStatus: status } = button.dataset;
  if (!await confirmChange(`${human(status)} ${human(type)}`, `This changes the resource to ${human(status)} immediately.`)) return;
  try {
    await api(`/v1/admin/${type}/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status } });
    notify('Resource status updated.');
    loadResources(type);
  } catch (error) {
    notify(error.message, true);
  }
});

async function loadTaxonomy(params = {}) {
  const rows = (await api(`/v1/admin/taxonomy?${new URLSearchParams(params)}`)).data;
  $('#taxonomy-table').innerHTML = tableHead(['Term', 'Type', 'Language', 'Records'])
    + rows.map((row) => `<div class="row"><span><strong>${esc(row.label)}</strong><small>${esc(row.slug)}</small></span><span class="badge">${esc(row.type)}</span><span>${esc(row.languageCode)}</span><span>${row.recordCount}</span></div>`).join('');
}
$('[data-new-term]').addEventListener('click', () => {
  $('#term-form').reset();
  $('#term-form').elements.languageCode.value = 'en';
  $('#term-dialog').showModal();
});
$('#term-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/v1/admin/taxonomy', { method: 'POST', body: Object.fromEntries(new FormData(event.target)) });
    $('#term-dialog').close();
    notify('Taxonomy term created.');
    loadTaxonomy();
  } catch (error) {
    notify(error.message, true);
  }
});

async function loadServices() {
  const rows = (await api('/v1/admin/services')).data;
  $('#services-grid').innerHTML = rows.map((service) => `<article class="service-card"><header><strong>${esc(service.displayName)}</strong><span class="badge ${esc(service.status)}">${esc(service.status)}</span></header><p>${esc(service.serviceType)} &middot; ${esc(service.enforcement)} enforcement</p><small>${esc(service.maintenanceMessage)}</small><footer><code>${esc(service.serviceKey)}</code><div>${service.enforcement === 'worker' && service.serviceKey !== 'admin' ? ['active', 'maintenance', 'disabled'].filter((item) => item !== service.status).map((status) => `<button class="${status === 'disabled' ? 'danger' : ''}" data-service="${esc(service.serviceKey)}" data-service-status="${status}">${human(status)}</button>`).join('') : '<span class="badge">monitor only</span>'}</div></footer></article>`).join('');
}
$('#services-grid').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-service]');
  if (!button) return;
  const status = button.dataset.serviceStatus;
  if (!await confirmChange(`${human(status)} ${button.dataset.service}`, 'Protected routes will reflect this state after edge propagation.')) return;
  await api(`/v1/admin/services/${button.dataset.service}`, { method: 'PATCH', body: { status, message: 'Fortress Platform is temporarily unavailable while maintenance is in progress.' } });
  notify('Service state updated.');
  loadServices();
});

async function loadAudit(params = {}) {
  const rows = (await api(`/v1/admin/audit?${new URLSearchParams(params)}`)).data;
  $('#audit-table').innerHTML = tableHead(['Action', 'Actor', 'Target', 'Time', 'Request'])
    + rows.map((row) => `<div class="row"><span><strong>${esc(human(row.action))}</strong><small>${esc(row.action)}</small></span><span>${esc(row.actorName)}</span><span><strong>${esc(row.targetType)}</strong><small>${esc(row.targetId || '')}</small></span><span>${date(row.occurredAt)}</span><code>${esc(row.requestId || '')}</code></div>`).join('');
}

document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close-dialog]');
  if (close) close.closest('dialog')?.close();
});

function groupSegments(segments) {
  const parts = new Map();
  for (const segment of segments) {
    if (!parts.has(segment.partPosition)) parts.set(segment.partPosition, []);
    parts.get(segment.partPosition).push(segment);
  }
  return [...parts].map(([position, values]) => ({ position, segments: values }));
}
function compactForm(form) {
  return Object.fromEntries([...new FormData(form)].filter(([, value]) => String(value).trim()));
}
function fillSelect(select, rows, map) {
  const first = select.options[0]?.outerHTML || '<option value="">Choose</option>';
  select.innerHTML = first + rows.map((row) => {
    const item = map(row);
    return `<option value="${esc(item.value)}">${esc(item.label)}</option>`;
  }).join('');
}
function resourceStatus(type, value) {
  if (type === 'api-keys') return Number(value) === 1 ? 'active' : 'revoked';
  if (type === 'oauth-clients') return Number(value) === 1 ? 'disabled' : 'active';
  return String(value);
}
function resourceActions(type, id, status) {
  if (type === 'api-keys') return status === 'active' ? actionButton(type, id, 'revoked', 'Revoke') : '';
  if (type === 'oauth-clients') return actionButton(type, id, status === 'active' ? 'disabled' : 'active', status === 'active' ? 'Disable' : 'Activate');
  if (type === 'devices') return status === 'active' ? actionButton(type, id, 'revoked', 'Revoke') : actionButton(type, id, 'active', 'Activate');
  if (type === 'named-queries' || type === 'mcp-servers') return actionButton(type, id, status === 'active' ? 'disabled' : 'active', status === 'active' ? 'Disable' : 'Activate');
  if (type === 'mcp-tools') return `${status !== 'approved' ? actionButton(type, id, 'approved', 'Approve') : ''}${status !== 'rejected' ? actionButton(type, id, 'rejected', 'Reject') : ''}`;
  return '';
}
function actionButton(type, id, status, label) {
  return `<button class="${/revoked|disabled|rejected/.test(status) ? 'danger' : ''}" data-resource-status="${status}" data-type="${type}" data-id="${esc(id)}">${label}</button>`;
}
function tableHead(columns) {
  return `<div class="row head">${columns.map((column) => `<span>${column}</span>`).join('')}</div>`;
}
function empty(message = 'No records found.') {
  return `<p class="empty">${esc(message)}</p>`;
}
async function confirmChange(title, copy) {
  const dialog = $('#confirm');
  $('[data-confirm-title]').textContent = title;
  $('[data-confirm-copy]').textContent = copy;
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}
function notify(message, error = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.style.borderLeftColor = error ? '#d56b6b' : '#66c1bd';
  toast.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toast.hidden = true; }, 4500);
}
async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body && typeof body !== 'string') {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }
  const response = await fetch(`${authBase}${path}`, { ...options, headers, body, credentials: 'include' });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.message || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}
function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}
function human(value) {
  return String(value || '').replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
function initials(value) {
  return String(value).split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}
function date(value) {
  if (!value) return '-';
  const result = new Date(value);
  return Number.isNaN(result.getTime()) ? String(value) : result.toLocaleString();
}

bootstrap().catch((error) => {
  $('#login').hidden = false;
  $('#login-message').textContent = error.message;
});
