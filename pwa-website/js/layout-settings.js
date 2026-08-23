import { els } from './dom.js';
import { CONFIGURABLE_TABS, getTabConfig, setTabEnabled, setTabVisibility } from './layout.js';
import { refreshLayoutVisibility } from './modes.js';

export function renderLayoutConfigList() {
  els.layoutConfigList.innerHTML = CONFIGURABLE_TABS.map(({ id, label }) => `
    <div class="setting-row setting-row-stack layout-config-row">
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
      updateSettingsCategoryAvailability();
    });
    visibilitySelect.addEventListener('change', () => {
      setTabVisibility(id, visibilitySelect.value);
      refreshLayoutVisibility();
    });
  });
  syncLayoutConfigControls();
}

// Re-reads layout.js's config into the already-built Customize Layout rows without rebuilding
// them (which would drop their listeners) -- used at startup and after a backup import.
export function syncLayoutConfigControls() {
  CONFIGURABLE_TABS.forEach(({ id }) => {
    const config = getTabConfig(id);
    els.layoutConfigList.querySelector(`[data-layout-enable="${id}"]`).checked = config.enabled;
    els.layoutConfigList.querySelector(`[data-layout-visibility="${id}"]`).value = config.visibility;
  });
  updateSettingsCategoryAvailability();
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
  setVisible('prayer', getTabConfig('prayerTimes').enabled || getTabConfig('qibla').enabled);
  setVisible('quran', getTabConfig('quran').enabled);
}
