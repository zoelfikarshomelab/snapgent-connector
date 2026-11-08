# SPDX-License-Identifier: GPL-3.0-or-later
"""SshSession against a stand-in for ssh: a script that acts as the master (it asks through SSH_ASKPASS, then holds a control file),
answers `-O check` and `-O exit`, and runs a command on the server by running it here with sh. Everything else is the real code:
the askpass socket, the helper program, the control folder and the processes."""

import asyncio
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from snapgent_bridge import ssh_session
from snapgent_bridge.askpass import SECRET
from snapgent_bridge.ssh_bundle import build_bundle
from snapgent_bridge.ssh_remote import prepare_remote, serve_command
from snapgent_bridge.ssh_target import SshTarget

FAKE_SSH = '''#!%(python)s
import os, signal, subprocess, sys, time
args = sys.argv[1:]


def option(name):
    for index, item in enumerate(args):
        if item == "-o" and index + 1 < len(args) and args[index + 1].startswith(name + "="):
            return args[index + 1].split("=", 1)[1]


control = option("ControlPath")
if "-V" in args:
    print(os.environ.get("FAKE_VERSION", "OpenSSH_9.6p1, OpenSSL 3.0"))
    sys.exit(0)
if "-M" in args:
    prompt = os.environ.get("FAKE_PROMPT")
    if prompt:
        done = subprocess.run([os.environ["SSH_ASKPASS"], prompt], capture_output=True, text=True)
        if done.returncode != 0 or done.stdout.strip() != os.environ.get("FAKE_EXPECT", ""):
            sys.stderr.write("me@host: Permission denied (publickey).\\n")
            sys.exit(255)
    open(control, "w").close()
    signal.signal(signal.SIGTERM, lambda *_: (os.path.exists(control) and os.remove(control), sys.exit(0)))
    while os.path.exists(control):
        time.sleep(0.05)
    sys.exit(0)
if "-O" in args:
    if not control or not os.path.exists(control):
        sys.exit(255)
    if args[args.index("-O") + 1] == "exit":
        os.remove(control)
    sys.exit(0)
os.execvp("sh", ["sh", "-c", args[-1]])
'''

TARGET = SshTarget('me', 'host')


