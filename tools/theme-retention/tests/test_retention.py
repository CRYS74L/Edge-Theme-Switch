import ctypes as c
from pathlib import Path
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import retain


class RetentionTests(unittest.TestCase):
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
