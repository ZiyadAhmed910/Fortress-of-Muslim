import { els } from './dom.js';
import { CONFIGURABLE_TABS, getTabConfig, isTabVisible, parentTabOf, setTabEnabled, setTabVisibility } from './layout.js';
import { refreshLayoutVisibility } from './modes.js';

export function renderLayoutConfigList() {
  els.layoutConfigList.innerHTML = CONFIGURABLE_TABS.map(({ id, label, parent }) => `
    <div class="setting-row setting-row-stack layout-config-row${parent ? ' is-child' : ''}">
      <label class="layout-config-enable">
        <input type="checkbox" data-layout-enable="${id}">
        <strong>${label}</strong>
      </label>
      <select data-layout-visibility="${id}" aria-label="${label} visibility">
        <option value="both">Simple &amp; Advanced UI</option>
        <option value="simple">Simple UI only</option>
        <option value="advanced">Advanced UI only</option>
      </select>
    </div>
  `).join('');

  CONFIGURABLE_TABS.forEach(({ id }) => {
    const enableInput = els.layoutConfigList.querySelector(`[data-layout-enable="${id}"]`);
    const visibilitySelect = els.layoutConfigList.querySelector(`[data-layout-visibility="${id}"]`);
    enableInput.addEventListener('change', () => {
      setTabEnabled(id, enableInput.checked);
      refreshLayoutVisibility();
      // Ticking a child can switch its parent back on, and switching a parent off greys its
      // children -- either way the other rows have to catch up.
      syncLayoutConfigControls();
    });
    visibilitySelect.addEventListener('change', () => {
      setTabVisibility(id, visibilitySelect.value);
      refreshLayoutVisibility();
      syncLayoutConfigControls();
    });
  });
  syncLayoutConfigControls();
}

// Re-reads layout.js's config into the already-built Customize Layout rows without rebuilding
// them (which would drop their listeners) -- used at startup and after a backup import.
export function syncLayoutConfigControls() {
  CONFIGURABLE_TABS.forEach(({ id }) => {
    const config = getTabConfig(id);
    const enableInput = els.layoutConfigList.querySelector(`[data-layout-enable="${id}"]`);
    const visibilitySelect = els.layoutConfigList.querySelector(`[data-layout-visibility="${id}"]`);
    enableInput.checked = config.enabled;
    visibilitySelect.value = config.visibility;

    // A child of a switched-off parent keeps its own setting but cannot act on it, so its controls
    // are disabled rather than hidden: the state is still visible, and it returns untouched when
    // the parent comes back.
    const parent = parentTabOf(id);
    const blocked = Boolean(parent) && !getTabConfig(parent).enabled;
    const row = enableInput.closest('.layout-config-row');
    enableInput.disabled = blocked;
    visibilitySelect.disabled = blocked || !config.enabled;
    row.classList.toggle('is-blocked', blocked);
    row.title = blocked ? `Switch ${labelOf(parent)} on to use ${labelOf(id)}.` : '';
  });
  updateSettingsCategoryAvailability();
}

function labelOf(tabId) {
  return CONFIGURABLE_TABS.find((tab) => tab.id === tabId)?.label ?? tabId;
}

// A settings category for a disabled tab has nothing left to apply to, so it is removed from the
// list entirely rather than sitting there inert. Prayer & Qibla covers two tabs and only goes when
// both are off.
export function updateSettingsCategoryAvailability() {
  const setVisible = (key, visible) => {
    const button = els.settingsCategoryList.querySelector(`[data-settings-toggle="${key}"]`);
    if (!button) return;
    const group = button.closest('.settings-group');
    group.hidden = !visible;
    // Collapse on the way out so it cannot reappear already expanded.
    if (!visible) {
      button.setAttribute('aria-expanded', 'false');
      group.classList.remove('is-open');
      group.querySelector('.settings-panel').hidden = true;
    }
  };
  // The Prayer & Qibla settings category only applies to Prayer Times and Qibla, so it goes when
  // neither is reachable -- which now includes the case where their parent is switched off.
  setVisible('prayer', isTabVisible('prayerTimes') || isTabVisible('qibla'));
  setVisible('quran', getTabConfig('quran').enabled);
}