@unittest.skipIf(os.name == 'nt', 'needs unix sockets and sh')
class SessionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.home = Path(self._tmp.name).resolve()
        self.fake = self.home / 'ssh'
        self.fake.write_text(FAKE_SSH % {'python': sys.executable}, encoding='utf-8')
        self.fake.chmod(self.fake.stat().st_mode | stat.S_IXUSR)
        patcher = mock.patch.dict(os.environ, {'HOME': str(self.home)})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.session = ssh_session.SshSession(TARGET, ssh=str(self.fake))
        self.addAsyncCleanup(self.session.close)
        self.asked = []

    def answer(self, value):
        async def ask(prompt):
            self.asked.append(prompt)
            return value
        return ask

    async def test_signing_in_without_a_question_and_running_commands_through_the_connection(self):
        await self.session.connect(self.answer('never asked'))
        self.assertTrue(self.session.alive)
        self.assertEqual(self.asked, [])
        self.assertEqual(await self.session.run('printf hi'), (0, b'hi', b''))
        code, out, _ = await self.session.run('cat', stdin=b'from stdin')
        self.assertEqual((code, out), (0, b'from stdin'))
        self.assertEqual((await self.session.run('exit 3'))[0], 3)

    async def test_the_control_folder_is_private_and_goes_away_with_the_connection(self):
        await self.session.connect(self.answer(None))
        folder = Path(self.session.control_path).parent
        self.assertEqual(folder.stat().st_mode & 0o777, 0o700)
        await self.session.close()
        self.assertFalse(folder.exists())
        self.assertFalse(self.session.alive)
        await self.session.close()  # closing twice is harmless

    async def test_a_passphrase_is_asked_through_the_popup_and_reaches_ssh(self):
        with mock.patch.dict(os.environ, {'FAKE_PROMPT': "Enter passphrase for key 'k':", 'FAKE_EXPECT': 'hunter2'}):
            await self.session.connect(self.answer('hunter2'))
        self.assertTrue(self.session.alive)
        self.assertEqual([(p.text, p.kind) for p in self.asked], [("Enter passphrase for key 'k':", SECRET)])

    async def test_cancelling_the_question_says_so(self):
        with mock.patch.dict(os.environ, {'FAKE_PROMPT': 'Enter passphrase:', 'FAKE_EXPECT': 'x'}):
            with self.assertRaisesRegex(ssh_session.SshError, 'Connection cancelled'):
                await self.session.connect(self.answer(None))
        self.assertFalse(self.session.alive)
        self.assertIsNone(self.session._dir, 'nothing is left behind')

    async def test_a_wrong_passphrase_shows_what_ssh_said(self):
        with mock.patch.dict(os.environ, {'FAKE_PROMPT': 'Enter passphrase:', 'FAKE_EXPECT': 'right'}):
            with self.assertRaisesRegex(ssh_session.SshError, 'Permission denied'):
                await self.session.connect(self.answer('wrong'))

    async def test_a_connection_that_dies_is_noticed_and_nothing_runs_on_it(self):
        await self.session.connect(self.answer(None))
        self.session._master.kill()
        await self.session._master.wait()
        self.assertFalse(self.session.alive)
        with self.assertRaisesRegex(ssh_session.SshError, 'closed'):
            await self.session.run('true')

    async def test_it_cannot_be_connected_twice(self):
        await self.session.connect(self.answer(None))
        with self.assertRaisesRegex(ssh_session.SshError, 'already open'):
            await self.session.connect(self.answer(None))

    async def test_ssh_that_cannot_be_started_is_a_clear_error(self):
        session = ssh_session.SshSession(TARGET, ssh=str(self.home / 'missing-ssh'))
        with self.assertRaisesRegex(ssh_session.SshError, 'could not be started'):
            await session.connect(self.answer(None))

    async def test_the_mcp_server_entry_runs_the_command_through_the_connection(self):
        await self.session.connect(self.answer(None))
        config = self.session.server_config('echo hi')
        self.assertEqual((config['command'], config['args'][-1], config['env']), (str(self.fake), 'echo hi', {}))
        self.assertIn('BatchMode=yes', config['args'])

    async def test_the_server_is_put_on_the_machine_and_answers_over_the_connection(self):
        await self.session.connect(self.answer(None))
        bundle = build_bundle()
        name = await prepare_remote(self.session, bundle)
        self.assertTrue((self.home / '.snapgent' / name).is_file())
        request = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\n'.encode('utf-8')
        code, out, err = await self.session.run(serve_command(name), stdin=request)
        self.assertIn(b'"read_files"', out, err)
        again = await prepare_remote(self.session, bundle)
        self.assertEqual(again, name)


class VersionTests(unittest.TestCase):
    def test_only_a_new_enough_openssh_is_accepted(self):
        self.assertIsNone(ssh_session.version_problem('OpenSSH_9.6p1 Ubuntu-3ubuntu13, OpenSSL 3.0.13'))
        self.assertIsNone(ssh_session.version_problem('OpenSSH_8.4p1, OpenSSL 1.1.1'))
        self.assertIn('too old', ssh_session.version_problem('OpenSSH_8.3p1, OpenSSL 1.1.1'))
        self.assertIn('too old', ssh_session.version_problem('OpenSSH_7.9p1'))
        self.assertIn('Only OpenSSH', ssh_session.version_problem('Dropbear v2022.83'))
        self.assertIn('Only OpenSSH', ssh_session.version_problem(''))


@unittest.skipIf(os.name == 'nt', 'needs an executable script')
class SshProblemTests(unittest.IsolatedAsyncioTestCase):
    async def test_the_installed_ssh_is_asked_for_its_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp) / 'ssh'
            fake.write_text(FAKE_SSH % {'python': sys.executable}, encoding='utf-8')
            fake.chmod(0o755)
            self.assertIsNone(await ssh_session.ssh_problem(str(fake)))
            with mock.patch.dict(os.environ, {'FAKE_VERSION': 'OpenSSH_7.4p1'}):
                self.assertIn('too old', await ssh_session.ssh_problem(str(fake)))
            self.assertIn('could not be started', await ssh_session.ssh_problem(str(Path(tmp) / 'missing')))


if __name__ == '__main__':
    unittest.main()
