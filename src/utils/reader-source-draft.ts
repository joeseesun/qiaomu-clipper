import { ClipPreview, updateClipPreview } from './clip-preview';
import { generalSettings, loadSettings } from './storage-utils';
import browser from './browser-polyfill';
import { loadTemplates } from '../managers/template-manager';
import { compileTemplate } from './template-compiler';
import { initializePageContent } from './content-extractor';
import { generateFrontmatter } from './obsidian-note-creator';
import { sanitizeFileName } from './string-utils';
import { findMatchingTemplate, initializeTriggers } from './triggers';

export async function createReaderSourceDraft(url: string, initialTitle: string) {
	await loadSettings();
	const templates = await loadTemplates();
	const template = templates.find(item => item.id === generalSettings.defaultTemplateId) || templates[0];
	const saved = await browser.storage.local.get(['lastSelectedVault','qiaomuRssEnabled','qiaomuNativeConfigured']) as {lastSelectedVault?:string; qiaomuRssEnabled?:boolean; qiaomuNativeConfigured?:boolean};
	const title = initialTitle.replace(/\s*- YouTube$/, '') || 'YouTube 视频学习';
	const draft: ClipPreview = {
		createdAt:Date.now(), aggregate:saved.qiaomuRssEnabled === true, native:saved.qiaomuNativeConfigured === true,
		clip:{url,title,markdown:''}, properties:[],
		local:{requestId:crypto.randomUUID(), content:'', name:`${sanitizeFileName(title)}.md`, folder:template.path, vault:template.vault || saved.lastSelectedVault || generalSettings.vaults[0] || '', behavior:template.behavior},
	};
	return {draft, async populate(result: any) {
		initializeTriggers(templates);
		const selected = await findMatchingTemplate(url, async () => result.schemaOrgData) || template;
		const initialized = await initializePageContent(result.content || '', '', result.variables || {}, url, result.schemaOrgData || {}, result.content || '', [], result.title || title, result.author || '', result.description || '', result.favicon || '', result.image || '', result.published || '', result.site || '', result.wordCount || 0, result.language || '', result.metaTags || []);
		const tabId = (await browser.tabs.getCurrent())?.id || 0;
		const compile = (text: string) => compileTemplate(tabId,text,initialized.currentVariables,url);
		const [name, folder, markdown, properties] = await Promise.all([
			compile(selected.noteNameFormat), compile(selected.path), compile(selected.noteContentFormat),
			Promise.all(selected.properties.map(async property => ({...property,value:await compile(property.value)}))),
		]);
		draft.properties = properties;
		draft.clip = {url,title:name.trim() || result.title || title,markdown,image:result.image};
		Object.assign(draft.local,{name:`${sanitizeFileName(name.trim() || draft.clip.title)}.md`, folder, vault:selected.vault || saved.lastSelectedVault || generalSettings.vaults[0] || '', behavior:selected.behavior, content:await generateFrontmatter(properties)+markdown});
		try { const status = await browser.runtime.sendMessage({action:'qiaomuLocalStatus'}) as {ok?:boolean}; draft.native = Boolean(status?.ok || saved.qiaomuNativeConfigured); } catch { /* Preserve the configured save transport. */ }
		await updateClipPreview(draft);
	}};
}
