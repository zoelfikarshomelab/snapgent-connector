# SPDX-License-Identifier: GPL-3.0-or-later
import asyncio
import unittest
from unittest import mock

from snapgent_bridge import ssh_manager
from snapgent_bridge.askpass import CONFIRM, SECRET, Prompt
from snapgent_bridge.registry import ServerRegistry
from snapgent_bridge.ssh_bundle import Bundle
from snapgent_bridge.ssh_manager import SshManager
from snapgent_bridge.ssh_session import SshError
from tests.ssh_support import FakeServer, FakeSession
from tests.support import Recorder

BUNDLE = Bundle(b'zip', '0123456789abcdef')


class Harness:
    def __init__(self, script=None, starts=True, platform=None, ssh=None):
        self.script = script
        self.sessions = []
        self.servers = {}
        self.broadcasts = Recorder()
        self.announced = 0
        self.checks = 0

        def server(server_id, config):
            self.servers[server_id] = FakeServer(server_id, config, starts=starts)
            return self.servers[server_id]

        async def announce():
            self.announced += 1

        def session(target, log=None):
            made = FakeSession(target, self.script)
            self.sessions.append(made)
            return made

        self.registry = ServerRegistry(server, lambda _m: None)
        self.manager = SshManager(self.registry, self.broadcasts, announce, lambda _m: None, session_factory=session,
                                  make_bundle=lambda: BUNDLE, check=check_fn(ssh, self), platform_check=lambda: platform)

    def states(self):
        return [m['state'] for m in self.broadcasts.sent if m['type'] == 'ssh_status']

    def prompts(self):
        return [m for m in self.broadcasts.sent if m['type'] == 'ssh_prompt']


def check_fn(problem, harness):
    async def check():
        harness.checks += 1
        return problem
    return check


async def until(condition, seconds=5):
    for _ in range(int(seconds / 0.01)):
        if condition():
            return
        await asyncio.sleep(0.01)
    raise AssertionError('timed out waiting')


class ConnectTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_text_that_is_not_a_server_is_refused_before_anything_happens(self):
        h = Harness()
        reply = await h.manager.connect('-oProxyCommand=x@host')
        self.assertFalse(reply['ok'])
        self.assertIn('user@host', reply['error'])
        self.assertEqual((h.sessions, h.broadcasts.sent, h.checks), ([], [], 0))

    async def test_a_machine_that_cannot_use_ssh_says_why_and_a_good_ssh_is_checked_once(self):
        h = Harness(platform='no ssh here')
        self.assertEqual(await h.manager.connect('me@h'), {'ok': False, 'error': 'no ssh here'})
        h = Harness(ssh='OpenSSH 7.9 is too old')
        self.assertEqual((await h.manager.connect('me@h'))['error'], 'OpenSSH 7.9 is too old')
        h = Harness()
        await h.manager.connect('me@h')
        await h.manager.disconnect('ssh-me-h')
        await h.manager.connect('me@h')
        self.assertEqual(h.checks, 1)

    async def test_connecting_makes_the_server_part_of_the_registry_and_tells_the_extension_each_step(self):
        h = Harness()
        reply = await h.manager.connect('me@h')
        self.assertEqual(reply, {'ok': True, 'server_id': 'ssh-me-h', 'label': 'me@h'})
        self.assertEqual(h.states(), ['connecting', 'preparing', 'ready'])
        self.assertTrue(h.manager.owns('ssh-me-h'))
        self.assertEqual(h.announced, 1)
        self.assertEqual(h.registry.status(), [{'id': 'ssh-me-h', 'alive': True, 'tools': 1, 'remote': 'me@h'}])
        self.assertEqual([t['name'] for t in h.registry.catalog], ['t'])
        self.assertIn('mcp-0123456789abcdef.zip', h.servers['ssh-me-h'].config['args'][0])

    async def test_connecting_twice_to_the_same_server_reuses_the_connection(self):
        h = Harness()
        await h.manager.connect('me@h')
        again = await h.manager.connect('me@h')
        self.assertEqual((again['ok'], again['already'], len(h.sessions)), (True, True, 1))

    async def test_a_connection_in_progress_is_not_started_again(self):
        gate = asyncio.Event()

        async def wait(session, ask):
            await gate.wait()

        h = Harness(script=wait)
        first = asyncio.ensure_future(h.manager.connect('me@h'))
        await until(lambda: h.sessions)
        second = await h.manager.connect('me@h')
        self.assertEqual(second, {'ok': False, 'error': 'Already connecting to that server.'})
        gate.set()
        self.assertTrue((await first)['ok'])

    async def test_a_failed_login_leaves_nothing_behind(self):
        def refuse(session, ask):
            raise SshError('Connection cancelled.')

        h = Harness(script=refuse)
        reply = await h.manager.connect('me@h')
        self.assertEqual(reply, {'ok': False, 'error': 'Connection cancelled.'})
        self.assertEqual((h.registry.servers, h.manager.owns('ssh-me-h'), h.sessions[0].closed), ({}, False, True))
        self.assertEqual(h.states(), ['connecting', 'failed'])
        self.assertEqual(h.announced, 0)

    async def test_a_server_without_a_usable_python_says_so_and_is_closed(self):
        h = Harness()
        original = h.manager._session_factory

        def old_python(target, log=None):
            session = original(target, log=log)
            session.python = b'3 8\n'
            return session

        h.manager._session_factory = old_python
        reply = await h.manager.connect('me@h')
        self.assertFalse(reply['ok'])
        self.assertIn('3.8', reply['error'])
        self.assertEqual((h.registry.servers, h.sessions[0].closed), ({}, True))

    async def test_a_server_that_does_not_start_there_is_reported_with_its_reason(self):
        h = Harness(starts=False)
        reply = await h.manager.connect('me@h')
        self.assertEqual(reply, {'ok': False, 'error': 'boom'})
        self.assertEqual((h.registry.servers, h.sessions[0].closed, h.manager.owns('ssh-me-h')), ({}, True, False))

    async def test_an_interrupted_connect_still_cleans_up(self):
        async def hang(session, ask):
            await asyncio.sleep(60)

        h = Harness(script=hang)
        task = asyncio.ensure_future(h.manager.connect('me@h'))
        await until(lambda: h.sessions)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(h.sessions[0].closed)
        self.assertEqual(h.registry.servers, {})


