export const VERSION: string;
export function isComposeRoute(location: Location): boolean;
export function findEditor(doc: Document, location: Location): HTMLElement | null;
export function inspect(doc: Document, location: Location): { version: string; route: boolean; editorCount: number; selector: string | null; compatible: boolean; reason: string };
