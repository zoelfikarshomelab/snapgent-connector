# SPDX-License-Identifier: GPL-3.0-or-later
import tempfile
import unittest
from pathlib import Path

from snapgent_bridge.config import ConfigStore
from snapgent_bridge.router import RequestRouter
from tests.support import Recorder, fake_registry, fake_server

_TEMP = []


def tearDownModule():
    for tmp in _TEMP:
        tmp.cleanup()


class FakeManager:
    def __init__(self):
        self.calls = []
        self.owned = {'ssh-me-h'}

    def owns(self, server):
        return server in self.owned

    async def connect(self, target):
        self.calls.append(('connect', target))
        return {'ok': True, 'server_id': 'ssh-me-h'}

    async def disconnect(self, server):
        self.calls.append(('disconnect', server))
        return {'ok': True}

    def answer(self, prompt_id, value):
        self.calls.append(('answer', prompt_id, value))
        return prompt_id == 'p1'


def make(ssh=None):
    registry = fake_registry({'snapgent': fake_server('snapgent', ['read_files']), 'ssh-me-h': fake_server('ssh-me-h', ['read_files'])})
    tmp = tempfile.TemporaryDirectory()
    _TEMP.append(tmp)
    router = RequestRouter(registry, ConfigStore(Path(tmp.name) / 'config.json'), Recorder(), '9.9', lambda _m: None, ssh=ssh)
    asked = []

    def answering(server_id, listing):
        async def request(method, params, timeout=10):
            asked.append((server_id, method, params))
            return dict(listing)
        registry.servers[server_id].request = request

    return router, registry, asked, answering


async def ask(router, request):
    replies = Recorder()
    await router.handle(request, replies)
    return replies.sent


class SshRequestTests(unittest.IsolatedAsyncioTestCase):
    async def test_without_an_ssh_manager_every_ssh_request_says_it_is_not_available(self):
        router, *_ = make(ssh=None)
        for kind in ('ssh_connect', 'ssh_disconnect', 'ssh_answer'):
            [reply] = await ask(router, {'type': kind, 'id': 4})
            self.assertEqual((reply['type'], reply['id'], reply['ok']), ('ssh', 4, False))
            self.assertIn('not available', reply['error'])

    async def test_the_requests_reach_the_manager_and_its_result_comes_back_under_the_same_id(self):
        manager = FakeManager()
        router, *_ = make(ssh=manager)
        [connected] = await ask(router, {'type': 'ssh_connect', 'id': 1, 'target': 'me@h'})
        self.assertEqual(connected, {'type': 'ssh', 'id': 1, 'ok': True, 'server_id': 'ssh-me-h'})
        [closed] = await ask(router, {'type': 'ssh_disconnect', 'id': 2, 'server': 'ssh-me-h'})
        self.assertEqual((closed['id'], closed['ok']), (2, True))
        [good] = await ask(router, {'type': 'ssh_answer', 'id': 3, 'prompt_id': 'p1', 'answer': 'secret'})
        [stale] = await ask(router, {'type': 'ssh_answer', 'id': 4, 'prompt_id': 'old', 'answer': None})
        self.assertEqual((good['ok'], stale['ok']), (True, False))
        self.assertEqual(manager.calls, [('connect', 'me@h'), ('disconnect', 'ssh-me-h'), ('answer', 'p1', 'secret'), ('answer', 'old', None)])


class WorkspaceOfAServerTests(unittest.IsolatedAsyncioTestCase):
    async def test_without_a_server_named_the_default_one_is_asked_as_before_and_the_recent_folders_are_added(self):
        router, _, asked, answering = make(ssh=FakeManager())
        answering('snapgent', {'active': None, 'open': [], 'pinned': None})
        [reply] = await ask(router, {'type': 'workspaces', 'id': 1})
        self.assertEqual(asked, [('snapgent', 'snapgent/workspaces', {})])
        self.assertTrue(reply['ok'])
        self.assertIn('recent', reply)

    async def test_an_ssh_server_is_asked_itself_and_the_folders_of_this_computer_are_not_added(self):
        router, _, asked, answering = make(ssh=FakeManager())
        answering('ssh-me-h', {'active': None, 'open': [], 'pinned': None})
        [reply] = await ask(router, {'type': 'workspaces', 'id': 1, 'server': 'ssh-me-h'})
        self.assertEqual(asked, [('ssh-me-h', 'snapgent/workspaces', {})])
        self.assertTrue(reply['ok'])
        self.assertNotIn('recent', reply)

    async def test_a_folder_pinned_on_a_server_is_not_remembered_as_a_folder_of_this_computer(self):
        router, _, asked, answering = make(ssh=FakeManager())
        answering('ssh-me-h', {'pinned': '/srv/app'})
        [reply] = await ask(router, {'type': 'set_workspace', 'id': 2, 'server': 'ssh-me-h', 'path': '/srv/app'})
        self.assertTrue(reply['ok'])
        self.assertEqual(asked, [('ssh-me-h', 'snapgent/set_workspace', {'path': '/srv/app'})])
        self.assertEqual(router._config.recent_folders(), [])

    async def test_a_server_that_is_not_the_default_or_a_connected_ssh_one_is_never_asked(self):
        router, registry, asked, answering = make(ssh=FakeManager())
        answering('snapgent', {})
        for name in ('other', 'ssh-ghost', '../x'):
            [reply] = await ask(router, {'type': 'workspaces', 'id': 1, 'server': name})
            self.assertEqual((reply['ok'], reply['error']), (False, 'That server is not connected.'), name)
        self.assertEqual(asked, [])
        router_without, *_ = make(ssh=None)
        [reply] = await ask(router_without, {'type': 'workspaces', 'id': 1, 'server': 'ssh-me-h'})
        self.assertFalse(reply['ok'])

    async def test_listing_folders_is_only_for_an_ssh_server(self):
        router, _, asked, answering = make(ssh=FakeManager())
        answering('snapgent', {})
        answering('ssh-me-h', {'path': '/home/me', 'dirs': ['a']})
        [local] = await ask(router, {'type': 'ssh_list_dirs', 'id': 1, 'path': '/x'})
        self.assertEqual((local['ok'], asked), (False, []))
        self.assertIn('own folder window', local['error'])
        [remote] = await ask(router, {'type': 'ssh_list_dirs', 'id': 2, 'server': 'ssh-me-h', 'path': '/home/me'})
        self.assertTrue(remote['ok'])
        self.assertEqual(asked, [('ssh-me-h', 'snapgent/list_dirs', {'path': '/home/me'})])

    async def test_a_server_that_does_not_answer_is_reported_not_raised(self):
        router, registry, *_ = make(ssh=FakeManager())

        async def request(method, params, timeout=10):
            raise RuntimeError('the SSH connection dropped')

        registry.servers['ssh-me-h'].request = request
        [reply] = await ask(router, {'type': 'workspaces', 'id': 1, 'server': 'ssh-me-h'})
        self.assertEqual((reply['ok'], reply['error']), (False, 'the SSH connection dropped'))


if __name__ == '__main__':
    unittest.main()
