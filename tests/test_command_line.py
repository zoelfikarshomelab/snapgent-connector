"""The command line as the model wrote it: "npm test" means the program npm with the argument test."""

import unittest

from snapgent_mcp.command_line import command_parts, normalize_arguments, split_command_line
from snapgent_mcp.security import CONFIRM
from snapgent_mcp.security.commands import escalates_privileges, is_harmless


class CommandLineTests(unittest.TestCase):
    def test_a_command_line_in_one_piece_is_split(self):
        self.assertEqual(split_command_line("npm test"), ["npm", "test"])
        self.assertEqual(split_command_line("git commit -m 'a message'"), ["git", "commit", "-m", "a message"])
        self.assertEqual(split_command_line("  sleep 5  "), ["sleep", "5"])

    def test_a_program_of_its_own_is_left_alone(self):
        self.assertEqual(command_parts("npm", ["test"]), ["npm", "test"])
        self.assertEqual(command_parts("ls -la", None), ["ls", "-la"])
        self.assertEqual(command_parts("python3 -m pytest", None), ["python3", "-m", "pytest"])

    def test_the_arguments_the_model_gave_come_after_the_command_line(self):
        self.assertEqual(command_parts("npm test", ["--watch"]), ["npm", "test", "--watch"])
        self.assertEqual(command_parts("npm", ["test"]), ["npm", "test"])

    def test_an_empty_command_is_left_to_the_tool_to_refuse(self):
        self.assertEqual(command_parts("  ", None), ["  "])

    def test_the_arguments_of_a_command_call_are_normalized(self):
        self.assertEqual(normalize_arguments("run_command", {"command": "sleep 5"}),
                         {"command": "sleep", "args": ["5"]})
        self.assertEqual(normalize_arguments("run_command", {"command": "npm", "args": ["test"]}),
                         {"command": "npm", "args": ["test"]})
        self.assertEqual(normalize_arguments("read_files", {"paths": ["a.js"]}), {"paths": ["a.js"]})

    def test_a_command_that_is_not_a_string_is_left_alone(self):
        self.assertEqual(normalize_arguments("run_command", {"command": 5}), {"command": 5})


class ThePolicySeesTheProgramTests(unittest.TestCase):
    """The split happens before the policy looks at the command: a privilege command written in one piece is still one."""

    def test_a_privilege_command_written_in_one_piece_is_still_one(self):
        arguments = normalize_arguments("run_command", {"command": "sudo rm -rf /"})
        self.assertEqual(arguments["command"], "sudo")
        self.assertEqual(arguments["args"], ["rm", "-rf", "/"])
        self.assertTrue(escalates_privileges(arguments["command"], arguments["args"]))

    def test_a_harmless_command_written_in_one_piece_is_still_harmless(self):
        arguments = normalize_arguments("run_command", {"command": "git status"})
        self.assertTrue(is_harmless(arguments["command"], arguments["args"]))


if __name__ == "__main__":
    unittest.main()
