// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createModelPicker, matchesModel, shortModelName } from './model-picker';
import type { ModelConfig, Provider } from '../types/types';

vi.mock('./i18n', () => ({ getMessage: (key: string) => key }));

const providers: Provider[] = [
	{ id: 'p1', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1/chat/completions', apiKey: 'k', presetId: 'deepseek' },
	{ id: 'p2', name: 'ChatGPT', baseUrl: 'https://api.openai.com/v1/responses', apiKey: '', oauth: { kind: 'chatgpt', clientId: 'c', access: 'a', refresh: 'r', expires: 0 } }
];
const models: ModelConfig[] = [
	{ id: 'm1', providerId: 'p1', providerModelId: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', enabled: true },
	{ id: 'm2', providerId: 'p1', providerModelId: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', enabled: true },
	{ id: 'm3', providerId: 'p2', providerModelId: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', enabled: true }
];
const key = (target: Element, name: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

function mount() {
	const onSelect = vi.fn(), onManage = vi.fn();
	const picker = createModelPicker({ getModels: () => models, getProviders: () => providers, onSelect, onManage });
	document.body.append(picker.trigger, picker.popover);
	picker.setModels('m1');
	return { picker, onSelect, onManage, search: picker.popover.querySelector('input')!, rows: () => Array.from(picker.popover.querySelectorAll<HTMLElement>('[role=option]')) };
}

describe('model picker', () => {
	beforeEach(() => { document.body.innerHTML = ''; });

	it('shows the current model on the trigger and stays closed until asked', () => {
		const { picker } = mount();
		expect(picker.trigger.textContent).toContain('DeepSeek V4 Flash');
		expect(picker.popover.hidden).toBe(true);
		expect(picker.trigger.getAttribute('aria-expanded')).toBe('false');
	});

	it('groups models by provider, marks the current one and the signed-in plan', () => {
		const { picker, rows } = mount();
		picker.trigger.click();
		expect(picker.trigger.getAttribute('aria-expanded')).toBe('true');
		expect(rows().map(r => r.textContent)).toEqual(['DeepSeek V4 Flash', 'DeepSeek V4 Pro', 'GPT-5.6 Sol']);
		const current = rows()[0];
		expect(current.getAttribute('aria-selected')).toBe('true');
		expect(current.querySelector('svg')).not.toBeNull();
		expect(rows()[1].querySelector('svg')).toBeNull();
		expect(picker.popover.querySelectorAll('.clip-chat-picker-group').length).toBe(2);
		expect(picker.popover.querySelector('.clip-chat-picker-note')?.textContent).toBe('qiaomuModelPlan');
	});

	it('filters by name, id or provider and says so when nothing matches', () => {
		const { picker, search, rows } = mount();
		picker.open();
		search.value = 'sol'; search.dispatchEvent(new Event('input'));
		expect(rows().map(r => r.textContent)).toEqual(['GPT-5.6 Sol']);
		search.value = 'deepseek pro'; search.dispatchEvent(new Event('input'));
		expect(rows().map(r => r.textContent)).toEqual(['DeepSeek V4 Pro']);
		search.value = 'zzz'; search.dispatchEvent(new Event('input'));
		expect(rows().length).toBe(0);
		expect(picker.popover.querySelector('.clip-chat-picker-empty')).not.toBeNull();
		expect(matchesModel('chatgpt', models[2], providers[1])).toBe(true);
	});

	it('picks with the keyboard: arrows move, Enter selects, the trigger follows', () => {
		const { picker, onSelect, search } = mount();
		picker.open();
		key(search, 'ArrowDown');
		expect(search.getAttribute('aria-activedescendant')).toBe(picker.popover.querySelectorAll('[role=option]')[1].id);
		key(search, 'Enter');
		expect(onSelect).toHaveBeenCalledWith('m2');
		expect(picker.value).toBe('m2');
		expect(picker.trigger.textContent).toContain('DeepSeek V4 Pro');
		expect(picker.isOpen()).toBe(false);
	});

	it('does not report a pick of the model that is already current', () => {
		const { picker, onSelect, rows } = mount();
		picker.open();
		rows()[0].click();
		expect(onSelect).not.toHaveBeenCalled();
		expect(picker.isOpen()).toBe(false);
	});

	it('closes on Escape without letting the panel hear it, and on a press outside', () => {
		const { picker, search } = mount();
		const heard = vi.fn();
		document.body.addEventListener('keydown', heard);
		picker.open();
		key(search, 'Escape');
		expect(picker.isOpen()).toBe(false);
		expect(heard).not.toHaveBeenCalled();
		picker.open();
		document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		expect(picker.isOpen()).toBe(false);
	});

	it('leads to adding a provider and hides itself when there are no models', () => {
		const { picker, onManage } = mount();
		picker.open();
		picker.popover.querySelector<HTMLButtonElement>('.clip-chat-picker-manage')!.click();
		expect(onManage).toHaveBeenCalledOnce();
		expect(picker.isOpen()).toBe(false);
		const empty = createModelPicker({ getModels: () => [], getProviders: () => providers, onSelect: vi.fn(), onManage: vi.fn() });
		empty.setModels('');
		expect(empty.trigger.hidden).toBe(true);
	});

	it('drops a gateway\'s "Vendor: " prefix from the shown name but keeps the full name as a tooltip', () => {
		expect(shortModelName('Apodex: Apodex 1.1 Flash')).toBe('Apodex 1.1 Flash');
		expect(shortModelName('Google：Gemini 2.5 Pro')).toBe('Gemini 2.5 Pro');
		expect(shortModelName('GPT-5.6 Sol')).toBe('GPT-5.6 Sol');
		expect(shortModelName('Re: something: else')).toBe('something: else');
		const long: ModelConfig[] = [{ id: 'x', providerId: 'p1', providerModelId: 'apodex/apodex-1.1', name: 'Apodex: Apodex 1.1', enabled: true }];
		const picker = createModelPicker({ getModels: () => long, getProviders: () => providers, onSelect: vi.fn(), onManage: vi.fn() });
		picker.setModels('x');
		expect(picker.trigger.textContent).toBe('Apodex 1.1');
		expect(picker.trigger.title).toBe('Apodex: Apodex 1.1');
	});
});
