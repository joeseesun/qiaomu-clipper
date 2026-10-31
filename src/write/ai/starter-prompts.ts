// Built-in prompts chosen by what the writer is looking at. The body is what is sent; a label ending in "…" asks for a blank first.
export type StarterScene = 'selection' | 'empty' | 'draft';
export interface StarterPrompt { id: string; label: string; body: string }

export interface StarterContext { selection: boolean; articleChars: number }

export function starterScene(context: StarterContext): StarterScene {
	if (context.selection) return 'selection';
	return context.articleChars < 20 ? 'empty' : 'draft';
}

export const SCENE_NAMES: Record<StarterScene, string> = { selection: '选中的文字', empty: '开始写', draft: '正在写的文章' };

export const STARTER_PROMPTS: Record<StarterScene, StarterPrompt[]> = {
	selection: [
		{ id: 'sel-polish', label: '润色这段', body: '润色选中的文字：保持原意和语气，修正病句、重复和啰嗦的地方。直接给出改好的文字，不用解释。' },
		{ id: 'sel-explain', label: '讲明白这段', body: '用通俗的话解释选中的内容：术语先给一句定义，再举一个生活里的例子。' },
		{ id: 'sel-shorten', label: '压缩到一半', body: '把选中的文字压缩到原来一半左右，保留关键信息、数字和结论。' },
		{ id: 'sel-oral', label: '改得更口语', body: '把选中的文字改得更口语，像对朋友讲话：短句、具体、不用套话，但不改变意思。' },
		{ id: 'sel-structure', label: '整理成列表或表格', body: '把选中的内容整理成层次清楚的 Markdown 列表；如果有能横向比较的维度，改用表格。' },
		{ id: 'sel-translate', label: '中英互译', body: '翻译选中的文字：中文译成地道的英文，英文译成自然的中文。保留原有 Markdown 格式和链接。' },
		{ id: 'sel-challenge', label: '挑挑毛病', body: '以挑剔读者的眼光看选中的内容：哪些说法缺少证据、哪里逻辑跳跃、哪句容易被误解？逐条指出并给出改法。' },
		{ id: 'sel-continue', label: '顺着往下写', body: '顺着选中内容的思路和文风续写一段，200 字左右，不要重复已经说过的话。' },
		{ id: 'sel-example', label: '补一个例子', body: '为选中的观点补一个具体、真实可信的例子，三到五句话，写成可以直接放进文章的文字。' },
	],
	empty: [
		{ id: 'empty-angles', label: '给选题找角度…', body: '我想围绕「{{主题}}」写一篇长文。先列出 8 个可以展开的角度，再推荐最值得写的一个并说明理由。' },
		{ id: 'empty-outline', label: '帮我列提纲…', body: '为「{{主题}}」列一份长文提纲：读者是{{读者|普通读者}}，目标是{{目标|讲清楚一件事}}。给出标题备选和每一节要回答的问题。' },
		{ id: 'empty-open', label: '写几个开头…', body: '为一篇关于「{{主题}}」的文章写 3 个不同风格的开头（场景、问题、反直觉），每个不超过 120 字。' },
		{ id: 'empty-dump', label: '把想法整理成文…', body: '把下面这些零散的想法整理成一篇结构清楚的文章，尽量保留我的原话和语气，用 Markdown 小标题分节：\n\n{{想法}}' },
		{ id: 'empty-thread', label: 'X 长文怎么写', body: '给我一份适合发在 X 文章里的写法清单：标题怎么起、开头第一屏放什么、小标题和图片怎么安排、结尾怎么收。主题是「{{主题}}」。' },
	],
	draft: [
		{ id: 'draft-improve', label: '指出最该改的三处', body: '指出这篇文章最需要改进的三个地方，每处说明问题、为什么、怎么改，并给出一句可以直接替换的示范。' },
		{ id: 'draft-titles', label: '起 5 个标题', body: '基于这篇文章给我 5 个更有吸引力但不标题党的标题，各用一句话说明角度，然后用 setTitle 指令提出你最推荐的一个。' },
		{ id: 'draft-digest', label: '写摘要', body: '为这篇文章写一段自然、有信息量的摘要（100 字以内），用 setDigest 指令提出。' },
		{ id: 'draft-structure', label: '检查结构', body: '检查文章结构：段落顺序是否合理、哪里该拆、哪里该合并、小标题是否准确。需要改动的地方列出改前改后。' },
		{ id: 'draft-gaps', label: '找论证漏洞', body: '以审稿人的眼光读这篇文章：指出论证跳跃、证据不足和前后矛盾的地方，按严重程度排序。' },
		{ id: 'draft-ending', label: '补一个有力的结尾', body: '为这篇文章写一个有力的结尾：回扣开头、不喊口号、不重复总结，100 字左右，用 insert 指令放到结尾。' },
		{ id: 'draft-images', label: '建议配图位置', body: '读完文章后，建议 3 到 5 处适合配图的位置，说明每张图应该表达什么，并给出可以直接用于文生图的提示词。' },
		{ id: 'draft-facts', label: '列事实核查清单', body: '列出文章里所有需要核实的事实、数字、引用和人名，按风险从高到低排，并说明可以去哪里核实。' },
		{ id: 'draft-x', label: '改写成 X 帖子', body: '把这篇文章提炼成一条适合发在 X 上的帖子（中文，280 字以内，第一句就抓人），再给一版 5 条的 thread。' },
		{ id: 'draft-cut', label: '删掉啰嗦', body: '找出文章里重复、啰嗦、可以删掉的段落和句子，逐条给出删改建议，并说明删掉后是否影响理解。' },
	],
};
