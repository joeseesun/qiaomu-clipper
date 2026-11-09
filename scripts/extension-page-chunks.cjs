const PAGE_ENTRIES = new Set(['popup', 'ai-side-panel', 'ai-chat-page', 'settings', 'highlights', 'reader-page', 'clip-editor', 'write', 'image-runner', 'image-library']);

function pageSharedChunks() {
 return {
  cacheGroups: {
   extensionPages: {
    // Keep separate consumer groups so a small page does not load the reader/editor.
    name: false,
    chunks: chunk => PAGE_ENTRIES.has(chunk.name),
    test: module => /\.(?:[cm]?js|tsx?|json)$/.test(module.nameForCondition() || ''),
    minChunks: 2,
    minSize: 20000,
    maxInitialRequests: Infinity,
    priority: 40,
    reuseExistingChunk: true,
   },
  },
 };
}

// Only HTML-owned entrypoints share initial code. Injected scripts and the MV3
// service worker retain their standalone startup; they have no HTML loader.
class ExtensionPageScriptsPlugin {
 apply(compiler) {
  compiler.hooks.thisCompilation.tap('ExtensionPageScripts', compilation => {
   compilation.hooks.processAssets.tap({ name: 'ExtensionPageScripts', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE }, () => {
    for (const asset of compilation.getAssets()) {
     if (!asset.name.endsWith('.html')) continue;
     let html = asset.source.source().toString();
     for (const name of PAGE_ENTRIES) {
      const entry = compilation.entrypoints.get(name);
      if (!entry) continue;
      const anchor = new RegExp(`<script\\b[^>]*\\bsrc=["']${name}\\.js["'][^>]*>\\s*</script>`, 'i');
      if (!anchor.test(html)) continue;
      const scripts = entry.getFiles().filter(file => file.endsWith('.js') && file !== `${name}.js`);
      const missing = scripts.filter(file => !html.includes(`src="${file}"`) && !html.includes(`src='${file}'`));
      for (const file of missing) {
       if (!compilation.getAsset(file) || !/^[a-zA-Z0-9_./-]+\.js$/.test(file)) throw new Error(`Invalid page dependency: ${file}`);
      }
      html = html.replace(anchor, match => missing.map(file => `<script src="${file}"></script>`).join('\n') + '\n' + match);
     }
     compilation.updateAsset(asset.name, new compiler.webpack.sources.RawSource(html));
    }
   });
  });
 }
}
module.exports = { PAGE_ENTRIES, pageSharedChunks, ExtensionPageScriptsPlugin };
