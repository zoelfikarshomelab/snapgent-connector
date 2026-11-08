# SPDX-License-Identifier: GPL-3.0-or-later
import hashlib
import io
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from snapgent_bridge.ssh_bundle import PACKAGE, build_bundle


class BundleTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.pkg = Path(self._tmp.name) / 'pkg'
        for name, text in (('b.py', 'x = 2\n'), ('a.py', 'x = 1\n'), ('sub/c.py', 'y = 1\n'), ('__pycache__/d.py', 'junk\n'), ('notes.txt', 'no\n')):
            path = self.pkg / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding='utf-8')

    def names(self, bundle):
        return zipfile.ZipFile(io.BytesIO(bundle.data)).namelist()

    def test_only_source_files_go_in_sorted_under_the_package_name(self):
        self.assertEqual(self.names(build_bundle(self.pkg)), [f'{PACKAGE}/a.py', f'{PACKAGE}/b.py', f'{PACKAGE}/sub/c.py'])

    def test_the_same_sources_give_the_same_bytes_and_a_changed_one_another_name(self):
        first, again = build_bundle(self.pkg), build_bundle(self.pkg)
        self.assertEqual((first.data, first.digest), (again.data, again.digest))
        self.assertEqual(first.digest, hashlib.sha256(first.data).hexdigest()[:16])
        (self.pkg / 'a.py').write_text('x = 100\n', encoding='utf-8')
        self.assertNotEqual(build_bundle(self.pkg).digest, first.digest)

    def test_the_real_server_is_in_it_and_python_runs_it_straight_from_the_archive(self):
        bundle = build_bundle()
        names = self.names(bundle)
        for wanted in ('server.py', 'browse.py', 'tools/reading.py', 'relations/engine.py'):
            self.assertIn(f'{PACKAGE}/{wanted}', names)
        archive = Path(self._tmp.name) / 'mcp.zip'
        archive.write_bytes(bundle.data)
        code = 'import sys; sys.path.insert(0, sys.argv[1]); import snapgent_mcp.server as s; print(s.__file__)'
        done = subprocess.run([sys.executable, '-I', '-c', code, str(archive)], capture_output=True, text=True, timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn('mcp.zip', done.stdout)


if __name__ == '__main__':
    unittest.main()
