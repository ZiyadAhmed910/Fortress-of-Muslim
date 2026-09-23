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

/**
 * Whether this copy of the app belongs to the test environment, and so should talk to the test API
 * and the test media host. The test site itself, a local preview, and the Cloudflare preview address
 * of the test deployment (fortress-pwa-test.<account>.workers.dev). Anything else is production.
 */
export function isTestHost(hostname = window.location.hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1'
    || hostname.startsWith('test.') || hostname.startsWith('fortress-pwa-test.');
}

export function isLocalPreview() {
  return ['127.0.0.1', 'localhost'].includes(window.location.hostname);
}
