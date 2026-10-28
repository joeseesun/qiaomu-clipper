"""Portable executable fixtures; these simulate tools, never recognition quality."""
import os
from pathlib import Path
import subprocess
import sys

def executable(folder, name, source):
    folder = Path(folder)
    if os.name == 'nt':
        script = folder / (name + '.py')
        script.write_text(source, encoding='utf8')
        launcher = folder / (name + '.cmd')
        safe = lambda value: str(value).replace('%', '%%')
        launcher.write_text('@echo off\nsetlocal DisableDelayedExpansion\nchcp 65001 >nul\n"' + safe(sys.executable) + '" -X utf8 "' + safe(script) + '" %*\n', encoding='utf8')
    else:
        launcher = folder / name
        launcher.write_text('#!' + sys.executable + '\n' + source, encoding='utf8')
        launcher.chmod(0o700)
    return launcher

def directory_link(link, target):
    if os.name == 'nt':
        # Junctions exercise real Windows path resolution without Developer Mode.
        subprocess.run(['cmd.exe', '/c', 'mklink', '/J', str(link), str(target)], check=True, capture_output=True)
    else:
        link.symlink_to(target, target_is_directory=True)

YTDLP = r'''
import os, sys
from pathlib import Path
args=sys.argv[1:]
def log(text):
    with open(os.environ['FAKE_LOG'],'a',encoding='utf8') as f: f.write(text+'\n')
if '--cookies-from-browser' in args: log('cookies='+args[args.index('--cookies-from-browser')+1])
if '--cookies' in args: log('cookiefile='+Path(args[args.index('--cookies')+1]).read_text(encoding='utf8')[:22].splitlines()[0])
if os.environ.get('FAKE_NEEDS_LOGIN') and not (Path(os.environ['FAKE_LOG']).exists() and Path(os.environ['FAKE_LOG']).stat().st_size):
    print('ERROR: [youtube] x: Sign in to confirm you are not a bot. Use --cookies-from-browser',file=sys.stderr);sys.exit(1)
if os.environ.get('FAKE_YTDLP_FAIL'):
    print('ERROR: '+os.environ['FAKE_YTDLP_FAIL'],file=sys.stderr);sys.exit(1)
print('[download]  50.0% of 1MiB'); print('[download] 100.0% of 1MiB')
Path(args[args.index('-o')+1].replace('%(ext)s','m4a')).write_bytes(b'audio')
'''
FFPROBE = "import os\nprint(os.environ.get('FAKE_DURATION','120.5'))\n"
FFMPEG = r'''
import os, sys
from pathlib import Path
args=sys.argv[1:]
if any('volumedetect' in a for a in args):
    print('[Parsed_volumedetect_0 @ 0x1] mean_volume: -15.0 dB',file=sys.stderr);sys.exit(0)
if any('silencedetect' in a for a in args):
    with open(os.environ['FAKE_FFMPEG_LOG'],'a',encoding='utf8') as f: f.write(' '.join(args)+'\n')
    for pair in os.environ.get('FAKE_PAUSES','').split():
        start,end=pair.split(':');print('silence_start: '+start,file=sys.stderr);print('silence_end: '+end+' | silence_duration: 0.3',file=sys.stderr)
    sys.exit(0)
if os.environ.get('FAKE_FFMPEG_FAIL')=='1': sys.exit(1)
Path(args[-1]).write_bytes(b'audio-bytes')
'''
MLX = r'''
import json, os, sys
from pathlib import Path
args=sys.argv[1:]
with open(os.environ['FAKE_LOG'],'a',encoding='utf8') as f:
    for option,label in [('--language','lang'),('--initial-prompt','prompt')]:
        if option in args: f.write(label+'='+args[args.index(option)+1]+'\n')
if os.environ.get('FAKE_MLX_FAIL'): print('boom',file=sys.stderr);sys.exit(2)
segments=[{'start':0.0,'end':4.84,'text':'好了,下面继续。'},{'start':4.9,'end':8.0,'text':'谢谢观看'},{'start':8.0,'end':12.0,'text':'第三个部分。'},{'start':3600.5,'end':3603.0,'text':'一小时之后。'}]
for stamp,text in [('00:00.000 --> 00:04.840','好了,下面继续。'),('00:04.900 --> 00:08.000','谢谢观看'),('00:08.000 --> 00:12.000','第三个部分。'),('01:00:00.500 --> 01:00:03.000','一小时之后。')]: print('['+stamp+'] '+text)
(Path(args[args.index('--output-dir')+1])/'whisper.json').write_text(json.dumps({'language':'zh','segments':segments}),encoding='utf8')
'''
