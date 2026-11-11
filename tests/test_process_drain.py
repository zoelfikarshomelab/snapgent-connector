# SPDX-License-Identifier: GPL-3.0-or-later
import os
import queue
import threading
import unittest

from snapgent_mcp.process import _drain_pipe


def drained(*pieces):
    """What the reader forwards for a child that writes these byte pieces, one read each."""
    read_end, write_end = os.pipe()
    events = queue.Queue()
    reader = threading.Thread(target=_drain_pipe, args=(os.fdopen(read_end, "rb"), "stdout", events, threading.Event()))
    reader.start()
    for piece in pieces:
        os.write(write_end, piece)
        reader_wait()
    os.close(write_end)
    reader.join(timeout=5)
    out = []
    while not events.empty():
        out.append(events.get()[1])
    return "".join(out)


def reader_wait():
    import time
    time.sleep(0.05)  # lets the reader take each piece as its own read


class LineEndTests(unittest.TestCase):
    def test_a_windows_line_end_becomes_a_newline(self):
        self.assertEqual(drained(b"live\r\nafter\r\n"), "live\nafter\n")

    def test_a_line_end_split_between_two_reads_is_still_joined(self):
        self.assertEqual(drained(b"live\r", b"\nafter"), "live\nafter")

    def test_a_lone_carriage_return_stays_for_progress_bars(self):
        self.assertEqual(drained(b"10%\r20%\r", b"30%"), "10%\r20%\r30%")

    def test_a_carriage_return_at_the_very_end_is_not_lost(self):
        self.assertEqual(drained(b"done\r"), "done\r")


if __name__ == "__main__":
    unittest.main()
