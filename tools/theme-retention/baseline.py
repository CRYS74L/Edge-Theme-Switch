"""Local, hash-verified recovery for the policy-free theme trial."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import winreg

import retain

RUN_KEY = r'Software\Microsoft\Windows\CurrentVersion\Run'
RUN_NAME = 'EdgeThemeRetention'


def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def load(root):
    return json.loads((root / 'baseline.json').read_text('utf-8'))


def save(root, value):
    temp = root / 'baseline.next.json'
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), 'utf-8')
    temp.replace(root / 'baseline.json')


def require_closed(profile):
    for pid in retain.edge_pids():
        try:
            with retain.handle(retain.open_process(0x1000, False, pid)) as h:
                if retain.process_identity(h, profile) is not None:
                    raise RuntimeError('Close all windows and background processes of the target Edge profile first.')
        except OSError as error:
            if getattr(error, 'winerror', None) not in (5, 87):
                raise


def verify(root, data, profile=True):
    groups = [('project', data['files'])]
    if profile:
        if not data.get('sealed'):
            raise RuntimeError('The browser recovery snapshot has not been sealed.')
        groups.append(('browser', data['browser_files']))
    count = 0
    for folder, files in groups:
        for relative, expected in files.items():
            p = root / folder / relative
            if not p.is_file() or digest(p) != expected:
                raise RuntimeError(f'Recovery verification failed: {folder}/{relative}')
            count += 1
    return count


def seal(root):
    data = load(root)
    if data.get('sealed'):
        raise RuntimeError('This baseline is immutable and already sealed.')
    profile = Path(os.environ['LOCALAPPDATA']) / 'Microsoft/Edge/User Data'
    require_closed(profile)
    destination = root / 'browser'
    destination.mkdir(exist_ok=False)
    browser_files = {}
    for name in ['Default', 'Local State']:
        source = profile / name
        paths = source.rglob('*') if source.is_dir() else [source]
        for p in paths:
            if p.is_symlink():
                raise RuntimeError(f'Unexpected link in browser snapshot: {p}')
            if not p.is_file():
                continue
            relative = p.relative_to(profile)
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, target)
            source_hash = digest(p)
            if digest(target) != source_hash:
                raise RuntimeError(f'Cold snapshot copy mismatch: {relative}')
            browser_files[str(relative)] = source_hash
    data.update(profile=str(profile), browser_files=browser_files, sealed=True,
                sealed_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
    save(root, data)
    print(json.dumps({'sealed': True, 'files_verified': verify(root, data)}), flush=True)


def restore(root, rehearsal=None, skip_policy=False):
    data = load(root)
    count = verify(root, data)
    profile = rehearsal.resolve() if rehearsal else Path(data['profile']).resolve()
    require_closed(profile)
    if rehearsal:
        allowed = root.parent / 'rollback-rehearsal-profile'
        if profile != allowed.resolve():
            raise RuntimeError('Rehearsals must stay inside this task recovery directory.')
    elif skip_policy:
        raise RuntimeError('A real recovery must restore the original theme policy.')
    elif profile != (Path(os.environ['LOCALAPPDATA']) / 'Microsoft/Edge/User Data').resolve():
        raise RuntimeError('The recovery manifest does not belong to the current Windows user.')
    if not rehearsal:
        # Only the system-policy write needs elevation. Profile copies run as the original user.
        ps = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
        policy = Path(__file__).with_name('policy.ps1')
        arguments = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(policy),
                     '-Action', 'Restore', '-Baseline', str(root)]
        quoted = subprocess.list2cmdline(arguments).replace("'", "''")
        command = f"$p=Start-Process -FilePath '{ps}' -ArgumentList '{quoted}' -Verb RunAs -Wait -PassThru; exit $p.ExitCode"
        subprocess.run([str(ps), '-NoProfile', '-Command', command], check=True)
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            if data['run'] is None:
                try:
                    winreg.DeleteValue(key, RUN_NAME)
                except FileNotFoundError:
                    pass
            else:
                winreg.SetValueEx(key, RUN_NAME, 0, data['run']['kind'], data['run']['value'])
        event = retain.open_event(2, False, retain.event_name(profile))
        if event:
            with retain.handle(event):
                retain.require(retain.set_event(event))
            time.sleep(1)
        require_closed(profile)
    profile.mkdir(parents=True, exist_ok=True)
    current = profile / 'Default'
    if current.exists():
        saved = profile / ('Default.before-restore-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
        # Retain the newer profile too; recovery never discards subsequent browser data.
        if current.resolve().parent != profile or saved.resolve().parent != profile:
            raise RuntimeError('The recovery move must stay inside the verified browser directory.')
        current.rename(saved)
    shutil.copytree(root / 'browser' / 'Default', current)
    if rehearsal:
        shutil.copy2(root / 'browser' / 'Local State', profile / 'Local State')
    else:
        project = Path(data['project'])
        for relative in data['files']:
            target = project / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / 'project' / relative, target)
    for relative, expected in data['browser_files'].items():
        if relative == 'Local State' and not rehearsal:
            continue  # Preserve current global browser/account state; it was not modified by the trial.
        if digest(profile / relative) != expected:
            raise RuntimeError(f'Restored browser file mismatch: {relative}')
    if not rehearsal:
        for relative, expected in data['files'].items():
            if digest(Path(data['project']) / relative) != expected:
                raise RuntimeError(f'Restored project file mismatch: {relative}')
    print(json.dumps({'restored': True, 'rehearsal': bool(rehearsal), 'verified_snapshot_files': count}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['seal', 'verify', 'restore'])
    parser.add_argument('baseline', type=Path)
    parser.add_argument('--rehearsal', type=Path)
    args = parser.parse_args()
    root = args.baseline.resolve()
    if args.action == 'seal':
        seal(root)
    elif args.action == 'verify':
        print(json.dumps({'verified': True, 'file_count': verify(root, load(root))}))
    else:
        restore(root, args.rehearsal)


if __name__ == '__main__':
    main()
