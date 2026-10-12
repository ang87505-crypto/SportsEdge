"""Reproduce from a checkout containing PR #28 and this additive milestone.

Fetches only public, free pinned inputs. Exclusive output, immutable cache checks.
No raw third-party data are included in the deliverable or published by this script.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
PREFIX='https://raw.githubusercontent.com/jacobburdier05/nba-moneyline-calibration/531580ab210ff8ffda25e58e89b5d08e2e8b85b5/data/raw/'


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--cache',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();a.cache=a.cache.resolve();a.output=a.output.resolve()
    if a.output.exists():raise ValueError('Use a NEW output folder')
    a.cache.mkdir(parents=True,exist_ok=True)
    def fetch(url,path,expected,kind='sha256'):
        if path.exists():raw=path.read_bytes()
        else:
            raw=urllib.request.urlopen(url,timeout=120).read()
            with path.open('xb') as f:f.write(raw)
        digest=hashlib.sha256(raw).hexdigest() if kind=='sha256' else hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
        if digest!=expected:raise ValueError('Hash mismatch; preserve and inspect: '+str(path))
    for name,sha in [('nba_moneylines.csv','ed143d6e608b21f791b7ff9f2e35577c9aa5997a'),('nba_adv_crosscheck.csv','b68b299cdaa6aaa39e4b1c6ab2182d8eeeb23bf2')]:
        fetch(PREFIX+name,a.cache/name,sha,'blob')
    manifest=json.loads((ROOT/'src/data/research/nba_recent_sources.json').read_text())
    for group,prefix in [('espn',''),('nba','official_')]:
        for e in manifest[group]:fetch(e['url'],a.cache/(prefix+e['name']),e['sha256'])
    subprocess.run([sys.executable,'-m','unittest','discover','-s','analytics','-p','test_*.py','-q'],cwd=ROOT,check=True)
    subprocess.run([sys.executable,str(ROOT/'analytics/nba_research_audit_20261012.py'),
                    '--source',str(a.cache/'nba_moneylines.csv'),'--crosscheck',str(a.cache/'nba_adv_crosscheck.csv'),
                    '--output-dir',str(a.output)],cwd=ROOT,check=True)
    subprocess.run([sys.executable,str(ROOT/'analytics/nba_quant_audit.py'),'--folder',str(a.cache),
                    '--output',str(a.output/'pr17_replay.json')],cwd=ROOT,check=True)
    modern=json.loads((a.output/'pr17_replay.json').read_text())
    stored=json.loads((ROOT/'research/nba_quant_20261009/report.json').read_text())
    if modern!=stored:raise ValueError('PR17 stored report differs')
    print('PR17 full report and all stored forecasts reproduced. Outputs: '+str(a.output))

if __name__=='__main__':main()
