"""Bounded continuity guard; metadata is preservation evidence, not content QA."""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import sys

AR = Path(r'D:\Shayan\Projects\Upwork\Steampunk-AR')
PRINT = Path(r'D:\Shayan\Projects\Wall-Print-Steampunk')
OUT = Path(__file__).parent

def git(folder, *args):
    return subprocess.check_output(['git', '-C', str(AR / folder), *args], text=True)

def snapshot():
    paths = list((PRINT / 'CLIENT_DELIVERY').glob('*/*/*'))
    paths += list((PRINT / 'CLIENT_DELIVERY/Steampunk_CMYK_TIFF_LZW_2026-10-26').glob('*'))
    paths += list(PRINT.glob('*.blend*'))
    paths += [AR / 'Models/source-baselines/v79-6879ac01468b/steampunk_V79.blend']
    files = {}
    for p in sorted(set(paths)):
        if p.is_file():
            s = p.stat()
            files[str(p)] = dict(bytes=s.st_size, mtimeNs=s.st_mtime_ns, fileId=s.st_ino)
    tracked = {}
    changed = git('App', 'diff', '--name-only').splitlines()
    for name in changed:
        p = AR / 'App' / name
        if p.is_file():
            tracked[name] = hashlib.sha256(p.read_bytes()).hexdigest()
    return dict(timeUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                protectedMetadata=files, appStatus=git('App', 'status', '--porcelain=v1'),
                appChangedTrackedHashes=tracked,
                publishingStatus=git('Publishing', 'status', '--porcelain=v1'),
                publishingHead=git('Publishing', 'rev-parse', 'HEAD').strip(),
                scope='Exact listed metadata and App tracked dirty-file hashes; no redundant print verification or recursive junction traversal.')

if __name__ == '__main__':
    current = snapshot()
    if '--compare' in sys.argv:
        before = json.loads((OUT / 'preservation-before.json').read_text())
        keys = ['protectedMetadata', 'appStatus', 'appChangedTrackedHashes', 'publishingStatus', 'publishingHead']
        checks = {k: before[k] == current[k] for k in keys}
        current['checks'] = checks
        current['status'] = 'PASS' if all(checks.values()) else 'FAIL'
        target = OUT / 'preservation-after.json'
    else:
        target = OUT / 'preservation-before.json'
    target.write_text(json.dumps(current, indent=2), encoding='utf-8')
    print(json.dumps(dict(report=str(target), protectedFiles=len(current['protectedMetadata']), status=current.get('status', 'BASELINE'))))
