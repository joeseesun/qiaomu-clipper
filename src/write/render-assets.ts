// Pictures made from the article's own diagrams and formulas, for places that cannot show them natively (X articles, later WeChat).
import { mermaidToSvg } from './editor/code-block';

let mathJax: Promise<{ adaptor: { outerHTML(node: unknown): string }; html: { convert(latex: string, options: { display: boolean }): unknown } }> | undefined;

async function mathDocument() {
	mathJax ??= Promise.all([
		import('mathjax-full/js/mathjax.js'), import('mathjax-full/js/input/tex.js'), import('mathjax-full/js/output/svg.js'),
		import('mathjax-full/js/adaptors/liteAdaptor.js'), import('mathjax-full/js/handlers/html.js'), import('mathjax-full/js/input/tex/AllPackages.js'),
	]).then(([core, texModule, svgModule, adaptorModule, htmlModule, packages]) => {
		const adaptor = adaptorModule.liteAdaptor();
		htmlModule.RegisterHTMLHandler(adaptor);
		const html = core.mathjax.document('', { InputJax: new texModule.TeX({ packages: packages.AllPackages }), OutputJax: new svgModule.SVG({ fontCache: 'none' }) });
		return { adaptor: adaptor as never, html: html as never };
	});
	return mathJax;
}

export async function latexToSvg(latex: string, display: boolean): Promise<string> {
	const { adaptor, html } = await mathDocument();
	const markup = adaptor.outerHTML(html.convert(latex.trim(), { display }));
	const start = markup.indexOf('<svg'); const end = markup.lastIndexOf('</svg>');
	if (start < 0 || end < start) throw new Error('formula could not be drawn');
	return markup.slice(start, end + 6);
}

function readAttr(tag: string, name: string): string { return new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag)?.[1] ?? ''; }

// Pixel size of an SVG: explicit px, MathJax's ex units (about 9px at 18px text), or the viewBox.
export function svgSize(svg: string): { width: number; height: number } {
	const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
	const dim = (value: string) => { const n = parseFloat(value); if (!Number.isFinite(n)) return 0; return /ex$/.test(value) ? n * 9 : /%$/.test(value) ? 0 : n; };
	let width = dim(readAttr(tag, 'width')); let height = dim(readAttr(tag, 'height'));
	const box = readAttr(tag, 'viewBox').split(/[\s,]+/).map(Number);
	if ((!width || !height) && box.length === 4 && box[2] > 0 && box[3] > 0) { width = width || box[2]; height = height || (width * box[3]) / box[2]; }
	return { width: Math.max(1, Math.round(width || 600)), height: Math.max(1, Math.round(height || 300)) };
}

export async function svgToPng(svg: string, options: { scale?: number; background?: string; padding?: number; maxWidth?: number } = {}): Promise<Blob> {
	const { width, height } = svgSize(svg);
	const padding = options.padding ?? 12;
	const maxWidth = options.maxWidth ?? 1600;
	const fit = Math.min(1, maxWidth / width);
	const scale = options.scale ?? 2;
	const w = Math.round(width * fit); const h = Math.round(height * fit);
	const sized = svg.replace(/<svg\b([^>]*)>/i, (_tag, attrs: string) => `<svg${attrs.replace(/\s(?:width|height)="[^"]*"/gi, '')} width="${w}" height="${h}" color="#000">`);
	const url = URL.createObjectURL(new Blob([sized.includes('xmlns=') ? sized : sized.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')], { type: 'image/svg+xml;charset=utf-8' }));
	try {
		const image = new Image();
		await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('picture could not be drawn')); image.src = url; });
		const canvas = document.createElement('canvas');
		canvas.width = Math.round((w + padding * 2) * scale); canvas.height = Math.round((h + padding * 2) * scale);
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = options.background ?? '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(image, padding * scale, padding * scale, w * scale, h * scale);
		return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('picture could not be saved'))), 'image/png'));
	} finally { URL.revokeObjectURL(url); }
}

export async function mermaidToPng(source: string): Promise<Blob> { return svgToPng(await mermaidToSvg(source, 'neutral'), { scale: 2, padding: 16 }); }
export async function latexToPng(latex: string, display: boolean): Promise<Blob> { return svgToPng(await latexToSvg(latex, display), { scale: 3, padding: display ? 14 : 4, maxWidth: 1200 }); }
