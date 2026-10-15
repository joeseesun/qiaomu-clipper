import browser from './browser-polyfill';
import { t } from './ui-text';

export interface BuildIdentity {
	version: string;
	target: string;
	mode: string;
	commit: string;
	sourceHash: string;
	dirty: boolean;
	testInstall?: boolean;
}

export function buildIdentityLabel(info: BuildIdentity): string {
	const edition = info.target === 'chrome-local' ? t('独立版') : info.target === 'chrome-store' ? t('商店版') : info.target;
	const stage = info.testInstall ? t('测试版') : info.mode === 'development' ? t('开发版') : t('生产构建');
	return `${edition} · ${stage} · ${info.commit.slice(0, 7)} / ${info.sourceHash.slice(0, 8)}${info.dirty ? ` · ${t('含未提交修改')}` : ''}`;
}

export async function displayBuildIdentity(version: HTMLElement): Promise<boolean> {
	try {
		const response = await fetch(browser.runtime.getURL('build-info.json'));
		if (!response.ok) return false;
		const info: BuildIdentity = await response.json();
		const label = document.getElementById('build-identity') || document.createElement('span');
		label.id = 'build-identity';
		label.className = 'about-status';
		label.textContent = buildIdentityLabel(info);
		version.insertAdjacentElement('afterend', label);
		return Boolean(info.testInstall || info.mode === 'development');
	} catch { return false; } // Old/manual packages can lack build metadata.
}
