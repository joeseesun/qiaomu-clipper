import type { Editor } from '@tiptap/core';

// What the editor needs from the page around it (file pickers, the AI helper, storage of pictures).
// A built-in action id, a saved custom action's id, "continue" or "custom" (asks for an instruction).
export type AiAction = string;

export interface EditorHost {
	pickImages(): void;
	insertImageFiles(editor: Editor, files: File[], at?: number): Promise<void>;
	// Pictures that still point at the web are saved into the local store.
	localizeImages(editor: Editor, quiet?: boolean): Promise<void>;
	aiReady(): boolean;
	// Opens the picture-making window and puts the chosen picture at the cursor.
	aiImage(editor: Editor): void;
	runAi(editor: Editor, action: AiAction): void;
}
