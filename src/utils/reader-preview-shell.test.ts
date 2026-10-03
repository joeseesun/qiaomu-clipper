// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({chat:vi.fn((_options: any)=>({toggle:vi.fn(()=>true)})),update:vi.fn(),copy:vi.fn().mockResolvedValue(true)}));
vi.mock('./clip-chat',()=>({mountClipChat:state.chat}));
vi.mock('./clip-preview',()=>({updateClipPreview:state.update,saveClipPreview:vi.fn().mockResolvedValue(['saved'])}));
vi.mock('./obsidian-note-creator',()=>({generateFrontmatter:async()=>''}));
vi.mock('./reader',()=>({Reader:{onEdit:null,highlightSelection:vi.fn()}}));
vi.mock('./highlighter',()=>({getHighlights:()=>[]}));
vi.mock('./storage-utils',()=>({generalSettings:{tripleKeys:{},tripleKeyShortcuts:true}}));
vi.mock('./triple-key',()=>({listenTripleKey:vi.fn(),normalizeTripleKeys:()=>({edit:'e'})}));
vi.mock('./youtube-study',()=>({transcriptText:()=> '[0:12] Source transcript'}));
vi.mock('./clipboard-utils',()=>({copyToClipboard:state.copy}));
vi.mock('./i18n',()=>({getMessage:(key:string)=>key}));
vi.mock('./browser-polyfill',()=>({default:{runtime:{getURL:(path:string)=>path},storage:{onChanged:{addListener:vi.fn()}}}}));
import { mountReaderPreviewShell } from './reader-preview-shell';
import type { ClipPreview } from './clip-preview';
const draft=():ClipPreview=>({createdAt:Date.now(),aggregate:false,native:true,local:{requestId:'same-draft',content:'Note',name:'Video.md',folder:'Clips',vault:'Vault',behavior:'create'},clip:{title:'Video',url:'https://youtube.com/watch?v=dbqweBCynuI',markdown:'Body'}});
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
beforeEach(()=>{vi.clearAllMocks();document.body.innerHTML='<article></article><div class="obsidian-reader-settings"><button>Aa</button></div>';});

it('uses identical bar controls for ordinary reading and the pending study page, including the same Aa component',()=>{
	const ordinary=mountReaderPreviewShell(draft());
	const signature=(bar:HTMLElement)=>Array.from(bar.children).map(node=>`${node.tagName}:${node.id || node.className}`);
	const expected=signature(ordinary.bar);const aa=document.querySelector('.obsidian-reader-settings');
	expect(ordinary.bar.querySelector('.clip-bar-extras')!.firstChild).toBe(aa);
	document.body.innerHTML='<article></article><div class="obsidian-reader-settings"><button>Aa</button></div>';
	const study=mountReaderPreviewShell(draft(),true);expect(signature(study.bar)).toEqual(expected);
	expect(study.bar.querySelector<HTMLButtonElement>('#clip-bar-copy')!.disabled).toBe(true);
	expect(study.bar.querySelector<HTMLButtonElement>('.clip-bar-extras button')!.disabled).toBe(false);
	study.setPending(false);expect(study.bar.querySelector<HTMLButtonElement>('#clip-bar-copy')!.disabled).toBe(false);
});

it('copies the populated draft and retains a user-selected RSS state across loading',async()=>{
	const data=draft();const shell=mountReaderPreviewShell(data,true);
	const rss=shell.bar.querySelector<HTMLInputElement>('input.switch')!;rss.checked=true;rss.dispatchEvent(new Event('change'));await flush();
	data.clip.title='Actual title';data.local.content='Actual subtitles';shell.refresh();shell.setPending(false);
	shell.bar.querySelector<HTMLButtonElement>('#clip-bar-copy')!.click();await flush();
	expect(state.copy).toHaveBeenCalledWith('Actual subtitles');expect(data.aggregate).toBe(true);
	expect(shell.bar.querySelector('.clip-bar-title span')!.textContent).toBe('Actual title');
});

it('keeps completed clips disabled and asks about the transcript through the single shared chat',()=>{
	const data=draft();data.localDone=true;const shell=mountReaderPreviewShell(data);
	expect(shell.bar.querySelector<HTMLButtonElement>('#clip-bar-clip')!.disabled).toBe(true);
	expect(state.chat).toHaveBeenCalledTimes(1);
	expect(state.chat.mock.calls[0][0].getContext().markdown).toBe('[0:12] Source transcript');
});
