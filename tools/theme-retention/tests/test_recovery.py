import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import baseline


class RecoveryTests(unittest.TestCase):
    def test_damaged_backup_cannot_overwrite_the_current_plugin_or_change_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            current = root / 'current' / 'controller.txt'
            current.parent.mkdir()
            current.write_text('working plugin', 'utf-8')
            backup = root / 'backup'
            (backup / 'project').mkdir(parents=True)
            (backup / 'project' / 'controller.txt').write_text('damaged backup', 'utf-8')
            metadata = {
                'project': str(current.parent), 'profile': str(root / 'profile'),
                'sealed': True, 'browser_files': {},
                'files': {'controller.txt': hashlib.sha256(b'original snapshot').hexdigest()},
            }
            (backup / 'baseline.json').write_text(json.dumps(metadata), 'utf-8')
            with patch.object(baseline.subprocess, 'run') as elevate:
                with self.assertRaisesRegex(RuntimeError, 'Recovery verification failed'):
                    baseline.restore(backup)
                elevate.assert_not_called()
            self.assertEqual(current.read_text('utf-8'), 'working plugin')

    def test_a_partial_browser_snapshot_is_not_a_valid_recovery_point(self):
        with tempfile.TemporaryDirectory() as directory:
            metadata = {'files': {}, 'sealed': False}
            with self.assertRaisesRegex(RuntimeError, 'has not been sealed'):
                baseline.verify(Path(directory), metadata)


if __name__ == '__main__':
    unittest.main()
