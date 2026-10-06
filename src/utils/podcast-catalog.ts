// Shows suggested on the study home page. Chinese shows are listed first; the overseas ones are about AI. Each is read from its public
// RSS feed (the same feed any podcast app uses), so the newest episodes are always what the show has published.
export interface PodcastShow { id: string; name: string; by: string; lang: 'zh' | 'en'; feed: string }
export const CATALOG: PodcastShow[] = [
	{ id: 'zhang-xiaojun', name: '张小珺Jùn｜商业访谈录', by: '张小珺', lang: 'zh', feed: 'https://feed.xyzfm.space/dk4yh3pkpjp3' },
	{ id: '42-zhang-jing', name: '42章经', by: 'KaiQu', lang: 'zh', feed: 'https://feed.xyzfm.space/evgg6xle9rdc' },
	{ id: 'half-latte', name: '半拿铁 | 商业沉浮录', by: '潇磊 & 刘飞', lang: 'zh', feed: 'https://proxy.wavpub.com/caffebreve.xml' },
	{ id: 'latetalk', name: '晚点聊 LateTalk', by: '晚点 LatePost', lang: 'zh', feed: 'https://feeds.fireside.fm/latetalk/rss' },
	{ id: 'next-token', name: 'Next Token｜词元之外', by: 'Next Token', lang: 'zh', feed: 'https://anchor.fm/s/116d068f0/podcast/rss' },
	{ id: 'latent-space', name: 'Latent Space', by: 'swyx & Alessio', lang: 'en', feed: 'https://api.substack.com/feed/podcast/1084089.rss' },
	{ id: 'dwarkesh', name: 'Dwarkesh Podcast', by: 'Dwarkesh Patel', lang: 'en', feed: 'https://apple.dwarkesh-podcast.workers.dev/feed.rss' },
	{ id: 'no-priors', name: 'No Priors', by: 'Sarah Guo & Elad Gil', lang: 'en', feed: 'https://feeds.megaphone.fm/nopriors' },
	{ id: 'training-data', name: 'Training Data', by: 'Sequoia Capital', lang: 'en', feed: 'https://feeds.megaphone.fm/trainingdata' },
	{ id: 'cognitive-revolution', name: 'The Cognitive Revolution', by: 'Nathan Labenz', lang: 'en', feed: 'https://feeds.megaphone.fm/RINTP3108857801' },
];
