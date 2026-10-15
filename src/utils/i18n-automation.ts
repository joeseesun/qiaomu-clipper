import fs from 'fs';
import path from 'path';

interface Message {
	message: string;
	placeholders?: {
		[key: string]: {
			content: string;
		};
	};
}

interface Messages {
	[key: string]: Message;
}

export default class I18nAutomation {
	private sourceLocale = 'en';
	private localesDir: string;
	private apiKey?: string;
	private chatHistories: { [locale: string]: { role: string, content: string }[] } = {};
	private lastRequestTime = 0;
	private requestInterval = 2000; // 2 seconds between requests
	private maxRetries = 3;
	private batchSize = 20;

	constructor(localesDir: string, openaiApiKey?: string) {
		this.localesDir = localesDir;
		this.apiKey = openaiApiKey;
	}

	private initializeChatHistory(targetLanguage: string) {
		this.chatHistories[targetLanguage] = [{
			role: "system",
			content: `You are a professional translator for the Obsidian Web Clipper browser extension.

About the extension:
- It's a browser extension that helps users save web content to their Obsidian vault
- Users can clip entire articles, selected text, or highlights
- It includes features for customizing templates, managing settings, and organizing clips
- The interface needs to be clear and concise

Translation guidelines:
- Translate from English to ${targetLanguage}
- Preserve any placeholders like $1, $2, {{variable}}, etc.
- Maintain consistent terminology throughout the extension
- Keep UI text concise and clear
- Match the tone of the original text (error messages should sound like errors, etc.)
- Consider the context of each string (button labels, error messages, descriptions, etc.)

Response format:
Always respond with a valid JSON object in this exact format:
{"key1":"translation1","key2":"translation2"}

Example input:
save: (button) "Save to vault"
error: (error message) "Failed to connect"

Example response:
{"save":"Sauvegarder dans le coffre","error":"Échec de la connexion"}`
		}];
	}

	private async sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	private async makeRequestWithRetry(messages: { role: string, content: string }[]): Promise<string> {
		for (let attempt = 0; ; attempt++) {
			const remaining = this.requestInterval - (Date.now() - this.lastRequestTime);
			if (remaining > 0) await this.sleep(remaining);
			let retryable = true;
			try {
				this.lastRequestTime = Date.now();
				const response = await fetch('https://api.openai.com/v1/chat/completions', {
					method: 'POST', signal: AbortSignal.timeout(30000),
					headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
					body: JSON.stringify({ model: 'gpt-5.2', messages }),
				});
				if (!response.ok) {
					retryable = response.status === 429 || response.status >= 500;
					throw new Error(`Translation API failed: HTTP ${response.status}`);
				}
				const data = await response.json();
				const content = data.choices?.[0]?.message?.content;
				if (typeof content !== 'string' || !content.trim()) { retryable = false; throw new Error('Empty translation response'); }
				return content;
			} catch (error) {
				if (!retryable || attempt >= this.maxRetries) throw error;
				await this.sleep(this.requestInterval * Math.pow(2, attempt));
			}
		}
	}

	private async translateBatch(
		messages: { key: string; message: string }[],
		targetLanguage: string
	): Promise<{ [key: string]: string }> {
		if (!this.chatHistories[targetLanguage]) {
			this.initializeChatHistory(targetLanguage);
		}

		// Format the batch request
		const batchPrompt = messages.map(({ key, message }) => {
			const context = this.getMessageContext(key);
			return `${key}: (${context}) "${message}"`;
		}).join('\n\n');

		console.log(`\n  🤖 Translating batch of ${messages.length} messages to ${targetLanguage}`);
		messages.forEach(({ key, message }) => {
			console.log(`    - ${key}: "${message.substring(0, 40)}${message.length > 40 ? '...' : ''}"`);
		});

		// Add batch to chat history
		this.chatHistories[targetLanguage].push({
			role: "user",
			content: `Translate these messages to ${targetLanguage}. Respond with a valid JSON object where keys match the input keys and values are the translations. Format the response as a single line without pretty-printing:\n\n${batchPrompt}`
		});

		try {
			const response = await this.makeRequestWithRetry(this.chatHistories[targetLanguage]);
			
			// Clean and parse the JSON response
			let translations: { [key: string]: string };
			try {
				const cleanJson = response.replace(/```json\n?|\n?```/g, '').trim();
				translations = JSON.parse(cleanJson);

				const missingKeys = messages.filter(({ key }) => !translations[key]);
				if (missingKeys.length > 0) {
					throw new Error(`Missing translations for keys: ${missingKeys.map(m => m.key).join(', ')}`);
				}
			} catch (error) {
				console.error(`\n  ❌ Failed to parse response as JSON:`, response);
				console.error(`  Error details:`, error);
				throw new Error('Invalid response format');
			}

			// Add response to chat history
			this.chatHistories[targetLanguage].push({
				role: "assistant",
				content: JSON.stringify(translations)
			});

			// Log translations
			console.log(`\n  ➡️  Received translations for ${targetLanguage}`);
			Object.entries(translations).forEach(([key, translation]) => {
				console.log(`    - ${key}: "${translation.substring(0, 40)}${translation.length > 40 ? '...' : ''}"`);
			});

			return translations;
		} catch (error) {
			console.error(`\n  ❌ Batch translation failed:`, error);
			throw error;
		}
	}

