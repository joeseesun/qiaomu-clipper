const path = require('path');
const fs = require('fs');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const ZipPlugin = require('zip-webpack-plugin');
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
	const isFirefox = env.BROWSER === 'firefox';
	const isSafari = env.BROWSER === 'safari';
	const isProduction = argv.mode === 'production';
	// The local edition is the Chrome build people load from GitHub: fixed extension ID, and features the Web Store would not accept
	// (saving media files). The store edition is built from the same source with __LOCAL_EDITION__ false, so that code is not in it at all.
	const isLocal = env.EDITION === 'local' && !isFirefox && !isSafari;

	const getOutputDir = () => {
		if (isProduction) {
			return isFirefox ? 'dist_firefox' : (isSafari ? 'dist_safari' : (isLocal ? 'dist_local' : 'dist'));
		} else {
			return isFirefox ? 'dev_firefox' : (isSafari ? 'dev_safari' : (isLocal ? 'dev_local' : 'dev'));
		}
	};

	const outputDir = getOutputDir();
	const browserName = isFirefox ? 'firefox' : (isSafari ? 'safari' : (isLocal ? 'chrome-local' : 'chrome'));

	const mainConfig = {
		mode: argv.mode,
		entry: {
			'content-loader': './src/content-loader.ts',
			'triple-key': './src/triple-key-content.ts',
			'youtube-panel': './src/youtube-panel-content.ts',
			'bilibili-panel': './src/bilibili-panel-content.ts',
			'bilibili-embed': './src/bilibili-embed-content.ts',
			'xiaoyuzhou-panel': './src/xiaoyuzhou-content.ts',
			'web-panel': './src/web-content.ts',
			'note-card': ['./src/note-card-content.ts', './src/note-card.scss'],
			popup: './src/core/popup.ts',
			settings: './src/core/settings.ts',
			highlights: './src/core/highlights.ts',
			'reader-page': './src/core/reader-view.ts',
			'clip-editor': './src/core/clip-editor.ts',
			content: './src/content.ts',
			background: './src/background.ts',
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
						// The store assigns its own key; the local edition carries the store item's public key so both get the same extension ID.
						...(isLocal ? { transform: (content) => { const manifest = JSON.parse(content.toString()); manifest.key = fs.readFileSync(path.resolve(__dirname, 'scripts/chrome-local-key.txt'), 'utf8').trim(); manifest.permissions = Array.from(new Set([...(manifest.permissions || []), 'downloads'])); return JSON.stringify(manifest, null, '\t'); } } : {})
					},
					{ from: "LICENSE", to: "LICENSE.txt" },
					{ from: "src/popup.html", to: "popup.html" },
					{ from: "src/side-panel.html", to: "side-panel.html" },
					{ from: "src/settings.html", to: "settings.html" },
					{ from: "src/highlights.html", to: "highlights.html" },
					{ from: "src/reader.html", to: "reader.html" },
					{ from: "src/editor.html", to: "editor.html" },
					{ from: "src/icons", to: "icons", globOptions: { ignore: ["**/*.ts"] } },
					{ from: "node_modules/webextension-polyfill/dist/browser-polyfill.min.js", to: "browser-polyfill.min.js" },
					{ from: "src/flatten-shadow-dom.js", to: "flatten-shadow-dom.js" },
					{ from: "src/fonts", to: "fonts" },
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
				'__LOCAL_EDITION__': JSON.stringify(isLocal)
			}),
			...(isProduction ? [
				new ZipPlugin({
					path: path.resolve(__dirname, 'builds'),
					filename: `qiaomu-clipper-${package.version}-${browserName}.zip`,
				})
			] : [])
		]
	};

	return [mainConfig];
};
