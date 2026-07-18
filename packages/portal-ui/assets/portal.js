const root = document.documentElement;
const storedTheme = localStorage.getItem('fortress-portal-theme');
if (storedTheme) root.dataset.theme = storedTheme;

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const current = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      root.dataset.theme = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem('fortress-portal-theme', root.dataset.theme);
    });
  });

  document.querySelectorAll('[data-nav-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const open = document.body.classList.toggle('nav-open');
      button.setAttribute('aria-expanded', String(open));
    });
  });

  document.querySelectorAll('[data-nav-close], .nav-scrim').forEach((element) => {
    element.addEventListener('click', () => document.body.classList.remove('nav-open'));
  });

  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = document.querySelector(button.dataset.copy);
      if (!target) return;
      await navigator.clipboard.writeText(target.textContent.trim());
      const previous = button.getAttribute('aria-label');
      button.classList.add('copied');
      button.setAttribute('aria-label', 'Copied');
      setTimeout(() => {
        button.classList.remove('copied');
        button.setAttribute('aria-label', previous || 'Copy');
      }, 1400);
    });
  });

  document.querySelectorAll('[data-year]').forEach((node) => { node.textContent = new Date().getFullYear(); });
});
