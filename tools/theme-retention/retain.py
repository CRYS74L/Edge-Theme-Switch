"""Retain one ordinary theme in verified Edge builds (Windows x64)."""
import argparse
from contextlib import contextmanager
import ctypes as c
from ctypes import wintypes as w
from dataclasses import dataclass
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import sys
import time
import traceback

@dataclass(frozen=True)
class EdgeBuild:
    sha256: str
    collector_rva: int
    call_rva: int
    uninstall_rva: int
    collector_prefix: bytes
    legacy_notification: tuple[int, bytes] | None = None


BUILDS = {
    '139.0.3405.111': EdgeBuild(
        '3e9aa6cff358d7c6dd954b7a86b54ebe7c5ea08b63acecb373f88418d63687ba',
        0x3ECEFF0, 0x3ECF210, 0x6D5BCF0,
        bytes.fromhex('4157415641554154565755534881ecb8000000'),
        (0x9FEE9C0, bytes.fromhex('41565657534883ec68')),
    ),
    '156.0.4314.84': EdgeBuild(
        '165bf73ec52fde3e1127f982d89aef52c908b446c4dfae7881a5ea8cb5d7fa2f',
        0x42AA007, 0x42AA03E, 0x7F6BA40,
        bytes.fromhex('488b8c24c80000004831e1e8d9a14dff'),
    ),
    '157.0.4341.60': EdgeBuild(
        'e4c51cda4e2bc9f3896f23b14bc35166941d6c4e799428c76d64a7d55163d09d',
        0x42D197D, 0x42D19B4, 0x807F010,
        bytes.fromhex('488b8c24c80000004831e1e8b3e34eff'),
    ),
}

DEFAULT_CONFIG = Path(__file__).resolve().parents[2] / '.native-host' / 'retention.json'
DEFAULT_EXE = Path(os.environ['ProgramFiles(x86)']) / 'Microsoft/Edge/Application/msedge.exe'
DEFAULT_PROFILE = Path(os.environ['LOCALAPPDATA']) / 'Microsoft/Edge/User Data'
k = c.WinDLL('kernel32', use_last_error=True)
nt = c.WinDLL('ntdll')
shell = c.WinDLL('shell32', use_last_error=True)


def api(lib, name, result, *args):
    fn = getattr(lib, name)
    fn.restype, fn.argtypes = result, args
    return fn


open_process = api(k, 'OpenProcess', w.HANDLE, w.DWORD, w.BOOL, w.DWORD)
close = api(k, 'CloseHandle', w.BOOL, w.HANDLE)
snapshot = api(k, 'CreateToolhelp32Snapshot', w.HANDLE, w.DWORD, w.DWORD)
image_name = api(k, 'QueryFullProcessImageNameW', w.BOOL, w.HANDLE, w.DWORD, w.LPWSTR, c.POINTER(w.DWORD))
read_process = api(k, 'ReadProcessMemory', w.BOOL, w.HANDLE, c.c_void_p, c.c_void_p, c.c_size_t, c.POINTER(c.c_size_t))
write_process = api(k, 'WriteProcessMemory', w.BOOL, w.HANDLE, c.c_void_p, c.c_void_p, c.c_size_t, c.POINTER(c.c_size_t))
protect = api(k, 'VirtualProtectEx', w.BOOL, w.HANDLE, c.c_void_p, c.c_size_t, w.DWORD, c.POINTER(w.DWORD))
allocate = api(k, 'VirtualAllocEx', c.c_void_p, w.HANDLE, c.c_void_p, c.c_size_t, w.DWORD, w.DWORD)
free = api(k, 'VirtualFreeEx', w.BOOL, w.HANDLE, c.c_void_p, c.c_size_t, w.DWORD)
flush = api(k, 'FlushInstructionCache', w.BOOL, w.HANDLE, c.c_void_p, c.c_size_t)
query_info = api(nt, 'NtQueryInformationProcess', c.c_long, w.HANDLE, w.ULONG, c.c_void_p, w.ULONG, c.POINTER(w.ULONG))
get_times = api(k, 'GetProcessTimes', w.BOOL, w.HANDLE, c.POINTER(w.FILETIME), c.POINTER(w.FILETIME), c.POINTER(w.FILETIME), c.POINTER(w.FILETIME))
open_thread = api(k, 'OpenThread', w.HANDLE, w.DWORD, w.BOOL, w.DWORD)
suspend = api(k, 'SuspendThread', w.DWORD, w.HANDLE)
resume = api(k, 'ResumeThread', w.DWORD, w.HANDLE)
thread_context = api(k, 'GetThreadContext', w.BOOL, w.HANDLE, c.c_void_p)
create_event = api(k, 'CreateEventW', w.HANDLE, c.c_void_p, w.BOOL, w.BOOL, w.LPCWSTR)
open_event = api(k, 'OpenEventW', w.HANDLE, w.DWORD, w.BOOL, w.LPCWSTR)
set_event = api(k, 'SetEvent', w.BOOL, w.HANDLE)
wait = api(k, 'WaitForSingleObject', w.DWORD, w.HANDLE, w.DWORD)
split_command = api(shell, 'CommandLineToArgvW', c.POINTER(w.LPWSTR), w.LPCWSTR, c.POINTER(c.c_int))
local_free = api(k, 'LocalFree', c.c_void_p, c.c_void_p)


