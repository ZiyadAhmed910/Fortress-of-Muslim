import { els } from './dom.js';

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

export function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('visible'), 2100);
}

export function isLocalPreview() {
  return ['127.0.0.1', 'localhost'].includes(window.location.hostname);
}
