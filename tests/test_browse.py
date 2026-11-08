# SPDX-License-Identifier: GPL-3.0-or-later
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from snapgent_mcp import browse


class ListDirsTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.home = Path(self._tmp.name).resolve()
        for name in ('b', 'A', '.hidden'):
            (self.home / name).mkdir()
        (self.home / 'c.txt').write_text('x', encoding='utf-8')

    def test_only_folder_names_come_back_sorted_without_regard_to_case(self):
        found = browse.list_dirs(str(self.home), home=self.home)
        self.assertEqual(found['dirs'], ['.hidden', 'A', 'b'])
        self.assertEqual((found['path'], found['parent'], found['home'], found['truncated']),
                         (str(self.home), str(self.home.parent), str(self.home), False))

    def test_no_path_means_the_home_folder(self):
        for nothing in (None, '', '   '):
            self.assertEqual(browse.list_dirs(nothing, home=self.home)['path'], str(self.home))

    def test_a_path_that_is_not_a_usable_folder_is_explained(self):
        for path, message in (('relative/dir', 'full path'), (str(self.home / 'missing'), 'does not exist'), (str(self.home / 'c.txt'), 'does not exist')):
            with self.assertRaisesRegex(ValueError, message, msg=path):
                browse.list_dirs(path, home=self.home)

    def test_a_huge_folder_is_cut_and_says_so(self):
        for index in range(5):
            (self.home / f'd{index}').mkdir()
        with mock.patch.object(browse, 'MAX_ENTRIES', 3):
            found = browse.list_dirs(str(self.home), home=self.home)
        self.assertEqual((len(found['dirs']), found['truncated']), (3, True))

    @unittest.skipIf(os.name == 'nt', 'posix root')
    def test_the_root_has_no_parent(self):
        self.assertIsNone(browse.list_dirs('/', home=self.home)['parent'])


if __name__ == '__main__':
    unittest.main()
