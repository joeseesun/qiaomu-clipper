import DOMPurify from 'dompurify';

// Models receive raster pixels, never SVG markup. Keep charts inert and
// self-contained before loading them in an image element (not in the page DOM).
export function sanitizeChatSvg(source: string): string {
	if (source.length > 12 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('invalid-svg');
	const clean = DOMPurify.sanitize(source, {
		USE_PROFILES: { svg: true, svgFilters: true },
		FORBID_TAGS: ['script', 'foreignObject', 'image', 'feImage', 'a', 'animate', 'animateMotion', 'animateTransform', 'set'],
	});
	const doc = new DOMParser().parseFromString(clean, 'image/svg+xml'), svg = doc.documentElement;
	if (svg.localName !== 'svg' || svg.namespaceURI !== 'http://www.w3.org/2000/svg' || doc.querySelector('parsererror')) throw new Error('invalid-svg');
	const externalCss = (value: string) => /@import|expression\s*\(/i.test(value) || Array.from(value.matchAll(/url\s*\(([^)]*)\)/gi)).some(match => !/^['"]?#[\w.:-]+['"]?$/.test(match[1].trim()));
	for (const node of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
		if (node.localName === 'style' && externalCss(node.textContent || '')) { node.remove(); continue; }
		for (const attr of Array.from(node.attributes)) {
			if (attr.localName.startsWith('on') || (['href', 'src'].includes(attr.localName) && !/^#[\w.:-]+$/.test(attr.value)) || externalCss(attr.value)) node.removeAttributeNode(attr);
		}
	}
	const box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
	const viewBox = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0 ? box : undefined;
	const dimension = (name: string) => { const value = svg.getAttribute(name) || ''; return /^\d+(?:\.\d+)?(?:px)?$/.test(value) ? parseFloat(value) : undefined; };
	const width = dimension('width') || viewBox?.[2], height = dimension('height') || viewBox?.[3];
	if (!width || !height || width * height > 40_000_000) throw new Error('invalid-svg-size');
	svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
	return new XMLSerializer().serializeToString(svg);
}

export async function decodeChatSvg(blob: Blob, signal: AbortSignal): Promise<{ source: HTMLImageElement; width: number; height: number; close: () => void }> {
	const source = sanitizeChatSvg(await blob.text());
	if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
	const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
	try {
		const image = await new Promise<HTMLImageElement>((resolve, reject) => {
			const img = new Image();
			const finish = (error?: Error) => { clearTimeout(timer); signal.removeEventListener('abort', cancel); img.onload = img.onerror = null; if (error) { img.src = ''; reject(error); } else resolve(img); };
			const cancel = () => finish(new DOMException('Aborted', 'AbortError'));
			const timer = setTimeout(() => finish(new Error('svg-decode-timeout')), 15000);
			signal.addEventListener('abort', cancel, { once: true });
			img.onload = () => finish(); img.onerror = () => finish(new Error('svg-decode-failed')); img.src = url;
		});
		return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
	} catch (error) { URL.revokeObjectURL(url); throw error; }
}