class PromptTests(unittest.IsolatedAsyncioTestCase):
    async def connect_with(self, prompt, answer_value):
        got = []

        async def script(session, ask):
            got.append(await ask(prompt))

        h = Harness(script=script)
        task = asyncio.ensure_future(h.manager.connect('me@h'))
        await until(lambda: h.prompts())
        message = h.prompts()[0]
        self.assertTrue(h.manager.answer(message['prompt_id'], answer_value))
        self.assertTrue((await task)['ok'])
        return h, message, got[0]

    async def test_a_passphrase_goes_to_the_popup_and_the_answer_comes_back(self):
        h, message, got = await self.connect_with(Prompt("Enter passphrase for key 'k':", SECRET), 'hunter2')
        self.assertEqual((message['kind'], message['label'], message['server_id'], message['text']),
                         (SECRET, 'me@h', 'ssh-me-h', "Enter passphrase for key 'k':"))
        self.assertEqual(got, 'hunter2')

    async def test_only_an_explicit_yes_confirms_a_new_host(self):
        for typed, expected in (('yes', 'yes'), (' Yes ', 'yes'), ('maybe', 'no'), ('', 'no'), ('y', 'no')):
            _, _, got = await self.connect_with(Prompt('Continue connecting (yes/no)?', CONFIRM), typed)
            self.assertEqual(got, expected, typed)

    async def test_cancelling_or_a_value_that_is_not_text_answers_nothing(self):
        _, _, got = await self.connect_with(Prompt('pass:', SECRET), None)
        self.assertIsNone(got)
        _, _, got = await self.connect_with(Prompt('pass:', SECRET), 42)
        self.assertIsNone(got)

    async def test_an_answer_is_cut_to_a_sane_length(self):
        _, _, got = await self.connect_with(Prompt('pass:', SECRET), 'x' * 5000)
        self.assertEqual(len(got), 1024)

    async def test_an_answer_for_nothing_that_is_waiting_is_ignored_and_one_answer_counts_once(self):
        h, message, _ = await self.connect_with(Prompt('pass:', SECRET), 'a')
        self.assertFalse(h.manager.answer(message['prompt_id'], 'again'))
        self.assertFalse(h.manager.answer('nope', 'x'))
        self.assertFalse(h.manager.answer(None, 'x'))
        self.assertFalse(h.manager.answer(['x'], 'x'))

    async def test_nobody_answering_in_time_counts_as_a_cancel(self):
        got = []

        async def script(session, ask):
            got.append(await ask(Prompt('pass:', SECRET)))

        h = Harness(script=script)
        with mock.patch.object(ssh_manager, 'PROMPT_SECONDS', 0.05):
            self.assertTrue((await h.manager.connect('me@h'))['ok'])
        self.assertEqual(got, [None])
        self.assertEqual(h.manager._pending, {})


class EndingTests(unittest.IsolatedAsyncioTestCase):
    async def test_disconnect_closes_the_session_and_takes_the_server_away(self):
        h = Harness()
        await h.manager.connect('me@h')
        self.assertEqual(await h.manager.disconnect('ssh-me-h'), {'ok': True})
        self.assertEqual((h.registry.servers, h.sessions[0].closed, h.manager.owns('ssh-me-h')), ({}, True, False))
        self.assertEqual((h.states()[-1], h.announced), ('closed', 2))
        self.assertFalse((await h.manager.disconnect('ssh-me-h'))['ok'])
        self.assertFalse((await h.manager.disconnect('snapgent'))['ok'], 'only an SSH server can be disconnected here')
        self.assertFalse((await h.manager.disconnect(None))['ok'])

    async def test_a_connection_that_ended_is_taken_away_and_the_user_can_connect_again(self):
        h = Harness()
        await h.manager.connect('me@h')
        self.assertFalse(await h.manager.reap())
        h.sessions[0].alive = False
        self.assertTrue(await h.manager.reap())
        closing = [m for m in h.broadcasts.sent if m.get('state') == 'closed'][0]
        self.assertIn('Connect again', closing['detail'])
        self.assertEqual((h.registry.servers, h.sessions[0].closed), ({}, True))
        self.assertFalse(await h.manager.reap())
        self.assertTrue((await h.manager.connect('me@h'))['ok'])
        self.assertEqual(len(h.sessions), 2)

    async def test_a_server_that_stopped_is_taken_away_too(self):
        h = Harness()
        await h.manager.connect('me@h')
        h.servers['ssh-me-h'].die()
        self.assertTrue(await h.manager.reap())
        self.assertTrue(h.sessions[0].closed)

    async def test_shutdown_releases_a_waiting_question_and_closes_everything(self):
        got = []

        async def script(session, ask):
            got.append(await ask(Prompt('pass:', SECRET)))

        h = Harness(script=script)
        task = asyncio.ensure_future(h.manager.connect('me@h'))
        await until(lambda: h.prompts())
        await h.manager.shutdown()
        self.assertTrue((await task)['ok'])
        self.assertEqual(got, [None])
        await h.manager.shutdown()
        self.assertEqual((h.registry.servers, h.manager.owns('ssh-me-h')), ({}, False))


if __name__ == '__main__':
    unittest.main()
