"""Real yt-dlp/ffmpeg through the guarded relay; upstream HLS is synthetic and fetched in memory."""
import io, json, os, shutil, sys, tempfile, wave
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'native'))
import asr
page='https://appfixture123.h5.xiaoeknow.com/v4/course/alive/l_fixture123456?app_id=appfixture123'
media='https://video.xet.tech/fixture.m3u8?sign=fixture-only'
folder=Path(sys.argv[1]).resolve()
seen=[]
class Response(io.BytesIO):
    def __init__(self,url,data):super().__init__(data);self.url=url;self.headers={'Content-Length':str(len(data))};self.status=200
    def geturl(self):return self.url

def fetch(url,**options):
    assert options['allowed'](url)
    name=Path(urlparse(url).path).name
    assert name and (folder/name).parent==folder
    seen.append(name)
    return Response(url,(folder/name).read_bytes())
tools={name:shutil.which(name) for name in ('yt-dlp','ffmpeg','ffprobe')}
assert all(tools.values()),tools
with tempfile.TemporaryDirectory() as temp,patch.object(asr,'open_public',side_effect=fetch):
    directory=Path(temp)
    audio=asr.download_hls(directory,{'url':page,'mediaUrl':media},os.environ.copy(),tools)
    wav,seconds=asr.convert(directory,audio,os.environ.copy(),tools)
    with wave.open(str(wav)) as file:
        assert file.getframerate()==16000 and file.getnchannels()==1
        assert 7.5<=file.getnframes()/file.getframerate()<=8.5
    print(json.dumps({'passed':True,'seconds':seconds,'resources':seen,'scope':'Real yt-dlp and ffmpeg; synthetic upstream, no account, no speech API'}))