	private getMessageContext(key: string): string {
		if (key.includes('error')) return 'error message';
		if (key.includes('button')) return 'button label';
		if (key.includes('title')) return 'title';
		if (key.includes('description')) return 'description';
		if (key.includes('tooltip')) return 'tooltip';
		if (key.includes('placeholder')) return 'input placeholder';
		return 'UI text';
	}

	// Sort messages alphabetically by key
	private sortMessages(messages: Messages): Messages {
		return Object.keys(messages)
			.sort()
			.reduce((acc: Messages, key) => {
				acc[key] = messages[key];
				return acc;
			}, {});
	}

	// Process all locales
	async processLocales(srcDir: string, targetLocale?: string): Promise<void> {
		console.log('\n🌍 Starting localization process...');
		
		// Read source (English) messages
		console.log(`📖 Reading source messages from ${this.sourceLocale}...`);
		const sourceFile = path.join(this.localesDir, this.sourceLocale, 'messages.json');
		const sourceMessages: Messages = JSON.parse(await fs.promises.readFile(sourceFile, 'utf-8'));
		console.log(`✓ Found ${Object.keys(sourceMessages).length} source messages`);

		const sortedSourceMessages = this.sortMessages(sourceMessages);

		// Get list of locales to process
		const locales = await fs.promises.readdir(this.localesDir);
		const localesToProcess = targetLocale 
			? [targetLocale]
			: locales.filter(locale => !locale.startsWith('.') && locale !== this.sourceLocale);

		console.log(`\n🎯 Processing ${localesToProcess.length} locale(s): ${localesToProcess.join(', ')}`);

		// Process selected locales
		for (const locale of localesToProcess) {
			console.log(`\n📝 Processing ${locale}...`);
			
			if (!locales.includes(locale)) {
				console.log(`  Creating new locale directory: ${locale}`);
				await fs.promises.mkdir(path.join(this.localesDir, locale), { recursive: true });
			}

			const localeFile = path.join(this.localesDir, locale, 'messages.json');
			let localeMessages: Messages = {};

			try {
				localeMessages = JSON.parse(await fs.promises.readFile(localeFile, 'utf-8'));
				console.log(`  📂 Found existing translations for ${locale}`);
			} catch (error) {
				console.log(`  ⚠️  No existing translations found for ${locale}, creating new file`);
			}

			// Find missing translations
			const missingKeys = Object.keys(sortedSourceMessages).filter(key => sortedSourceMessages[key].message.trim() && !localeMessages[key]?.message?.trim());
			if (missingKeys.length > 0) {
				console.log(`  🔍 Found ${missingKeys.length} missing translations`);
				
				// Process messages in batches
				for (let i = 0; i < missingKeys.length; i += this.batchSize) {
					const batch = missingKeys.slice(i, i + this.batchSize).map(key => ({
						key,
						message: sortedSourceMessages[key].message
					}));

					if (!this.apiKey) throw new Error('OPENAI_API_KEY is required to generate missing translations.');
					const translations = await this.translateBatch(batch, locale);
					const holes = (text: string) => (text.match(/\{\{[a-z_][a-z0-9_]*\}\}|\{(?:\d+|[a-z_][a-z0-9_]*)\}|\$\d+|\$[a-z_][a-z0-9_]*\$/gi) || []).sort();
					for (const { key, message } of batch) {
						const translation = translations[key];
						if (typeof translation !== 'string' || !translation.trim()) throw new Error(`Missing translation: ${locale}/${key}`);
						if (JSON.stringify(holes(translation)) !== JSON.stringify(holes(message))) throw new Error(`Changed placeholder: ${locale}/${key}`);
						localeMessages[key] = { ...sortedSourceMessages[key], message: translation };
					}

				}
			} else {
				console.log(`  ✓ All messages are already translated`);
			}

			// Remove messages that don't exist in English
			const obsoleteKeys = Object.keys(localeMessages).filter(key => !sortedSourceMessages[key]);
			if (obsoleteKeys.length > 0) {
				console.log(`\n  🧹 Removing ${obsoleteKeys.length} obsolete messages`);
				for (const key of obsoleteKeys) {
					delete localeMessages[key];
				}
			}

			// Sort and save locale messages
			const sortedLocaleMessages = this.sortMessages(localeMessages);
			await fs.promises.writeFile(
				localeFile,
				JSON.stringify(sortedLocaleMessages, null, '\t')
			);
			console.log(`  💾 Saved translations for ${locale}`);
		}

		console.log('\n✨ Localization process completed successfully!\n');
	}
} 