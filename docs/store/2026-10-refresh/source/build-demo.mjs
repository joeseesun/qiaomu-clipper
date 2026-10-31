import { build } from 'esbuild';
import { mkdir, writeFile, copyFile, cp, lstat, unlink, symlink } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname,'../../../..');
const web = path.join(root,'build/qa/store-refresh/web');
await mkdir(web,{recursive:true});
const production = process.env.QIAOMU_STORE_BUILD_ROOT || path.join(root,'build/production/chrome-store');
for (const name of ['style.css','reader.css','write.css','image-library.css','katex.css','fonts','icons','_locales']) {
  const dest=path.join(web,name);
  if ((await lstat(dest).catch(()=>null))?.isSymbolicLink()) await unlink(dest);
  await cp(path.join(production,name),dest,{recursive:true,force:true});
}
for (const [name,source] of [['campaign',path.resolve(import.meta.dirname,'..')],['sample-brand.png',path.resolve(import.meta.dirname,'../brand-illustration.png')]]) {
  const dest=path.join(web,name);
  if ((await lstat(dest).catch(()=>null))?.isSymbolicLink()) await unlink(dest);
  await symlink(source,dest);
}
await build({
  entryPoints:[path.join(import.meta.dirname,'demo.ts')],outfile:path.join(web,'demo.js'),
  bundle:true,format:'esm',platform:'browser',target:'chrome120',
  define:{__LOCAL_EDITION__:'false',DEBUG_MODE:'false','process.env.NODE_ENV':'"production"'},loader:{'.woff':'dataurl','.woff2':'dataurl','.ttf':'dataurl'},
  plugins:[{name:'browser-demo',setup(b){b.onResolve({filter:/browser-polyfill$/},()=>({path:path.join(import.meta.dirname,'browser-demo.ts')}));}}],
  logLevel:'warning',
});
await writeFile(path.join(web,'demo.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="reader.css"><link rel="stylesheet" href="write.css"><link rel="stylesheet" href="image-library.css"><link rel="stylesheet" href="katex.css"><title>乔木剪藏 · 真实组件 / 示例内容</title></head><body><script type="module" src="demo.js"></script></body></html>`);
await mkdir(path.join(web,'examples'),{recursive:true});
for(const name of ['video-reading','reader-highlights','learning-notes','markdown-editor','ai-chat'])
 await copyFile(path.join(root,`docs/assets/features/${name}.jpg`),path.join(web,`examples/${name}.jpg`));
console.log(web);
