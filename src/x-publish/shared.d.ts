// The engine is plain JavaScript adapted from xPoster; these are the parts the writer uses.
export interface Segment { type: 'text' | 'image' | 'video' | 'table' | 'tweet' | 'code' | 'divider'; source?: string; alt?: string; [key: string]: any }
export interface ParsedArticle { title: string | null; cover: string | null; segments: Segment[]; meta: Record<string, string> }
export const ARTICLE_MEDIA_POLICY: { limit: number; warningAt: number };
export function parseMarkdown(markdown: string, options?: Record<string, unknown>): ParsedArticle;
export function articleMediaEstimate(parsed: ParsedArticle, options?: Record<string, unknown>): { bodyImages: number; tables: number; coverOnly: number; total: number; nearSoftLimit: boolean; overSoftLimit: boolean };
export function segmentCounts(segments: Segment[]): Record<string, number>;
export function applyLimits(segments: Segment[], limits: unknown): { segments: Segment[]; dropped: unknown };
export function buildPastePlan(segments: Segment[], images: Map<Segment, any>, tables: Map<Segment, any>, options: Record<string, unknown>): any;
export function imageSourcesMatch(a: string, b: string): boolean;
export function isLocalImageSource(source: string): boolean;
export function isRemoteHttpImageSource(source: string): boolean;
export function guessFileName(source: string, fallback?: string): string;
export function extensionMime(fileName: string, fallback?: string): string;
export function isSupportedImageMime(mime: string): boolean;
export function isSupportedMediaMime(mime: string): boolean;
export function parseDataUri(uri: string, options?: Record<string, unknown>): { ok: boolean; base64?: string; mime?: string; bytes?: number; error?: string };
export function arrayBufferToBase64(buffer: ArrayBuffer): string;
export function renderTableImage(table: Segment, fileName?: string): Promise<{ ok: boolean; base64?: string; mime?: string; fileName?: string; bytes?: number; error?: string }>;
export function escapeHtml(value: unknown): string;
