#!/usr/bin/env python3
"""Relay an allow-listed market snapshot to one dedicated GitHub feed branch."""
import argparse
import base64
import fcntl
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time
from export_snapshot import export

ROOT = Path(__file__).resolve().parent


def api(path, payload=None, method='PUT'):
    command = ['gh', 'api', path]
    if payload is not None:
        command += ['--method', method, '--input', '-']
    result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                            capture_output=True, text=True, timeout=35)
    if result.returncode:
        raise RuntimeError('GitHub 同步失败：' + result.stderr.strip()[:240])
    return json.loads(result.stdout)


def publish(config, state):
    snapshot = json.loads(Path(config['source']).read_text(encoding='utf-8-sig'))
    payload = json.dumps(export(snapshot), ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
    digest = hashlib.sha256(payload).hexdigest()
    bucket = int(time.time()//20)
    if state.get('bucket') == bucket or state.get('digest') == digest:
        return state
    owner = config['repository'].split('/')[0]
    committer = dict(name=owner,email=owner+'@users.noreply.github.com')
    prefix = 'repos/' + config['repository'] + '/contents/'
    path = 'snapshots/' + str(bucket) + '.json'
    answer = api(prefix+path, dict(message='Update public market snapshot', content=base64.b64encode(payload).decode(),
                                  branch='feed',committer=committer))
    files = state.get('files', []) + [dict(path=path,sha=answer['content']['sha'])]
    # Unique URLs avoid the several-minute cache on mutable raw.githubusercontent URLs.
    # Keep a short rolling window in the branch rather than accumulating current files.
    while len(files)>20:
        old=files[0]
        try:
            api(prefix+old['path'],dict(message='Expire old market snapshot',sha=old['sha'],branch='feed',committer=committer),method='DELETE')
        except RuntimeError as exc:
            if '404' not in str(exc):
                break
        files.pop(0)
    return dict(files=files,bucket=bucket,digest=digest,updated_at=time.time(),
                source_updated=snapshot.get('generated_at'),bytes=len(payload))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', default=str(ROOT/'.local/publisher.json'))
    parser.add_argument('--watch', action='store_true')
    args = parser.parse_args()
    path = Path(args.config).resolve()
    config = json.loads(path.read_text())
    if not re.fullmatch(r'[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+', config['repository']):
        raise ValueError('Invalid repository')
    folder = path.parent
    with (folder/'publisher.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        (folder/'publisher.pid').write_text(str(__import__('os').getpid()))
        state_path = folder/'publisher-state.json'
        state = json.loads(state_path.read_text()) if state_path.exists() else {}
        while True:
            try:
                state = publish(config, state)
                temp=state_path.with_suffix('.tmp');temp.write_text(json.dumps(state, indent=2));temp.replace(state_path)
                print(time.strftime('%H:%M:%S')+' synced '+str(state['bytes'])+' bytes', flush=True)
            except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as exc:
                print(str(exc), flush=True)
                if not args.watch:
                    raise
            if not args.watch:
                return
            # Publish just after each 20-second boundary; clients read six seconds behind it.
            time.sleep(max(1,(int(time.time()//20)+1)*20+1-time.time()))


if __name__ == '__main__':
    main()
