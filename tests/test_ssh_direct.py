# SPDX-License-Identifier: GPL-3.0-or-later
"""DirectSshSession: one ssh per command, the way a machine without OpenSSH's shared connections (Windows) works.

The stand-in for ssh is a Python program, so the same test runs on every platform."""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from snapgent_bridge import ssh_direct, ssh_session
from snapgent_bridge.ssh_target import SshTarget

FAKE_SSH = '''# SPDX-License-Identifier: GPL-3.0-or-later
import os, sys
args = sys.argv[1:]
if "-V" in args:
    print("OpenSSH_for_Windows_9.5p1, LibreSSL 3.8.2")
    sys.exit(0)
if os.environ.get("FAKE_FAIL"):
    sys.stderr.write(os.environ["FAKE_FAIL"] + chr(10))
    sys.exit(255)
# Bytes, not print(): text mode would end the line with CR LF on Windows and the test would say nothing about ssh.
sys.stdout.buffer.write(b"ran:" + args[-1].encode() + bytes([10]))
sys.stdout.buffer.flush()
'''

TARGET = SshTarget('me', 'host')


class DirectSessionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.home = Path(self._tmp.name).resolve()
        self.fake = self.home / 'fake_ssh.py'
        self.fake.write_text(FAKE_SSH, encoding='utf-8')
        patcher = mock.patch.dict(os.environ, {'HOME': str(self.home), 'USERPROFILE': str(self.home)})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.session = ssh_direct.DirectSshSession(TARGET, ssh=[sys.executable, str(self.fake)])
        self.addAsyncCleanup(self.session.close)

    async def answer(self, _prompt):
        return None

    async def test_it_signs_in_runs_a_command_and_says_what_the_server_said(self):
        await self.session.connect(self.answer)
        self.assertTrue(self.session.alive)
        self.assertEqual(await self.session.run('printf hi'), (0, b'ran:printf hi\n', b''))
        self.assertEqual((await self.session.run('cat', stdin=b'from stdin'))[0], 0)

    async def test_a_refused_login_is_a_clear_error_and_leaves_nothing_open(self):
        with mock.patch.dict(os.environ, {'FAKE_FAIL': 'me@host: Permission denied (publickey).'}):
            with self.assertRaisesRegex(ssh_session.SshError, 'Permission denied'):
                await self.session.connect(self.answer)
        self.assertFalse(self.session.alive)
        with self.assertRaisesRegex(ssh_session.SshError, 'closed'):
            await self.session.run('true')

    async def test_the_mcp_entry_runs_one_ssh_per_message_and_never_asks(self):
        await self.session.connect(self.answer)
        config = self.session.server_config('echo hi')
        self.assertEqual(config['command'], sys.executable)
        self.assertEqual(config['args'][-1], 'echo hi')
        for wanted in ('-T', 'BatchMode=yes'):
            self.assertIn(wanted, config['args'])
        self.assertNotIn('ControlPath', ' '.join(config['args']))

    async def test_it_cannot_be_connected_twice_and_closing_twice_is_harmless(self):
        await self.session.connect(self.answer)
        with self.assertRaisesRegex(ssh_session.SshError, 'already open'):
            await self.session.connect(self.answer)
        await self.session.close()
        self.assertFalse(self.session.alive)
        await self.session.close()


class PlatformTests(unittest.TestCase):
    def test_every_machine_needs_the_ssh_program_and_nothing_else_rules_windows_out(self):
        self.assertIsNone(ssh_session.platform_problem(lambda name: '/usr/bin/ssh'))
        self.assertIn('not found', ssh_session.platform_problem(lambda name: None))
        self.assertIsNone(ssh_session.version_problem('OpenSSH_for_Windows_9.5p1, LibreSSL 3.8.2'))


if __name__ == '__main__':
    unittest.main()