class ProcessEntry(c.Structure):
    _fields_ = [('size', w.DWORD), ('usage', w.DWORD), ('pid', w.DWORD),
                ('heap', c.c_size_t), ('module', w.DWORD), ('threads', w.DWORD),
                ('parent', w.DWORD), ('priority', w.LONG), ('flags', w.DWORD), ('name', w.WCHAR * 260)]


class ModuleEntry(c.Structure):
    _fields_ = [('size', w.DWORD), ('module', w.DWORD), ('pid', w.DWORD),
                ('global_usage', w.DWORD), ('usage', w.DWORD), ('base', c.c_void_p),
                ('module_size', w.DWORD), ('handle', w.HMODULE), ('name', w.WCHAR * 256), ('path', w.WCHAR * 260)]


class ThreadEntry(c.Structure):
    _fields_ = [('size', w.DWORD), ('usage', w.DWORD), ('tid', w.DWORD), ('pid', w.DWORD),
                ('priority', w.LONG), ('delta', w.LONG), ('flags', w.DWORD)]


class UnicodeString(c.Structure):
    _fields_ = [('length', w.USHORT), ('maximum', w.USHORT), ('buffer', c.c_void_p)]


for prefix, typ in [('Process32', ProcessEntry), ('Module32', ModuleEntry)]:
    for suffix in ['FirstW', 'NextW']:
        api(k, prefix + suffix, w.BOOL, w.HANDLE, c.POINTER(typ))
for suffix in ['First', 'Next']:
    api(k, 'Thread32' + suffix, w.BOOL, w.HANDLE, c.POINTER(ThreadEntry))


def require(ok):
    if not ok:
        raise c.WinError(c.get_last_error())


@contextmanager
def handle(value):
    if not value or value == c.c_void_p(-1).value:
        raise c.WinError(c.get_last_error())
    try:
        yield value
    finally:
        close(value)


def entries(flag, pid, typ, first, next_fn):
    # The loader may change its DLL list while Edge is starting.
    for attempt in range(5):
        candidate = snapshot(flag, pid)
        if candidate != c.c_void_p(-1).value or c.get_last_error() != 24 or attempt == 4:
            break
        time.sleep(0.025)
    with handle(candidate) as h:
        item = typ()
        item.size = c.sizeof(item)
        more = first(h, c.byref(item))
        while more:
            yield item
            more = next_fn(h, c.byref(item))


def edge_pids():
    return [x.pid for x in entries(2, 0, ProcessEntry, k.Process32FirstW, k.Process32NextW)
            if x.name.lower() == 'msedge.exe']


