export type SettingsSaveState = 'saving' | 'saved' | 'error';

export function dispatchSettingsSaveState(state: SettingsSaveState): void {
	if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') return;
	document.dispatchEvent(new CustomEvent<SettingsSaveState>('qiaomu-settings-save-state', { detail: state }));
}
