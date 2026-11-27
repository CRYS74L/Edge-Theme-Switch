import ctypes as c
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import retain


class RetentionTests(unittest.TestCase):
    def test_watch_retries_access_denied_and_checks_new_processes_without_slowing_down(self):
        snapshots = [{10: 1, 11: 10}, {10: 1, 11: 10}, {10: 1, 11: 10},
                     {10: 1, 11: 10}, {10: 1, 11: 2}]
        attempts = []
        ticks = iter([0, 2, 4, 6, 8])
        elapsed = 0

        def wait_for_poll(_event, interval):
            nonlocal elapsed
            self.assertEqual(interval, 400)
            next_tick = next(ticks, None)
            if next_tick is None:
                return 0
            elapsed = next_tick
            return 258

        def attach(pid, *_args, ignored_pids, **_kwargs):
            attempts.append(pid)
            if pid == 10 and attempts.count(10) < 4:
                raise c.WinError(5)
            if pid == 11 and attempts.count(11) == 1:
                ignored_pids.add(pid)
                return None
            return {'pid': pid}

        with (patch.object(retain, 'wait', side_effect=wait_for_poll),
              patch.object(retain, 'edge_processes', side_effect=snapshots),
              patch.object(retain.time, 'monotonic', side_effect=lambda: elapsed),
              patch.object(retain, 'patch', side_effect=attach),
              patch.object(retain, 'open_process', return_value=None),
              patch.object(retain, 'log') as record):
            retain.watch_edge(None, None, 'a' * 32, None, False)
        self.assertEqual(attempts.count(10), 4)
        self.assertEqual(attempts.count(11), 2)
        self.assertEqual(
            [call.args[1]['pid'] for call in record.call_args_list if call.args[1]['event'] == 'protected'],
            [10, 11],
        )

    def test_stable_watch_wakes_on_browser_exit_and_stops_on_its_stop_event(self):
        with patch.object(retain, 'wait_multiple', side_effect=[1, 258, 0]) as wait_for_either:
            handles = {42: 9}
            self.assertTrue(retain.wait_for_poll(3, handles))
            self.assertTrue(retain.wait_for_poll(3, handles))
            self.assertFalse(retain.wait_for_poll(3, handles))
            count, waited_handles, wait_all, timeout = wait_for_either.call_args.args
            self.assertEqual((count, list(waited_handles), wait_all, timeout), (2, [3, 9], False, 1500))

    def test_only_the_selected_long_string_skips_the_original_call(self):
        selected = 'abcdefghijklmnopabcdefghijklmnop'
        original = c.CFUNCTYPE(c.c_int, c.c_void_p, c.c_void_p)(lambda _owner, _id: 77)
        stub = retain.build_stub(selected, c.cast(original, c.c_void_p).value)
        alloc = retain.api(retain.k, 'VirtualAlloc', c.c_void_p, c.c_void_p, c.c_size_t, retain.w.DWORD, retain.w.DWORD)
        release = retain.api(retain.k, 'VirtualFree', retain.w.BOOL, c.c_void_p, c.c_size_t, retain.w.DWORD)
        address = alloc(None, 4096, 0x3000, 0x40)
        retain.require(address)
        try:
            c.memmove(address, stub, len(stub))
            call = c.CFUNCTYPE(c.c_int, c.c_void_p, c.c_void_p)(address)

            def invoke(text, *, short=False, length=32):
                text_buffer = c.create_string_buffer(text.encode('ascii'))
                value = c.create_string_buffer(24)
                struct.pack_into('<QQQ', value, 0, c.addressof(text_buffer), length, 0 if short else 1 << 63)
                return call(None, c.addressof(value))

            self.assertEqual(invoke(selected), 0)
            self.assertEqual(invoke('bbcdefghijklmnopabcdefghijklmnop'), 77)
            self.assertEqual(invoke('abcdefghijklmnopabcdefghijklmnoa'), 77)
            self.assertEqual(invoke(selected, length=33), 77)
            self.assertEqual(invoke(selected, short=True), 77)
        finally:
            retain.require(release(address, 0, 0x8000))

    def test_unknown_binary_is_rejected_before_using_an_offset(self):
        with tempfile.TemporaryDirectory() as directory:
            dll = Path(directory) / '157.0.4341.60' / 'msedge.dll'
            dll.parent.mkdir()
            dll.write_bytes(b'not the supported Edge binary')
            with self.assertRaisesRegex(RuntimeError, 'Unsupported Edge DLL hash'):
                retain.original_bytes(dll)

    def test_future_build_is_rejected_even_if_its_dll_exists(self):
        with tempfile.TemporaryDirectory() as directory:
            dll = Path(directory) / '200.0.5000.0' / 'msedge.dll'
            dll.parent.mkdir()
            dll.write_bytes(b'not a reviewed Edge binary')
            with self.assertRaisesRegex(RuntimeError, 'Unsupported Edge build 200'):
                retain.original_bytes(dll)

    def test_invalid_identity_is_rejected(self):
        for value in ['', 'a' * 31, 'a' * 33, '0' * 32]:
            with self.assertRaises(ValueError):
                retain.build_stub(value, 0)


if __name__ == '__main__':
    unittest.main()
