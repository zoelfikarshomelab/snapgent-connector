# SPDX-License-Identifier: GPL-3.0-or-later
import re
import sys
import unittest
from pathlib import Path

from snapgent_mcp import process
from snapgent_mcp.outputs import CACHE
from snapgent_mcp.preview import is_long, line_count, preview


def numbered(count):
    return "\n".join(f"line {n}" for n in range(1, count + 1))


class PreviewTests(unittest.TestCase):
    def test_a_short_output_is_left_alone(self):
        text = numbered(70)
        self.assertEqual(preview(text, "r1"), text)
        self.assertFalse(is_long(text))
        self.assertTrue(is_long(numbered(71)))

    def test_a_long_output_keeps_the_first_20_and_the_last_50_lines(self):
        shown = preview(numbered(100), "r7")
        for kept in ("line 1\n", "line 20\n", "line 51\n", "line 100"):
            self.assertIn(kept, shown)
        for dropped in ("\nline 21\n", "\nline 50\n"):
            self.assertNotIn(dropped, shown)

    def test_the_note_says_what_was_left_out_and_how_to_read_it(self):
        shown = preview(numbered(100), "r7")
        for part in ("30 lines left out", "(21-50 of 100)", "get_command_output", '"run_id":"r7"', '"max_lines":5000', '"start_line":-200',
                     "Do not run the command again"):
            self.assertIn(part, shown)

    def test_a_trailing_newline_stays_and_the_sizes_can_be_chosen(self):
        self.assertTrue(preview(numbered(100) + "\n", "r1").endswith("line 100\n"))
        shown = preview(numbered(10), "r1", head=2, tail=3)
        self.assertIn("5 lines left out", shown)
        self.assertIn("line 2\n", shown)
        self.assertIn("line 8\n", shown)
        self.assertNotIn("\nline 3\n", shown)

    def test_a_slice_of_a_log_does_not_claim_line_numbers(self):
        shown = preview(numbered(100), "r1", numbered=False)
        self.assertNotIn("(21-", shown)
        self.assertIn("get_command_output", shown)

    def test_lines_are_counted_like_get_command_output_does(self):
        self.assertEqual((line_count(""), line_count("a\nb\n"), line_count("a")), (0, 2, 1))


class ProcessPreviewTests(unittest.TestCase):
    def test_a_long_output_reaches_the_model_as_a_preview_and_stays_whole_in_the_cache(self):
        answer = process.run_process_streaming([sys.executable, "-c", "for n in range(200): print('row', n)"], Path.cwd())
        self.assertIn("row 19\n", answer)
        self.assertNotIn("row 20\n", answer)
        self.assertNotIn("row 149\n", answer)
        self.assertIn("row 150\n", answer)
        self.assertTrue(answer.endswith("row 199"))
        run_id = re.search(r'"run_id":"(r[0-9]+)"', answer).group(1)
        self.assertEqual(len(str(CACHE.get(run_id)["output"]).splitlines()), 200)

    def test_a_failing_command_gets_the_preview_too(self):
        code = "import sys\nfor n in range(200): print('row', n)\nsys.exit(3)"
        with self.assertRaises(RuntimeError) as caught:
            process.run_process_streaming([sys.executable, "-c", code], Path.cwd())
        message = str(caught.exception)
        for part in ("exited with status 3", "get_command_output", "row 199"):
            self.assertIn(part, message)
        self.assertNotIn("row 100\n", message)

    def test_a_short_output_is_unchanged(self):
        self.assertEqual(process.run_process_streaming([sys.executable, "-c", "print('hi')"], Path.cwd()), "hi")


if __name__ == "__main__":
    unittest.main()
