# SPDX-License-Identifier: GPL-3.0-or-later
import asyncio
import io
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from snapgent_bridge import askpass_helper
from snapgent_bridge.askpass import CONFIRM, INFO, MAX_ANSWER_CHARS, MAX_PROMPT_CHARS, SECRET, AskpassBroker, Prompt, classify_prompt


class ClassifyTests(unittest.TestCase):
    def test_a_yes_no_question_is_a_confirmation_and_anything_else_unknown_is_hidden(self):
        self.assertEqual(classify_prompt("Enter passphrase for key '/home/me/.ssh/id_ed25519':", ''), SECRET)
        self.assertEqual(classify_prompt('me@host password:', None), SECRET)
        self.assertEqual(classify_prompt('Are you sure you want to continue connecting (yes/no/[fingerprint])?', ''), CONFIRM)
        self.assertEqual(classify_prompt('Continue?', 'confirm'), CONFIRM)
        self.assertEqual(classify_prompt('Some notice', 'none'), INFO)


class EntryPointTests(unittest.TestCase):
    def test_the_program_knows_it_is_the_helper_from_the_token_ssh_was_given(self):
        import snapgent
        import snapgent_bridge.askpass_helper as helper
        seen = []
        real = helper.main
        helper.main = lambda argv: (seen.append(list(argv)), 0)[1]
        try:
            with mock.patch.dict(os.environ, {helper.TOKEN_VARIABLE: 't'}):
                self.assertEqual(snapgent.main(["me@host's password:"]), 0)
            with mock.patch.dict(os.environ, {}, clear=False):
                os.environ.pop(helper.TOKEN_VARIABLE, None)
                self.assertFalse(snapgent._is_askpass_invocation(['--mcp']))
                self.assertFalse(snapgent._is_askpass_invocation(['prompt']))
        finally:
            helper.main = real
        self.assertEqual(seen, [["me@host's password:"]])


class HelperTests(unittest.TestCase):
    def test_without_the_bridge_it_fails_quietly_and_prints_nothing(self):
        out = io.StringIO()
        self.assertEqual(askpass_helper.main(['p'], env={}, out=out), 1)
        env = {askpass_helper.SOCKET_VARIABLE: '/nonexistent/socket', askpass_helper.TOKEN_VARIABLE: 't'}
        self.assertEqual(askpass_helper.main(['p'], env=env, out=out), 1)
        self.assertEqual(out.getvalue(), '')


@unittest.skipIf(os.name == 'nt', 'needs unix sockets')
class BrokerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix='sg-', dir='/tmp'))
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.asked = []
        self.reply = 'hunter2'

        async def ask(prompt):
            self.asked.append(prompt)
            return self.reply

        self.broker = AskpassBroker(ask, lambda _message: None)
        wrapper = [sys.executable, '-c', 'import sys; from snapgent_bridge.askpass_helper import main; sys.exit(main(sys.argv[2:]))']
        self.env = await self.broker.start(self.dir, wrapper)
        self.addAsyncCleanup(self.broker.stop)

    async def through_the_script(self, prompt):
        """What ssh does: run the helper script with the prompt as its argument."""
        env = {**os.environ, **self.env, 'PYTHONPATH': os.pathsep.join(p for p in sys.path if p)}
        process = await asyncio.create_subprocess_exec(self.env['SSH_ASKPASS'], prompt, env=env,
                                                       stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await asyncio.wait_for(process.communicate(), 30)
        return process.returncode, out, err

    async def direct(self, token, prompt, hint=''):
        return await asyncio.get_running_loop().run_in_executor(
            None, askpass_helper.ask, self.env[askpass_helper.SOCKET_VARIABLE], token, prompt, hint)

    async def test_the_environment_for_ssh_and_the_modes_of_what_was_made(self):
        self.assertEqual(self.env['SSH_ASKPASS_REQUIRE'], 'force')
        self.assertEqual(Path(self.env['SSH_ASKPASS']).stat().st_mode & 0o777, 0o700)
        self.assertEqual(Path(self.env[askpass_helper.SOCKET_VARIABLE]).stat().st_mode & 0o777, 0o600)

    async def test_what_ssh_asks_reaches_the_popup_and_the_answer_comes_back_on_stdout(self):
        code, out, err = await self.through_the_script("Enter passphrase for key 'k':")
        self.assertEqual((code, out), (0, b'hunter2\n'), err)
        self.assertEqual(self.asked, [Prompt("Enter passphrase for key 'k':", SECRET)])
        self.assertFalse(self.broker.cancelled)

    async def test_cancelling_makes_the_helper_fail_and_is_remembered(self):
        self.reply = None
        code, out, _ = await self.through_the_script('Enter passphrase:')
        self.assertEqual((code, out), (1, b''))
        self.assertTrue(self.broker.cancelled)

    async def test_a_caller_without_the_token_is_refused_and_nothing_is_asked(self):
        self.assertIsNone(await self.direct('wrong-token', 'Enter passphrase:'))
        self.assertEqual(self.asked, [])
        self.assertFalse(self.broker.cancelled)

    async def test_a_host_question_is_a_confirmation(self):
        await self.direct(self.env[askpass_helper.TOKEN_VARIABLE], 'Continue connecting (yes/no)?')
        self.assertEqual(self.asked[0].kind, CONFIRM)

    async def test_a_very_long_question_and_answer_are_cut(self):
        self.reply = 'x' * 5000
        answer = await self.direct(self.env[askpass_helper.TOKEN_VARIABLE], 'q' * (MAX_PROMPT_CHARS + 500))
        self.assertEqual(len(answer), MAX_ANSWER_CHARS)
        self.assertEqual(len(self.asked[0].text), MAX_PROMPT_CHARS)


if __name__ == '__main__':
    unittest.main()
