# SPDX-License-Identifier: GPL-3.0-or-later
import json
import os
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path

from snapgent_bridge.ssh_bundle import Bundle, build_bundle
from snapgent_bridge.ssh_remote import (NOT_YOURS, RemoteError, archive_name, exists_command, prepare_remote, probe_command, serve_command,
                                        upload_command)

DIGEST = '0123456789abcdef'
BUNDLE = Bundle(b'zip-bytes', DIGEST)


class FakeShell:
    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []

    async def run(self, command, stdin=None, timeout=60.0):
        self.calls.append((command, stdin, timeout))
        return self.replies.pop(0)


class NameAndCommandTests(unittest.TestCase):
    def test_the_archive_name_must_come_from_a_hex_digest(self):
        self.assertEqual(archive_name(DIGEST), 'mcp-0123456789abcdef.zip')
        for bad in ('xyz', '0123456789ABCDEF', '../etc/passwd', '0123456789abcdef; rm -rf ~', '0123456789abcde', '', 5, None):
            with self.assertRaises(ValueError, msg=repr(bad)):
                archive_name(bad)

    def test_commands_are_one_sh_dash_c_whatever_shell_the_account_has(self):
        name = archive_name(DIGEST)
        for command in (exists_command(name), upload_command(name), serve_command(name), probe_command().replace('python3 -c', 'sh -c')):
            parts = shlex.split(command)
            self.assertEqual(parts[:2], ['sh', '-c'], command)
            self.assertEqual(len(parts), 3, command)

    def test_the_upload_checks_ownership_before_writing_and_moves_the_file_in_last(self):
        script = shlex.split(upload_command(archive_name(DIGEST)))[2]
        self.assertLess(script.index('-O'), script.index('mkdir'))
        self.assertIn('chmod 700', script)
        self.assertLess(script.index('.part'), script.index('mv -f'))
        self.assertIn(f'exit {NOT_YOURS}', script)

    def test_the_server_runs_in_isolated_mode_out_of_the_archive(self):
        inner = shlex.split(shlex.split(serve_command(archive_name(DIGEST)))[2])
        self.assertEqual(inner[:4], ['exec', 'python3', '-I', '-c'])
        self.assertIn('mcp-0123456789abcdef.zip', inner[4])
        self.assertIn('snapgent_mcp.server', inner[4])


class PrepareRemoteTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_server_without_the_archive_gets_it_and_the_name_comes_back(self):
        shell = FakeShell((0, b'3 12\n', b''), (1, b'', b''), (0, b'', b''))
        self.assertEqual(await prepare_remote(shell, BUNDLE), 'mcp-0123456789abcdef.zip')
        self.assertEqual(len(shell.calls), 3)
        self.assertEqual(shell.calls[2][1], b'zip-bytes')
        self.assertEqual(shell.calls[0][1], None)

    async def test_a_server_that_already_has_it_is_left_alone(self):
        shell = FakeShell((0, b'3 9\n', b''), (0, b'', b''))
        await prepare_remote(shell, BUNDLE)
        self.assertEqual(len(shell.calls), 2)

    async def test_a_login_banner_before_the_version_is_ignored(self):
        shell = FakeShell((0, b'Welcome 5 5\nnews: 1 2\n3 11\n', b''), (0, b'', b''))
        await prepare_remote(shell, BUNDLE)

    async def test_no_python_or_an_old_one_says_what_to_do(self):
        for reply, message in (((127, b'', b'python3: not found'), 'python3 was not found'), ((0, b'hello\n', b''), 'python3 was not found'),
                               ((0, b'3 8\n', b''), r'3\.8.*3\.9 or newer'), ((0, b'2 7\n', b''), r'2\.7')):
            with self.assertRaisesRegex(RemoteError, message):
                await prepare_remote(FakeShell(reply), BUNDLE)

    async def test_a_folder_that_is_not_the_users_and_a_failed_copy_are_reported(self):
        with self.assertRaisesRegex(RemoteError, 'belongs to someone else'):
            await prepare_remote(FakeShell((0, b'3 12\n', b''), (1, b'', b''), (NOT_YOURS, b'', b'x')), BUNDLE)
        with self.assertRaisesRegex(RemoteError, 'Could not copy.*No space left'):
            await prepare_remote(FakeShell((0, b'3 12\n', b''), (1, b'', b''), (1, b'', b'No space left on device')), BUNDLE)


@unittest.skipIf(os.name == 'nt', 'needs sh')
class RealShellTests(unittest.TestCase):
    """The same commands, run by a real sh with a home folder of its own: what the server would do."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.home = Path(self._tmp.name).resolve()
        self.env = {'HOME': str(self.home), 'PATH': os.environ.get('PATH', '/usr/bin:/bin')}
        self.name = archive_name(DIGEST)

    def sh(self, command, data=None):
        return subprocess.run(command, shell=True, input=data, capture_output=True, env=self.env, timeout=60)

    def test_the_upload_makes_a_private_folder_and_a_complete_file(self):
        self.assertNotEqual(self.sh(exists_command(self.name)).returncode, 0)
        self.assertEqual(self.sh(upload_command(self.name), b'hello').returncode, 0)
        folder = self.home / '.snapgent'
        self.assertEqual(folder.stat().st_mode & 0o777, 0o700)
        self.assertEqual((folder / self.name).read_bytes(), b'hello')
        self.assertEqual((folder / self.name).stat().st_mode & 0o077, 0, 'the file is private too')
        self.assertEqual([p.name for p in folder.iterdir()], [self.name], 'no half-written file is left behind')
        self.assertEqual(self.sh(exists_command(self.name)).returncode, 0)

    def test_a_folder_that_was_open_to_others_is_closed(self):
        folder = self.home / '.snapgent'
        folder.mkdir(mode=0o755)
        folder.chmod(0o755)
        self.assertEqual(self.sh(upload_command(self.name), b'x').returncode, 0)
        self.assertEqual(folder.stat().st_mode & 0o777, 0o700)

    def test_the_server_runs_out_of_the_uploaded_archive_and_answers_initialize(self):
        bundle = build_bundle()
        name = archive_name(bundle.digest)
        self.assertEqual(self.sh(upload_command(name), bundle.data).returncode, 0)
        request = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
                              'params': {'protocolVersion': '2024-11-05', 'capabilities': {}, 'clientInfo': {'name': 'test', 'version': '1'}}}) + '\n'
        done = self.sh(serve_command(name), request.encode('utf-8'))
        lines = done.stdout.decode('utf-8').splitlines()
        self.assertTrue(lines, done.stderr.decode('utf-8', 'replace'))
        reply = json.loads(lines[0])
        self.assertEqual(reply['id'], 1)
        self.assertIn('result', reply)


if __name__ == '__main__':
    unittest.main()
