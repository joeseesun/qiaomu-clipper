// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { sanitizeChatSvg } from './chat-svg';

it('keeps SVG chart geometry, text and safe local styles and adds intrinsic dimensions from viewBox', () => {
 const chart=sanitizeChatSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400"><style>.line{stroke:red}</style><path class="line" d="M0 400L800 0"/><text x="10" y="20">Star History</text></svg>');
 expect(chart).toContain('width="800"');expect(chart).toContain('height="400"');expect(chart).toContain('Star History');expect(chart).toContain('stroke:red');
});

it('removes active content, embedded images and external references before decoding a chart', () => {
 const chart=sanitizeChatSvg('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" onload="alert(1)"><script>alert(1)</script><foreignObject><iframe src="https://evil.test"></iframe></foreignObject><image href="https://evil.test/a"/><use href="https://evil.test/b.svg#x"/><style>@import "https://evil.test/c";</style><path fill="url(https://evil.test/d)"/><text style="fill:red">Safe chart</text></svg>');
 expect(chart).not.toMatch(/evil|script|iframe|onload|foreignObject|<image/i);expect(chart).toContain('Safe chart');
});

it.each(['<html>login</html>','<!DOCTYPE svg><svg/>','<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="10000"/>'])('rejects invalid or excessively large SVG: %s', svg=>{expect(()=>sanitizeChatSvg(svg)).toThrow();});
