# SPDX-License-Identifier: GPL-3.0-or-later
import unittest

from snapgent_bridge.registry import ServerRegistry
from tests.ssh_support import FakeServer
from tests.support import mock_config, real_server, temp_dir


def make():
    made = {}

    def factory(server_id, config):
        server = FakeServer(server_id, config)
        made[server_id] = server
        return server

    return ServerRegistry(factory, lambda _m: None), made


class AttachTests(unittest.IsolatedAsyncioTestCase):
    async def test_an_attached_server_is_listed_started_and_labelled_and_a_duplicate_is_refused(self):
        registry, made = make()
        server = registry.attach('ssh-me-h', {'command': 'ssh'}, label='me@h')
        self.assertTrue(await server.start())
        registry.rebuild_catalog()
        self.assertEqual([t['name'] for t in registry.catalog], ['t'])
        self.assertEqual(registry.status(), [{'id': 'ssh-me-h', 'alive': True, 'tools': 1, 'remote': 'me@h'}])
        with self.assertRaisesRegex(ValueError, 'already exists'):
            registry.attach('ssh-me-h', {})

    async def test_a_server_from_the_config_has_no_remote_label(self):
        registry, _ = make()
        await registry.start_all({'a': {}})
        self.assertNotIn('remote', registry.status()[0])

    async def test_the_monitor_does_not_restart_an_attached_server_but_still_restarts_the_others(self):
        registry, made = make()
        await registry.start_all({'a': {}})
        remote = registry.attach('ssh-x', {}, label='x')
        await remote.start()
        remote.die()
        made['a'].die()
        self.assertTrue(await registry.revive_dead())
        self.assertEqual((remote.start_calls, made['a'].start_calls), (1, 2))
        self.assertFalse(remote.alive)

    async def test_detach_stops_it_and_takes_its_tools_away(self):
        registry, _ = make()
        remote = registry.attach('ssh-x', {})
        await remote.start()
        registry.rebuild_catalog()
        await registry.detach('ssh-x')
        self.assertTrue(remote.stopped)
        self.assertEqual((registry.servers, registry.catalog), ({}, []))
        await registry.detach('ssh-x')  # again: nothing to do, no error

    async def test_a_restart_for_a_config_change_keeps_what_was_attached(self):
        with temp_dir() as tmp:
            config = mock_config(tmp)
            made = {}

            def factory(server_id, cfg):
                made[server_id] = FakeServer(server_id, cfg) if server_id.startswith('ssh-') else real_server(server_id, cfg)
                return made[server_id]

            registry = ServerRegistry(factory, lambda _m: None)
            await registry.start_all({'mock': config})
            try:
                remote = registry.attach('ssh-x', {}, label='x')
                await remote.start()
                await registry.restart({'mock': config, 'ssh-x': {'command': 'config-must-not-win'}})
                self.assertIs(registry.servers['ssh-x'], remote)
                self.assertFalse(remote.stopped)
                self.assertEqual((remote.start_calls, sorted(registry.servers)), (1, ['mock', 'ssh-x']))
                self.assertEqual(sorted(t['name'] for t in registry.catalog), ['echo', 't'])
            finally:
                await registry.stop_all()

    async def test_stop_all_ends_them_all_unless_told_to_keep_the_attached(self):
        registry, _ = make()
        remote = registry.attach('ssh-x', {})
        await remote.start()
        await registry.stop_all(keep_attached=True)
        self.assertEqual((list(registry.servers), remote.stopped), (['ssh-x'], False))
        await registry.stop_all()
        self.assertEqual((registry.servers, remote.stopped), ({}, True))
        self.assertIsNotNone(registry.attach('ssh-x', {}), 'the name is free again')


if __name__ == '__main__':
    unittest.main()
