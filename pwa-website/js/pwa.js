import { state } from './state.js';
import { els } from './dom.js';
import { isLocalPreview, toast } from './utils.js';

export function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    state.deferredInstallPrompt = event;
    updateInstallAvailability();
  });

  window.addEventListener('appinstalled', () => {
    state.deferredInstallPrompt = null;
    updateInstallAvailability();
    toast('App installed.');
  });
}

export async function promptInstall() {
  if (!state.deferredInstallPrompt) {
    toast('Use your browser install option.');
    return;
  }
  els.settingsDialog.close();
  const promptResult = state.deferredInstallPrompt.prompt();
  if (promptResult && typeof promptResult.catch === 'function') {
    await promptResult.catch(() => null);
  }
  const choice = await state.deferredInstallPrompt.userChoice.catch(() => null);
  state.deferredInstallPrompt = null;
  updateInstallAvailability();
  if (choice?.outcome === 'accepted') toast('Installing app...');
}

export function updateInstallAvailability() {
  els.installRow.classList.toggle('available', Boolean(state.deferredInstallPrompt));
}

export function setupServiceWorker() {
  if ('serviceWorker' in navigator && isLocalPreview()) {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => registrations.forEach((registration) => registration.unregister()))
      .catch(() => {});
    if ('caches' in window) {
      caches.keys()
        .then((keys) => keys.forEach((key) => caches.delete(key)))
        .catch(() => {});
    }
    return;
  }

  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('sw.js')
    .then((registration) => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        showUpdateBanner(registration.waiting);
      }

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner(newWorker);
          }
        });
      });
    })
    .catch(() => {});

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (state.refreshing) return;
    state.refreshing = true;
    window.location.reload();
  });
}

export function showUpdateBanner(worker) {
  state.waitingWorker = worker;
  els.updateBanner.classList.add('visible');
}

export function applyWaitingUpdate() {
  if (!state.waitingWorker) {
    window.location.reload();
    return;
  }
  state.waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}
