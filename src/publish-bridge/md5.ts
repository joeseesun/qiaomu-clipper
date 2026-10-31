// MD5 of a byte buffer as lowercase hex. Zhihu identifies uploaded pictures by this hash; it is not used for anything security related.
const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0);

export function md5Hex(input: ArrayBuffer | Uint8Array): string {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
	const length = bytes.length;
	const padded = new Uint8Array(((length + 8) >> 6 << 6) + 64);
	padded.set(bytes);
	padded[length] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(padded.length - 8, (length << 3) >>> 0, true);
	view.setUint32(padded.length - 4, Math.floor(length / 0x20000000), true);
	let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
	for (let offset = 0; offset < padded.length; offset += 64) {
		const m = new Uint32Array(16);
		for (let i = 0; i < 16; i++) m[i] = view.getUint32(offset + i * 4, true);
		let a = a0, b = b0, c = c0, d = d0;
		for (let i = 0; i < 64; i++) {
			let f: number, g: number;
			if (i < 16) { f = (b & c) | (~b & d); g = i; }
			else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
			else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
			else { f = c ^ (b | ~d); g = (7 * i) % 16; }
			const next = d;
			d = c; c = b;
			const sum = (a + f + K[i] + m[g]) >>> 0;
			b = (b + ((sum << S[i]) | (sum >>> (32 - S[i])))) >>> 0;
			a = next;
		}
		a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
	}
	const out = new DataView(new ArrayBuffer(16));
	out.setUint32(0, a0, true); out.setUint32(4, b0, true); out.setUint32(8, c0, true); out.setUint32(12, d0, true);
	return Array.from(new Uint8Array(out.buffer), byte => byte.toString(16).padStart(2, '0')).join('');
}
