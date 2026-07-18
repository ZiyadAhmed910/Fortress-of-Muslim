const sections = [...document.querySelectorAll('[data-search-title]')];
const searchDialog = document.querySelector('.search-dialog');
const searchInput = document.querySelector('#doc-search');
const searchResults = document.querySelector('#search-results');

function openSearch() {
  searchDialog.hidden = false;
  document.body.style.overflow = 'hidden';
  searchInput.focus();
}

function closeSearch() {
  searchDialog.hidden = true;
  document.body.style.overflow = '';
}

document.querySelector('[data-search-open]').addEventListener('click', openSearch);
document.querySelector('[data-search-close]').addEventListener('click', closeSearch);
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
  if (event.key === 'Escape' && !searchDialog.hidden) closeSearch();
});

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim().toLocaleLowerCase();
  if (!query) { searchResults.innerHTML = '<p>Start typing to search this page.</p>'; return; }
  const matches = sections.filter((section) => section.textContent.toLocaleLowerCase().includes(query)).slice(0, 10);
  searchResults.innerHTML = matches.length ? matches.map((section) => `
    <a class="search-result" href="#${section.id}">
      <strong>${escapeHtml(section.dataset.searchTitle)}</strong>
      <small>${escapeHtml(section.querySelector('p')?.textContent.slice(0, 110) || 'API documentation')}</small>
    </a>`).join('') : '<p>No documentation matched that search.</p>';
  searchResults.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeSearch));
});

document.querySelectorAll('[data-code-group]').forEach((group) => {
  group.querySelectorAll('[data-code-tab]').forEach((tab) => tab.addEventListener('click', () => {
    const name = tab.dataset.codeTab;
    group.querySelectorAll('[data-code-tab]').forEach((item) => item.classList.toggle('active', item === tab));
    group.querySelectorAll('[data-code-panel]').forEach((panel) => {
      const active = panel.dataset.codePanel === name;
      panel.hidden = !active;
      panel.classList.toggle('active-code', active);
    });
  }));
});

const navLinks = [...document.querySelectorAll('#doc-nav a[href^="#"]')];
const observer = new IntersectionObserver((entries) => {
  const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  navLinks.forEach((link) => link.classList.toggle('active', link.hash === `#${visible.target.id}`));
}, { rootMargin: '-20% 0px -65%', threshold: [0, .2, .6] });
sections.forEach((section) => observer.observe(section));
navLinks.forEach((link) => link.addEventListener('click', () => document.body.classList.remove('nav-open')));

const environment = document.querySelector('#environment');
const pathInput = document.querySelector('#api-path');
const sendButton = document.querySelector('#send-request');
const responseBody = document.querySelector('#response-body');
const responseState = document.querySelector('#response-state');
const responseTime = document.querySelector('#response-time');

document.querySelectorAll('[data-explorer-path]').forEach((link) => link.addEventListener('click', () => {
  pathInput.value = link.dataset.explorerPath;
}));

sendButton.addEventListener('click', async () => {
  const path = pathInput.value.trim();
  if (!path.startsWith('/')) { responseState.textContent = 'Invalid path'; responseState.className = 'response-state error'; return; }
  sendButton.disabled = true;
  responseState.textContent = 'Loading'; responseState.className = 'response-state';
  responseBody.textContent = 'Sending request...'; responseTime.textContent = '';
  const started = performance.now();
  try {
    const response = await fetch(`${environment.value}${path}`);
    const data = await response.json();
    responseBody.textContent = JSON.stringify(data, null, 2);
    responseState.textContent = `${response.status} ${response.ok ? 'OK' : 'Error'}`;
    responseState.className = `response-state ${response.ok ? 'ok' : 'error'}`;
  } catch (error) {
    responseBody.textContent = JSON.stringify({ error: { message: error.message } }, null, 2);
    responseState.textContent = 'Network error'; responseState.className = 'response-state error';
  } finally {
    responseTime.textContent = `${Math.round(performance.now() - started)} ms`;
    sendButton.disabled = false;
  }
});

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}
