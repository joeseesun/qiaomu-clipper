"""Install/update the native host for one Chrome extension and one explicit vault."""
import argparse,json,os,re,sys
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--vault',required=True);p.add_argument('--extension-id',required=True);a=p.parse_args()
root=Path(a.vault).resolve()
if not (root/'.obsidian').is_dir():p.error('vault must contain .obsidian')
if not re.fullmatch('[a-p]{32}',a.extension_id):p.error('invalid Chrome extension ID')
base=Path.home()/'.local/share/qiaomu-clipper';base.mkdir(parents=True,exist_ok=True)
source=Path(__file__).with_name('host.py').read_text().split('\n',1)[1]
host=base/'host.py';host.write_text('#!'+sys.executable+'\n'+source);host.chmod(0o700)
origin=f'chrome-extension://{a.extension_id}/'
config=base/'config.json';config.write_text(json.dumps({'vault':str(root),'origin':origin},ensure_ascii=False,indent=2));config.chmod(0o600)
if sys.platform=='darwin':manifests=Path.home()/'Library/Application Support/Google/Chrome/NativeMessagingHosts'
elif sys.platform.startswith('linux'):manifests=Path.home()/'.config/google-chrome/NativeMessagingHosts'
else:p.error('this installer currently supports macOS and Linux Chrome')
manifests.mkdir(parents=True,exist_ok=True)
manifest=manifests/'ai.qiaomu.clipper.json';manifest.write_text(json.dumps({'name':'ai.qiaomu.clipper','description':'Save clipped Markdown silently to the configured Obsidian vault','path':str(host),'type':'stdio','allowed_origins':[origin]},indent=2));manifest.chmod(0o600)
print(json.dumps({'host':str(host),'vault':str(root),'manifest':str(manifest)},ensure_ascii=False))