def command_line(h):
    size = w.ULONG()
    query_info(h, 60, None, 0, c.byref(size))
    buf = c.create_string_buffer(size.value)
    status = query_info(h, 60, buf, len(buf), c.byref(size))
    if status:
        raise RuntimeError(f'Cannot read process command line: {status & 0xffffffff:#x}')
    value = UnicodeString.from_buffer(buf)
    return c.wstring_at(value.buffer, value.length // 2)


def process_identity(h, profile, executable=DEFAULT_EXE):
    text = c.create_unicode_buffer(32768)
    length = w.DWORD(len(text))
    require(image_name(h, 0, text, c.byref(length)))
    expected = executable
    if Path(text.value).resolve() != expected.resolve():
        return None
    cmd = command_line(h)
    count = c.c_int()
    argv = split_command(cmd, c.byref(count))
    require(argv)
    try:
        args = [argv[i] for i in range(count.value)]
    finally:
        local_free(argv)
    if any(x.startswith('--type=') for x in args):
        return None
    explicit = next((x.split('=', 1)[1] for x in args if x.startswith('--user-data-dir=')), None)
    if not explicit and expected != DEFAULT_EXE:
        return None
    actual = Path(explicit) if explicit else DEFAULT_PROFILE
    if actual.resolve() != profile.resolve():
        return None
    times = [w.FILETIME() for _ in range(4)]
    require(get_times(h, *(c.byref(x) for x in times)))
    stamp = (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
    return expected, stamp


def read(h, address, size):
    buf, done = c.create_string_buffer(size), c.c_size_t()
    require(read_process(h, address, buf, size, c.byref(done)))
    if done.value != size:
        raise RuntimeError('Incomplete process memory read.')
    return buf.raw


def write(h, address, data):
    buf, done = c.create_string_buffer(data), c.c_size_t()
    require(write_process(h, address, buf, len(data), c.byref(done)))
    if done.value != len(data) or read(h, address, len(data)) != data:
        raise RuntimeError('Process memory write verification failed.')


def build_stub(theme_id, uninstall_address):
    if not re.fullmatch('[a-p]{32}', theme_id):
        raise ValueError('Expected a 32-character extension identity.')
    stub, branches = bytearray(), []

    def branch(opcode):
        stub.extend([opcode, 0])
        branches.append(len(stub) - 1)

    # libc++ string: a 32-character extension ID uses the long representation.
    stub.extend(bytes.fromhex('807a1700'))
    branch(0x79)
    stub.extend(bytes.fromhex('48837a0820'))
    branch(0x75)
    stub.extend(bytes.fromhex('488b02'))
    for offset in range(0, 32, 8):
        stub.extend(bytes.fromhex('49ba') + theme_id[offset:offset + 8].encode('ascii'))
        stub.extend(bytes.fromhex('4c3910') if offset == 0 else bytes.fromhex('4c3950') + bytes([offset]))
        branch(0x75)
    stub.extend(bytes.fromhex('31c0c3'))
    fallback = len(stub)
    stub.extend(bytes.fromhex('48b8') + struct.pack('<Q', uninstall_address) + bytes.fromhex('ffe0'))
    for at in branches:
        stub[at] = fallback - at - 1
    return bytes(stub)


def original_bytes(dll):
    stat = dll.stat()
    return verified_binary(str(dll.resolve()), stat.st_size, stat.st_mtime_ns)


@lru_cache(maxsize=2)
def verified_binary(path, size, modified):
    dll = Path(path)
    version = dll.parent.name
    build = BUILDS.get(version)
    if build is None:
        raise RuntimeError(f'Unsupported Edge build {version}; no process memory was changed.')
    with dll.open('rb') as f:
        if hashlib.file_digest(f, 'sha256').hexdigest() != build.sha256:
            raise RuntimeError('Unsupported Edge DLL hash; no process memory was changed.')
    with dll.open('rb') as f:
        f.seek(0x3c)
        pe = struct.unpack('<I', f.read(4))[0]
        f.seek(pe + 6)
        count = struct.unpack('<H', f.read(2))[0]
        f.seek(pe + 20)
        optional = struct.unpack('<H', f.read(2))[0]
        f.seek(pe + 24 + optional)
        raw = None
        for _ in range(count):
            section = f.read(40)
            virtual_size, virtual, size, offset = struct.unpack_from('<IIII', section, 8)
            if virtual <= build.collector_rva < virtual + size:
                raw = offset + build.collector_rva - virtual
        if raw is None:
            raise RuntimeError('Verified function is outside the image sections.')
        f.seek(raw)
        prefix = f.read(64)
        if not prefix.startswith(build.collector_prefix):
            raise RuntimeError('Unsupported theme collector signature.')
        f.seek(raw + build.call_rva - build.collector_rva)
        call = f.read(5)
        if call[0] != 0xe8 or build.call_rva + 5 + struct.unpack_from('<i', call, 1)[0] != build.uninstall_rva:
            raise RuntimeError('Unsupported theme collector call site.')
    return build, prefix, call


@contextmanager
def paused_threads(pid, address, extra_ranges=()):
    held = []
    try:
        tids = [x.tid for x in entries(4, 0, ThreadEntry, k.Thread32First, k.Thread32Next) if x.pid == pid]
        for tid in tids:
            h = open_thread(0x4a, False, tid)
            if not h:
                if c.get_last_error() == 87:  # Thread exited after enumeration.
                    continue
                raise c.WinError(c.get_last_error())
            if suspend(h) == 0xffffffff:
                close(h)
                raise c.WinError(c.get_last_error())
            held.append(h)
            buf = c.create_string_buffer(1248)
            aligned = (c.addressof(buf) + 15) & ~15
            c.c_uint32.from_address(aligned + 48).value = 0x100001
            require(thread_context(h, aligned))
            rip = c.c_uint64.from_address(aligned + 248).value
            if any(start <= rip < start + length for start, length in [(address, 5), *extra_ranges]):
                raise RuntimeError('A browser thread is at the patch site; retry on a later poll.')
        yield
    finally:
        for h in reversed(held):
            resume(h)
            close(h)


def patch(pid, profile, theme_id, suppress_outdated=False, executable=DEFAULT_EXE):
    with handle(open_process(0x1438, False, pid)) as h:
        identity = process_identity(h, profile, executable)
        if identity is None:
            return None
        exe, stamp = identity
        age = time.time() - (stamp / 10000000 - 11644473600)
        module = next((x for x in entries(0x18, pid, ModuleEntry, k.Module32FirstW, k.Module32NextW)
                       if x.name.lower() == 'msedge.dll'), None)
        if module is None:
            return None
        dll = Path(module.path)
        if dll.resolve().parent not in (exe.parent.resolve(), (exe.parent / dll.parent.name).resolve()):
            raise RuntimeError('The browser DLL is outside the selected Edge installation.')
        build, prefix, original = original_bytes(dll)
        site = module.base + build.call_rva
        current_call = read(h, site, len(original))
        collector_prefix = read(h, module.base + build.collector_rva, len(prefix))
        offset = build.call_rva - build.collector_rva
        # Some builds' verified prefix includes the one call we replace.
        if offset < len(prefix):
            collector_prefix = (collector_prefix[:offset] + original +
                                collector_prefix[offset + len(original):])[:len(prefix)]
        if collector_prefix != prefix:
            raise RuntimeError('Collector entry no longer matches the verified DLL.')
        suppress_outdated = bool(suppress_outdated and build.legacy_notification)
        if suppress_outdated:
            rva, outdated_prefix = build.legacy_notification
            outdated_site = module.base + rva
            detector = read(h, outdated_site, len(outdated_prefix))

        result = {'pid': pid, 'created': stamp, 'theme_id': theme_id, 'edge_build': dll.parent.name,
                  'site': site, 'original_call': original.hex(), 'age_seconds': round(age, 3),
                  'verified': True, 'outdated_notification_suppressed': suppress_outdated}
        stub = build_stub(theme_id, module.base + build.uninstall_rva)
        if current_call != original:
            # A helper restart should recognize its own patch and leave it in place.
            if current_call[0] != 0xe8:
                raise RuntimeError('Collector call site was changed by another program.')
            address = site + 5 + struct.unpack_from('<i', current_call, 1)[0]
            if read(h, address, len(stub)) != stub:
                raise RuntimeError('Collector call does not match this theme protection.')
            if suppress_outdated and detector != b'\xc3' + outdated_prefix[1:]:
                raise RuntimeError('Outdated-notification detector no longer matches this configuration.')
            return {**result, 'allocation': address, 'patched_call': current_call.hex(), 'already_active': True}
        if suppress_outdated and detector != outdated_prefix:
            raise RuntimeError('Outdated-notification detector was already changed.')
        allocation = None
        call_written = False
        try:
            start = (module.base + module.module_size + 0xffff) & ~0xffff
            for index in range(4096):
                candidate = start + index * 0x10000
                if not -(2**31) <= candidate - site - 5 < 2**31:
                    break
                allocation = allocate(h, candidate, 4096, 0x3000, 4)
                if allocation:
                    break
            if not allocation:
                raise RuntimeError('Cannot allocate a nearby theme retention stub.')
            write(h, allocation, stub)
            old = w.DWORD()
            require(protect(h, allocation, 4096, 0x20, c.byref(old)))
            require(flush(h, allocation, len(stub)))
            replacement = b'\xe8' + struct.pack('<i', allocation - site - 5)
            extra = [(outdated_site, len(outdated_prefix))] if suppress_outdated else []
            with paused_threads(pid, site, extra):
                if read(h, site, 5) != original:
                    raise RuntimeError('Collector changed during installation.')
                require(protect(h, site, 5, 0x40, c.byref(old)))
                try:
                    if suppress_outdated:
                        detector_protection = w.DWORD()
                        require(protect(h, outdated_site, 1, 0x40, c.byref(detector_protection)))
                        try:
                            write(h, outdated_site, b'\xc3')
                            require(flush(h, outdated_site, 1))
                        finally:
                            discarded = w.DWORD()
                            require(protect(h, outdated_site, 1, detector_protection.value, c.byref(discarded)))
                    # Retain the allocation even if verification fails after a partial write.
                    call_written = True
                    write(h, site, replacement)
                    require(flush(h, site, 5))
                except BaseException:
                    write(h, site, original)
                    require(flush(h, site, 5))
                    call_written = False
                    if suppress_outdated and read(h, outdated_site, 1) == b'\xc3':
                        detector_protection = w.DWORD()
                        require(protect(h, outdated_site, 1, 0x40, c.byref(detector_protection)))
                        try:
                            write(h, outdated_site, outdated_prefix[:1])
                            require(flush(h, outdated_site, 1))
                        finally:
                            discarded = w.DWORD()
                            require(protect(h, outdated_site, 1, detector_protection.value, c.byref(discarded)))
                    raise
                finally:
                    discarded = w.DWORD()
                    require(protect(h, site, 5, old.value, c.byref(discarded)))
            return {**result, 'allocation': allocation, 'patched_call': replacement.hex(), 'already_active': False}
        finally:
            if allocation and not call_written:
                require(free(h, allocation, 0, 0x8000))


def event_name(profile):
    suffix = hashlib.sha256(str(profile.resolve()).casefold().encode()).hexdigest()[:20]
    return 'Local\\EdgeThemeRetention-' + suffix


def log(state_dir, event):
    state_dir.mkdir(parents=True, exist_ok=True)
    event['time'] = time.time()
    p = state_dir / 'retention.log'
    if p.exists() and p.stat().st_size > 2_000_000:
        p.replace(state_dir / 'retention.previous.log')
    with p.open('a', encoding='utf-8') as f:
        f.write(json.dumps(event, ensure_ascii=False) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=DEFAULT_CONFIG)
    parser.add_argument('--once', type=int)
    parser.add_argument('--stop', action='store_true')
    parser.add_argument('--check-dll', type=Path)
    parser.add_argument('--list-builds', action='store_true')
    args = parser.parse_args()
    if args.list_builds:
        print('\n'.join(BUILDS))
        return
    if args.check_dll:
        original_bytes(args.check_dll)
        print(args.check_dll.parent.name)
        return
    config = json.loads(args.config.read_text('utf-8-sig'))
    profile = Path(config['profile'])
    theme = config['theme_id']
    state_dir = Path(config['state_dir'])
    executable = Path(config.get('executable', DEFAULT_EXE)).resolve()
    if executable != DEFAULT_EXE.resolve() and (not args.once or profile.resolve() == DEFAULT_PROFILE.resolve()):
        raise ValueError('Alternate executable paths are for a one-time test of an isolated browser only.')
    suppress_outdated = config.get('suppress_outdated_notification', False)
    if not re.fullmatch('[a-p]{32}', theme):
        raise ValueError('Invalid theme ID in retention configuration.')
    name = event_name(profile)
    if args.stop:
        h = open_event(2, False, name)
        if h:
            with handle(h):
                require(set_event(h))
        return
    if args.once:
        result = patch(args.once, profile, theme, suppress_outdated=suppress_outdated, executable=executable)
        if result is None:
            raise RuntimeError('The supplied PID is not an eligible browser.')
        print(json.dumps(result))
        return
    with handle(create_event(None, True, False, name)) as event:
        if c.get_last_error() == 183:
            return
        log(state_dir, {'event': 'watch-started', 'helper_pid': os.getpid()})
        done, failures = set(), {}
        while wait(event, 400) == 258:
            live = set(edge_pids())
            done.intersection_update(live)
            failures = {pid: message for pid, message in failures.items() if pid in live}
            for pid in live - done:
                try:
                    result = patch(pid, profile, theme, suppress_outdated=suppress_outdated)
                    if result:
                        done.add(pid)
                        log(state_dir, {'event': 'protected', **result})
                except (OSError, RuntimeError) as error:
                    message = str(error)
                    if failures.get(pid) != message:
                        failures[pid] = message
                        log(state_dir, {'event': 'not-protected', 'pid': pid, 'error': message, 'details': traceback.format_exc()})
        log(state_dir, {'event': 'watch-stopped'})


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        if sys.stderr is not None:
            print(f'Theme retention failed: {error}', file=sys.stderr)
        raise
