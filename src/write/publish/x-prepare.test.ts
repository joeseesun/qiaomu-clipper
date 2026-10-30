import { expect, it } from 'vitest';
import { LOCAL_IMAGE_HOST, localImageId, prepareForX } from './x-prepare';
import * as shared from '../../x-publish/shared';

const article = (markdown: string, extra = {}) => ({ title: '测试文章', markdown, coverImageId: '', ...extra });

it('gives local pictures an address and carries the title and cover as front matter', () => {
	const out = prepareForX(article('![a](qm-image://img_1)\n\n正文', { coverImageId: 'img_9' }));
	expect(out.markdown).toContain(`![a](${LOCAL_IMAGE_HOST}img_1)`);
	expect(out.markdown).toMatch(/^---\ntitle: "测试文章"\ncover: "https:\/\/qm-image\.local\/img_9"\n---/);
	expect(localImageId(`${LOCAL_IMAGE_HOST}img_1`)).toBe('img_1');
	const parsed = shared.parseMarkdown(out.markdown, { setTitle: true, setCover: true });
	expect(parsed.title).toBe('测试文章');
	expect(parsed.cover).toBe(`${LOCAL_IMAGE_HOST}img_9`);
	expect(parsed.segments.filter(s => s.type === 'image').length).toBe(1);
});

it('turns diagrams and display formulas into pictures and inline formulas into code', () => {
	const out = prepareForX(article('```mermaid\ngraph TD\nA-->B\n```\n\n$$\n\\int x\n$$\n\n$$a=b$$\n\n行内 $E=mc^2$ 与 $5 和 $10 不变'));
	expect(out.generated.map(g => g.kind)).toEqual(['mermaid', 'math', 'math']);
	expect(out.generated[1].code).toBe('\\int x');
	expect(out.markdown).toContain('`E=mc^2`');
	expect(out.markdown).toContain('$5 和 $10');
	expect(out.markdown).not.toContain('```mermaid');
	const parsed = shared.parseMarkdown(out.markdown, { setTitle: true, setCover: true });
	expect(parsed.segments.filter(s => s.type === 'image').length).toBe(3);
});

it('leaves other code blocks alone, even when they contain dollar signs or images', () => {
	const out = prepareForX(article('```js\nconst a = "$$x$$"; // ![x](y)\n```'));
	expect(out.markdown).toContain('```js\nconst a = "$$x$$"; // ![x](y)\n```');
	expect(out.generated).toEqual([]);
});

it('turns resized html images back into Markdown images and checklists into symbols', () => {
	const out = prepareForX(article('<img src="qm-image://img_2" alt="宽图" width="320">\n\n- [x] 完成\n- [ ] 待办'));
	expect(out.markdown).toContain(`![宽图](${LOCAL_IMAGE_HOST}img_2)`);
	expect(out.markdown).toContain('- ☑ 完成');
	expect(out.markdown).toContain('- ☐ 待办');
});

it('counts media against the X limit like the engine does', () => {
	const many = Array.from({ length: 26 }, (_, i) => `![${i}](qm-image://img_${i})`).join('\n\n');
	const parsed = shared.parseMarkdown(prepareForX(article(many)).markdown, { setTitle: true, setCover: true });
	expect(shared.articleMediaEstimate(parsed, { setCover: true }).overSoftLimit).toBe(true);
});

it('keeps MP4 blocks in order with pictures/GIFs and counts all of them in the media budget', () => {
 const markdown='Before\n\n![photo](https://example.com/a.png)\n\n[Clip](https://example.com/b.mp4?token=fixture)\n\n<video controls><source src="https://example.com/c.mp4" type="video/mp4"></video>\n\n![animation](https://example.com/d.gif)\n\nAfter';
 const parsed=shared.parseMarkdown(prepareForX(article(markdown)).markdown,{setCover:true});
 expect(parsed.segments.filter(s=>s.source).map(s=>s.type)).toEqual(['image','video','video','image']);
 expect(shared.articleMediaEstimate(parsed).total).toBe(4);
 const media=new Map(parsed.segments.filter(s=>s.source).map(s=>[s,{ok:true,base64:'YQ==',mime:s.type==='video'?'video/mp4':'image/png',fileName:s.type==='video'?'clip.mp4':'pic.png',bytes:1}]));
 const plan=shared.buildPastePlan(parsed.segments,media,new Map(),{});
 expect(plan.plan.map((p:any)=>p.op.file.mime)).toEqual(['image/png','video/mp4','video/mp4','image/png']);
 expect(plan.plan[1].op.fallbackText).toBe('[Clip](https://example.com/b.mp4?token=fixture)');
 expect(plan.plan.every((p:any)=>p.op.file.bytes===1)).toBe(true);
});
it('does not upload video-looking URLs inside fenced code or ordinary prose links',()=>{
 const parsed=shared.parseMarkdown('```html\n<video src="https://example.com/code.mp4"></video>\n```\n\nSee [this video](https://example.com/linked.mp4) for details.');
 expect(parsed.segments.filter(s=>s.type==='video')).toHaveLength(0);
});
