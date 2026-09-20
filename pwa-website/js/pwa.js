import { state } from './state.js';
import { els } from './dom.js';
import { isLocalPreview, toast } from './utils.js';

// Set once the banner has been turned down, so it is offered but never nagged.
const INSTALL_DISMISSED_KEY = 'fortress_install_dismissed';

export function setupInstallPrompt() {
  // Chrome fires this instead of showing its own banner, and only when it judges the app
  // installable and the visit engaged. If we do nothing with it, the browser shows nothing either,
  // which is why installing had quietly become invisible.
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    updateInstallAvailability();
  });

  window.addEventListener('appinstalled', () => {
    state.deferredInstallPrompt = null;
    dismissInstallBanner();
    updateInstallAvailability();
    toast('App installed.');
  });

  updateInstallAvailability();
}

export function dismissInstallBanner() {
  try { localStorage.setItem(INSTALL_DISMISSED_KEY, '1'); } catch { /* private mode: it just reappears */ }
  els.installBanner.classList.remove('visible');
}

function bannerDismissed() {
  try { return localStorage.getItem(INSTALL_DISMISSED_KEY) === '1'; } catch { return false; }
}

function isInstalled() {
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || window.navigator.standalone === true;
}

// iOS has no install prompt at all, and Android now hides installing behind the browser menu, so
// the row says where to look rather than leaving someone to hunt for it.
function installInstructions() {
  const agent = navigator.userAgent;
  const isApple = /iPad|iPhone|iPod/.test(agent)
    || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1);
  if (isApple) return 'In Safari, tap Share, then "Add to Home Screen".';
  if (/Android/.test(agent)) return 'In the browser menu, choose "Install app" or "Add to Home screen".';
  return 'Use the install icon in the address bar, or your browser menu.';
}

export async function promptInstall() {
  if (!state.deferredInstallPrompt) {
    toast('Use your browser install option.');
    return;
  }
  els.settingsDialog.close();
  els.installBanner.classList.remove('visible');
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
  const canPrompt = Boolean(state.deferredInstallPrompt);
  const installed = isInstalled();
  els.installButton.hidden = !canPrompt;
  els.installHint.textContent = installed
    ? 'Already installed on this device.'
    : canPrompt ? 'Add this app to your home screen.' : installInstructions();
  // One banner at a time, and never over the update one, which is the more urgent of the two.
  const offerBanner = canPrompt && !installed && !bannerDismissed()
    && !els.updateBanner.classList.contains('visible');
  els.installBanner.classList.toggle('visible', offerBanner);
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
      let lastUpdateCheck = 0;
      const checkForUpdate = () => {
        if (Date.now() - lastUpdateCheck < 60 * 60 * 1000) return;
        lastUpdateCheck = Date.now();
        registration.update().catch(() => {});
      };
      checkForUpdate();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
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
