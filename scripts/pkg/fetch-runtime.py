"""Build-machine tool (Python 3.12+); end users install the resulting package."""
import argparse
import hashlib
import json
from pathlib import Path
import tarfile
from urllib.request import urlopen

def main():
    lock = json.loads(Path(__file__).with_name('python-runtime-lock.json').read_text())
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('platform', choices=lock['platforms'])
    parser.add_argument('--cache', type=Path, default=Path('build/cache'))
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    archive = args.cache / ('python-' + args.platform)
    url = lock['baseUrl'] + 'cpython-' + lock['version'] + '%2B' + lock['release'] + '-' + args.platform + '-install_only_stripped.tar.gz'
    if not archive.exists():
        with urlopen(url, timeout=60) as response, archive.with_suffix('.part').open('wb') as out:
            while chunk := response.read(1024 * 1024): out.write(chunk)
        archive.with_suffix('.part').replace(archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != lock['platforms'][args.platform]:
        raise ValueError('Python runtime SHA256 mismatch; refusing to extract')
    destination = args.cache / (archive.name + '-runtime')
    if destination.exists():
        raise FileExistsError('Choose an empty destination: ' + str(destination))
    with tarfile.open(archive) as package:
        package.extractall(destination, filter='data')
    print(destination / 'python')

if __name__ == '__main__': main()
