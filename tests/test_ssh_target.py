# SPDX-License-Identifier: GPL-3.0-or-later
import re
import unittest

from snapgent_bridge import ssh_target as t


class ParseTests(unittest.TestCase):
    def test_user_host_and_an_optional_port(self):
        self.assertEqual(t.parse_target('me@192.168.1.20'), t.SshTarget('me', '192.168.1.20', 22))
        self.assertEqual(t.parse_target('  me@example.com:2222 \n'), t.SshTarget('me', 'example.com', 2222))
        self.assertEqual(t.parse_target('deploy.01@[::1]:2200'), t.SshTarget('deploy.01', '::1', 2200))
        self.assertEqual(t.parse_target('me@[fe80::1]'), t.SshTarget('me', 'fe80::1', 22))

    def test_anything_that_is_not_a_user_and_a_host_is_refused(self):
        for bad in ('', ' ', 'me', '@host', 'me@', 'me@@host', 'a@b@c', '-oProxyCommand=x@host', 'me@-oProxyCommand=x', 'me@-host',
                    'me@host-', 'me@ho st', 'me@host;reboot', 'me@host$(id)', 'me@host\nx', 'me@[host]', 'me@[::1', 'me@[::1]x',
                    'me@host:0', 'me@host:65536', 'me@host:abc', 'me@host:22:33', None, 5, ['me@host']):
            with self.assertRaises(t.TargetError, msg=repr(bad)):
                t.parse_target(bad)

    def test_the_message_says_what_to_type(self):
        with self.assertRaisesRegex(t.TargetError, 'user@host'):
            t.parse_target('me')
        with self.assertRaisesRegex(t.TargetError, '1 to 65535'):
            t.parse_target('me@host:0')


class NamingTests(unittest.TestCase):
    def test_label(self):
        self.assertEqual(t.SshTarget('me', 'h').label, 'me@h')
        self.assertEqual(t.SshTarget('me', 'h', 2222).label, 'me@h:2222')
        self.assertEqual(t.SshTarget('me', '::1', 2200).label, 'me@[::1]:2200')

    def test_server_ids_are_valid_distinct_and_short(self):
        rule = re.compile(r'[A-Za-z0-9._-]+')
        self.assertEqual(t.server_id(t.SshTarget('me', '192.168.1.20')), 'ssh-me-192.168.1.20')
        self.assertEqual(t.server_id(t.SshTarget('me', 'h', 2222)), 'ssh-me-h-2222')
        self.assertNotEqual(t.server_id(t.SshTarget('me', 'h', 22)), t.server_id(t.SshTarget('me', 'h', 2222)))
        self.assertTrue(rule.fullmatch(t.server_id(t.SshTarget('me', '::1', 2200))))
        base = '.'.join(['a' * 50] * 4)
        one, two = t.server_id(t.SshTarget('me', base + '1')), t.server_id(t.SshTarget('me', base + '2'))
        self.assertTrue(len(one) <= t.SERVER_ID_MAX and len(two) <= t.SERVER_ID_MAX)
        self.assertNotEqual(one, two, 'a long name is cut but stays unique')
        self.assertTrue(rule.fullmatch(one))


class CommandLineTests(unittest.TestCase):
    target = t.SshTarget('me', 'host.example', 2222)

    def test_every_command_line_puts_the_host_after_double_dash(self):
        lines = (t.master_args(self.target, '/tmp/x/m'), t.control_args(self.target, '/tmp/x/m', 'check'),
                 t.client_args(self.target, '/tmp/x/m', 'echo hi'))
        for args in lines:
            at = args.index('--')
            self.assertEqual(args[at + 1], 'host.example')
            self.assertEqual(args[at - 4:at], ['-l', 'me', '-p', '2222'])

    def test_the_master_signs_in_and_forwards_nothing(self):
        args = t.master_args(self.target, '/tmp/x/m')
        for wanted in ('-M', '-N', 'ControlMaster=yes', 'ControlPath=/tmp/x/m', 'ClearAllForwardings=yes', 'ForwardAgent=no', 'ForwardX11=no'):
            self.assertIn(wanted, args)
        self.assertNotIn('BatchMode=yes', args, 'the master must be able to ask')

    def test_a_client_never_asks_and_has_no_terminal(self):
        args = t.client_args(self.target, '/tmp/x/m', 'echo hi')
        for wanted in ('-T', 'BatchMode=yes', 'ControlMaster=no', 'ControlPath=/tmp/x/m'):
            self.assertIn(wanted, args)
        self.assertEqual(args[-1], 'echo hi')

    def test_control_operations(self):
        args = t.control_args(self.target, '/tmp/x/m', 'exit')
        self.assertEqual(args[args.index('-O') + 1], 'exit')
