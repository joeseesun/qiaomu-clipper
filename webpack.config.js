const path = require('path');
const fs = require('fs');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const { outputDir: buildOutputDir } = require('./scripts/build-layout.cjs');
const { sourceState, writeBuildInfo, assertVersion } = require('./scripts/build-info.cjs');
const package = require('./package.json');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');

// Remove .DS_Store files
function removeDSStore(dir) {
	const files = fs.readdirSync(dir);
	files.forEach(file => {
		const filePath = path.join(dir, file);
		if (fs.statSync(filePath).isDirectory()) {
			removeDSStore(filePath);
		} else if (file === '.DS_Store') {
			fs.unlinkSync(filePath);
		}
	});
}

module.exports = (env, argv) => {
	if (!['chrome', 'firefox', 'safari'].includes(env.BROWSER) || (env.EDITION && env.EDITION !== 'local')) throw new Error('Unknown browser or edition');
	const isFirefox = env.BROWSER === 'firefox';
	const isSafari = env.BROWSER === 'safari';
	const isProduction = argv.mode === 'production';
	if (isProduction) require('node:child_process').execFileSync(process.execPath, [path.join(__dirname, 'scripts/check-i18n.cjs')], { cwd: __dirname, stdio: 'inherit' });
	// The standalone Chrome edition has a fixed unpacked ID. The store build keeps its stricter media-source policy.
	const isLocal = env.EDITION === 'local' && !isFirefox && !isSafari;

	const target = isFirefox ? 'firefox' : (isSafari ? 'safari' : (isLocal ? 'chrome-local' : 'chrome-store'));
	const outputDir = buildOutputDir(target, argv.mode);
	let source;

	const mainConfig = {
		mode: argv.mode,
		entry: {
			'content-loader': './src/content-loader.ts',
			'triple-key': './src/triple-key-content.ts',
			'selection-toolbar': './src/selection-toolbar-content.ts',
			'english-learning': ['./src/core/english-learning.ts', './src/styles/english-learning.scss'],
			'youtube-player-bridge': './src/youtube-player-bridge.ts',
			'youtube-panel': './src/youtube-panel-content.ts',
			'bilibili-panel': './src/bilibili-panel-content.ts',
			'bilibili-embed': './src/bilibili-embed-content.ts',
			'youtube-embed': './src/youtube-embed-content.ts',
			'xiaoyuzhou-panel': './src/xiaoyuzhou-content.ts',
			'web-panel': './src/web-content.ts',
			'channels-share': './src/channels-share-content.ts',
			'note-card': ['./src/note-card-content.ts', './src/note-card.scss'],
			popup: './src/core/popup.ts',
			'ai-side-panel': ['./src/core/ai-side-panel.ts', './src/styles/ai-side-panel.scss'],
			'ai-chat-page': './src/core/ai-chat-page.ts',
			settings: './src/core/settings.ts',
			highlights: './src/core/highlights.ts',
			'reader-page': './src/core/reader-view.ts',
			'clip-editor': './src/core/clip-editor.ts',
			write: ['./src/core/write.ts', './src/styles/write.scss'],
			// Injected into an X Articles tab only while an article is being published (see src/write/publish/x.ts).
			'x-publish-main': './src/x-publish/main-world.js',
			'x-publish-content': './src/x-publish/x-content.ts',
			// Injected on demand when Obsidian hands over an article (src/publish-bridge).
			'zhihu-publish-content': './src/publish-bridge/zhihu-content.ts',
			'xhs-publish-content': './src/publish-bridge/xhs-content.ts',
			content: './src/content.ts',
			background: './src/background.ts',
			'image-runner': './src/core/image-runner.ts',
			'image-library': ['./src/core/image-library.ts', './src/styles/image-library.scss'],
			style: './src/style.scss',
			highlighter: './src/highlighter.scss',
			reader: './src/reader.scss',
			'reader-script': './src/reader-script.ts'
		},
		output: {
			path: path.resolve(__dirname, outputDir),
			// Start from an empty folder: files left by older builds must not end up in a package.
			clean: true,
			filename: '[name].js',
			module: false,
		},
		devtool: isProduction ? false : 'source-map',
		optimization: {
			minimize: true,
			minimizer: [
				new TerserPlugin({
					terserOptions: {
						mangle: false,
						compress: {
							defaults: true,
							global_defs: {
								DEBUG_MODE: !isProduction
							},
							unused: true,
							dead_code: true,
							passes: 2,
							ecma: 2020,
							module: false
						},
						format: {
							ascii_only: true,
							comments: false,
							ecma: 2020
						},
						module: false,
						toplevel: true,
						keep_classnames: true,
						keep_fnames: true
					},
					extractComments: false
				})
			],
			moduleIds: 'named',
			chunkIds: 'named'
		},
		experiments: {
			outputModule: false,
		},
		resolve: {
			extensions: ['.ts', '.js'],
			alias: {
				'./utils/browser-polyfill': path.resolve(__dirname, 'node_modules/webextension-polyfill/dist/browser-polyfill.min.js'),
				'../utils/browser-polyfill': path.resolve(__dirname, 'node_modules/webextension-polyfill/dist/browser-polyfill.min.js')
			}
		},
		module: {
			rules: [
				{
					test: /\.tsx?$/,
					use: [
						{
							loader: 'ts-loader',
							options: {
								compilerOptions: {
									module: 'ES2020'
								}
							}
						}
					],
					exclude: /node_modules/,
				},
				{
					test: /\.scss$/,
					use: [
						MiniCssExtractPlugin.loader,
						{
							loader: 'css-loader',
							options: {
								sourceMap: !isProduction
							}
						},
						{
							loader: 'sass-loader',
							options: {
								sourceMap: !isProduction
							}
						}
					]
				}
			]
		},
		plugins: [
			new CopyPlugin({
				patterns: [
					{ 
						from: isFirefox ? "src/manifest.firefox.json" : 
							  (isSafari ? "src/manifest.safari.json" : "src/manifest.chrome.json"), 
						to: "manifest.json",
						transform: (content) => {
							const manifest = JSON.parse(content.toString());
							manifest.version = package.version;
							if (!isSafari) manifest.version_name = `${package.version} · ${target} · ${isProduction ? 'production' : 'dev'} · ${source.commit.slice(0, 7)}-${source.sourceHash.slice(0, 8)}${source.dirty ? '-dirty' : ''}`;
							if (!isProduction) manifest.name += ' · DEV';
							if (isLocal) {
								manifest.name += ' · 独立版';
								manifest.key = fs.readFileSync(path.resolve(__dirname, 'scripts/chrome-local-key.txt'), 'utf8').trim();
								manifest.permissions = Array.from(new Set([...(manifest.permissions || []), 'downloads', 'cookies']));
								manifest.optional_permissions = (manifest.optional_permissions || []).filter(permission => !['downloads', 'cookies'].includes(permission));
							}
							return JSON.stringify(manifest, null, '\t');
						}

					},
					{ from: "LICENSE", to: "LICENSE.txt" },
					{ from: "src/popup.html", to: "popup.html" },
					{ from: "src/side-panel.html", to: "side-panel.html" },
					{ from: "src/ai-side-panel.html", to: "ai-side-panel.html" },
					{ from: "src/ai-chat-page.html", to: "ai-chat-page.html" },
					{ from: "src/english-learning.html", to: "english-learning.html" },
					{ from: "src/image-runner.html", to: "image-runner.html" },
					{ from: "src/image-library.html", to: "image-library.html" },
					{ from: "src/settings.html", to: "settings.html" },
					{ from: "src/highlights.html", to: "highlights.html" },
					{ from: "src/reader.html", to: "reader.html" },
					{ from: "src/editor.html", to: "editor.html" },
					{ from: "src/write.html", to: "write.html" },
					// Formulas: KaTeX's stylesheet next to its fonts (the css asks for fonts/KaTeX_*).
					{ from: "node_modules/katex/dist/katex.min.css", to: "katex.css" },
					{ from: "node_modules/katex/dist/fonts/*.woff2", to: "fonts/[name][ext]" },
					{ from: "src/icons", to: "icons", globOptions: { ignore: ["**/*.ts"] } },
					{ from: "node_modules/webextension-polyfill/dist/browser-polyfill.min.js", to: "browser-polyfill.min.js" },
					{ from: "src/flatten-shadow-dom.js", to: "flatten-shadow-dom.js" },
					{ from: "src/fonts", to: "fonts" },
					{ from: "src/assets/about", to: "assets/about" },
					{
						from: 'src/_locales',
						to: '_locales'
					}
				],
			}),
			new MiniCssExtractPlugin({
				filename: '[name].css'
			}),
			{
				apply: (compiler) => {
					compiler.hooks.afterEmit.tap('RemoveDSStore', (compilation) => {
						removeDSStore(path.resolve(__dirname, outputDir));
					});
				}
			},
			new webpack.DefinePlugin({
				'process.env.NODE_ENV': JSON.stringify(argv.mode),
				'DEBUG_MODE': JSON.stringify(!isProduction),
				'__LOCAL_EDITION__': JSON.stringify(isLocal),
				// MathJax reads its version from package.json through eval("require") unless this is defined, and extension pages forbid eval.
				'PACKAGE_VERSION': JSON.stringify('3.2.1')
			}),
			{
				apply(compiler) {
					compiler.hooks.beforeCompile.tap('BuildIdentity', () => {
						package.version = assertVersion(JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version);
						source = sourceState();
					});
					compiler.hooks.afterEmit.tap('BuildIdentity', () => {
						if (sourceState().sourceHash !== source.sourceHash) throw new Error('Source changed during build; rebuild');
						writeBuildInfo(outputDir, { schema: 1, version: package.version, target, mode: argv.mode, ...source, builtAt: new Date().toISOString() });
					});
				}
			}

		]
	};

	return [mainConfig];
};
