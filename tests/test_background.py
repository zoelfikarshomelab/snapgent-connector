import os
import re
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

from snapgent_mcp import background, process
from snapgent_mcp.background import BackgroundRun, BackgroundRuns, duration, handover_report, tail, wait_report
from snapgent_mcp.context import Context
from snapgent_mcp.jobs import JobStore
from snapgent_mcp.risk import EXECUTE, READ
from snapgent_mcp.security import DENY, Policy, SessionState, decide
from snapgent_mcp.security.modes import READONLY
from snapgent_mcp.tools import commands, registry


def script(code=0, lines=8, pause=0.2):
    """A command that prints `lines` lines, one every `pause` seconds, then exits with `code`."""
    source = f"import sys, time\nfor n in range({lines}):\n    print('line', n, flush=True)\n    time.sleep({pause})\nsys.exit({code})"
    return [sys.executable, "-u", "-c", source]


class BackgroundCase(unittest.TestCase):
    """The window one call waits is shortened to a moment, so a command that takes a second outlives it."""

    def setUp(self):
        window = mock.patch.object(process, "FOREGROUND_SECONDS", 0.6)
        window.start()
        self.addCleanup(window.stop)
        self.ctx = Context(root=Path.cwd())

    @staticmethod
    def stop(run):
        if run.running:
            run.stop("test")
            run.wait(15)

    def run_detached(self, command, **kwargs):
        """(what the call answered, the background run it left behind or None)."""
        report = process.run_process_streaming(command, Path.cwd(), detach=True, **kwargs)
        found = re.search(r"run_id (r[0-9]+)", report)
        run = background.RUNS.get(found.group(1)) if found else None
        if run is not None:
            self.addCleanup(self.stop, run)
        return report, run


class HandoverTests(BackgroundCase):
    def test_a_command_that_outlives_the_call_goes_on_and_the_call_answers_with_what_it_printed(self):
        report, run = self.run_detached(script())
        self.assertIsNotNone(run)
        self.assertIn("Still running", report)
        self.assertIn("NOT stopped", report)
        self.assertIn("line 0", report)
        self.assertIn(str(run.log_path), report)
        self.assertIn('"command":"wait_command"', report)
        self.assertIn(f'"run_id":"{run.run_id}"', report)
        self.assertTrue(run.running)
        self.assertIsNone(run.process.poll(), "the command was not stopped")

    def test_wait_command_gives_only_what_is_new_and_the_log_holds_everything(self):
        _, run = self.run_detached(script())
        answer = commands.wait_command(self.ctx, run.run_id, wait_seconds=20)
        self.assertIn("Finished with exit code 0", answer)
        self.assertIn("line 7", answer)
        self.assertNotIn("line 0", answer, "what the first answer showed is not repeated")
        log = run.log_path.read_text(encoding="utf-8")
        self.assertIn("line 0", log)
        self.assertIn("line 7", log)
        self.assertIn("(no new output)", commands.wait_command(self.ctx, run.run_id, wait_seconds=1))

    def test_a_short_wait_says_it_is_still_running_and_shows_the_new_output_as_it_comes(self):
        streamed = []
        watched = Context(root=Path.cwd(), stream=lambda stream, text: streamed.append(text))
        _, run = self.run_detached(script(lines=30))
        answer = commands.wait_command(watched, run.run_id, wait_seconds=1)
        self.assertIn("Still running", answer)
        self.assertIn("line", "".join(streamed))

    def test_a_command_that_fails_after_the_handover_is_an_error_with_its_output(self):
        _, run = self.run_detached(script(code=3))
        with self.assertRaises(RuntimeError) as caught:
            commands.wait_command(self.ctx, run.run_id, wait_seconds=20)
        self.assertIn("exited with status 3", str(caught.exception))
        self.assertIn("line 7", str(caught.exception))

    def test_stop_command_ends_it_and_says_so_afterwards(self):
        _, run = self.run_detached(script(lines=200))
        self.assertIn("Stopped", commands.stop_command(self.ctx, run.run_id))
        self.assertFalse(run.running)
        self.assertIsNotNone(run.process.poll())
        self.assertIn("Stopped with stop_command", commands.wait_command(self.ctx, run.run_id, wait_seconds=1))
        self.assertIn("had already finished", commands.stop_command(self.ctx, run.run_id))

    def test_a_command_left_running_too_long_is_stopped_and_said_so(self):
        with mock.patch.object(process, "BACKGROUND_MAX_SECONDS", 1.0), mock.patch.object(background, "BACKGROUND_MAX_SECONDS", 1.0):
            _, run = self.run_detached(script(lines=200))
            self.assertTrue(run.wait(20))
            with self.assertRaises(RuntimeError) as caught:
                commands.wait_command(self.ctx, run.run_id, wait_seconds=1)
        self.assertIn("was stopped after", str(caught.exception))
        self.assertEqual(run.stopped_by, "limit")

    def test_with_no_room_left_the_command_is_stopped_as_it_always_was(self):
        with mock.patch.object(background.RUNS, "has_room", return_value=False):
            with self.assertRaises(RuntimeError) as caught:
                process.run_process_streaming(script(lines=200), Path.cwd(), detach=True)
        self.assertIn("stopped after", str(caught.exception))
        self.assertIn("already running in the background", str(caught.exception))

    def test_a_command_that_finishes_inside_the_window_answers_as_always(self):
        report, run = self.run_detached([sys.executable, "-c", "print('hi')"])
        self.assertEqual((report, run), ("hi", None))

    def test_without_detach_a_command_that_takes_too_long_is_still_stopped(self):
        started = time.monotonic()
        with self.assertRaises(RuntimeError) as caught:
            process.run_process_streaming(script(lines=200), Path.cwd(), timeout=1)
        self.assertIn("stopped after 1 seconds", str(caught.exception))
        self.assertLess(time.monotonic() - started, 30)

    def test_an_unknown_run_id_says_what_to_do(self):
        for call in (commands.wait_command, commands.stop_command):
            with self.assertRaises(LookupError) as caught:
                call(self.ctx, "r999999")
            self.assertIn("get_command_output", str(caught.exception))


class LogTests(BackgroundCase):
    def test_the_log_is_written_while_the_command_is_still_inside_the_window_and_removed_when_it_ends_there(self):
        created, seen = [], []
        real = background.RUNS.create_log

        def spy(run_id):
            created.append(real(run_id))
            return created[-1]

        def on_chunk(stream, text):
            if stream != "log":
                seen.append(created[0].read_text(encoding="utf-8"))

        with mock.patch.object(background.RUNS, "create_log", side_effect=spy):
            process.run_process_streaming([sys.executable, "-u", "-c", "print('early')"], Path.cwd(), detach=True, on_chunk=on_chunk)
        self.assertIn("early", seen[0])
        self.assertFalse(created[0].exists(), "a command that ended inside the window leaves no log behind")

    def test_the_log_path_is_announced_once_on_its_own_stream_when_the_command_starts(self):
        announced = []
        process.run_process_streaming([sys.executable, "-u", "-c", "print('x')"], Path.cwd(), detach=True,
                                      on_chunk=lambda stream, text: announced.append((stream, text)))
        paths = [text for stream, text in announced if stream == "log"]
        self.assertEqual(len(paths), 1)
        self.assertTrue(paths[0].endswith(".log"))

    def test_text_without_a_newline_reaches_the_log_and_the_answer_while_the_command_runs(self):
        source = "import sys, time\nsys.stdout.write('partial, no newline')\nsys.stdout.flush()\ntime.sleep(5)"
        report, run = self.run_detached([sys.executable, "-u", "-c", source])
        self.assertIsNotNone(run)
        self.assertIn("partial, no newline", report)
        self.assertIn("partial, no newline", run.log_path.read_text(encoding="utf-8"))

    def test_what_is_printed_after_the_handover_is_written_to_the_log_as_it_comes(self):
        _, run = self.run_detached(script(lines=30))
        time.sleep(1.0)
        self.assertTrue(run.running)
        self.assertIn("line 5", run.log_path.read_text(encoding="utf-8"))


class JobTests(BackgroundCase):
    def test_stop_still_ends_a_command_that_is_inside_the_window(self):
        with mock.patch.object(process, "FOREGROUND_SECONDS", 30):
            store = JobStore()
            job = store.start("k", "run_command", lambda: process.run_process_streaming(script(lines=200), Path.cwd(), detach=True))
            time.sleep(1.0)
            store.cancel("k")
            with self.assertRaises(RuntimeError):
                job.wait(20)

    def test_stop_no_longer_reaches_a_command_that_went_on_in_the_background(self):
        store = JobStore()
        job = store.start("k", "run_command", lambda: process.run_process_streaming(script(lines=200), Path.cwd(), detach=True))
        report = job.wait(20)
        run = background.RUNS.get(re.search(r"run_id (r[0-9]+)", report).group(1))
        self.addCleanup(self.stop, run)
        self.assertEqual(store.cancel("k"), "That command had already finished.")
        time.sleep(0.3)
        self.assertTrue(run.running)


class RegistryTests(unittest.TestCase):
    @staticmethod
    def fake_process():
        return mock.Mock(pid=4242, returncode=None)

    def test_the_log_has_a_name_nobody_can_guess_and_only_this_user_reads_it(self):
        runs = BackgroundRuns()
        run = runs.start("r1", "make", self.fake_process(), 0.0)
        self.addCleanup(run.log_path.unlink)
        self.assertRegex(run.log_path.name, r"^snapgent-r1-[A-Za-z0-9_]{8}\.log$")
        if os.name != "nt":
            self.assertEqual(run.log_path.stat().st_mode & 0o777, 0o600)

    def test_two_runs_never_share_a_log(self):
        runs = BackgroundRuns()
        first = runs.start("r1", "make", self.fake_process(), 0.0)
        second = runs.start("r1", "make", self.fake_process(), 0.0)
        self.addCleanup(first.log_path.unlink)
        self.addCleanup(second.log_path.unlink)
        self.assertNotEqual(first.log_path, second.log_path)

    def test_a_finished_run_is_forgotten_after_a_while_with_its_log(self):
        now = [100.0]
        runs = BackgroundRuns(clock=lambda: now[0], kept=10)
        run = runs.start("r1", "make", self.fake_process(), 100.0)
        run.finish(0)
        now[0] = 105.0
        self.assertIs(runs.get("r1"), run)
        self.assertTrue(run.log_path.exists())
        now[0] = 111.0
        self.assertIsNone(runs.get("r1"))
        self.assertFalse(run.log_path.exists())

    def test_only_runs_that_are_still_going_use_up_the_room(self):
        runs = BackgroundRuns(max_runs=2)
        first = runs.start("r1", "a", self.fake_process(), 0.0)
        second = runs.start("r2", "b", self.fake_process(), 0.0)
        for run in (first, second):
            self.addCleanup(run.log_path.unlink)
        self.assertFalse(runs.has_room())
        first.finish(0)
        self.assertTrue(runs.has_room())

    def test_shutdown_ends_what_still_runs_and_removes_every_log(self):
        runs = BackgroundRuns()
        going = runs.start("r1", "a", self.fake_process(), 0.0)
        done = runs.start("r2", "b", self.fake_process(), 0.0)
        done.finish(0)
        with mock.patch("snapgent_mcp.background.stop_process") as stop:
            runs.shutdown()
        stop.assert_called_once_with(going.process)
        self.assertFalse(going.log_path.exists() or done.log_path.exists())
        self.assertIsNone(runs.get("r1"))

    def test_what_was_shown_counts_as_shown_and_a_shrunk_text_is_not_an_error(self):
        run = BackgroundRun("r1", "make", self.fake_process(), 0.0, Path("unused.log"))
        self.assertEqual(run.take_new("abc"), "abc")
        self.assertEqual(run.take_new("abcdef"), "def")
        self.assertEqual(run.take_new("abcdef"), "")
        self.assertEqual(run.take_new("ab"), "")
        self.assertEqual(run.reported, 2)

    def test_output_falls_back_to_the_log_when_the_cache_forgot_the_run(self):
        runs = BackgroundRuns()
        run = runs.start("not-in-the-cache", "make", self.fake_process(), 0.0)
        self.addCleanup(run.log_path.unlink)
        run.write_log("from the log", append=False)
        run.write_log(" and more")
        self.assertEqual(run.output(), "from the log and more")


class ReportTests(unittest.TestCase):
    @staticmethod
    def run_after(seconds, exit_code=None, stopped_by=None):
        run = BackgroundRun("r9", "npm run build", mock.Mock(pid=77), 0.0, Path("/tmp/snapgent-r9-x.log"), clock=lambda: seconds)
        run.stopped_by = stopped_by
        if exit_code is not None:
            run.finish(exit_code)
        return run

    def test_durations_and_tails_are_short_and_say_what_was_left_out(self):
        self.assertEqual([duration(45), duration(125), duration(3720)], ["45 s", "2 min 5 s", "1 h 2 min"])
        self.assertEqual(tail("abc", 10), ("abc", 0))
        self.assertEqual(tail("one\ntwo\nthree", 8), ("three", 8), "a line cut in half is dropped, not shown in half")
        self.assertEqual(tail("one\ntwo\nthree", 9), ("two\nthree", 4), "a line that is whole at the cut is kept")
        self.assertEqual(tail("x" * 50, 10), ("x" * 10, 40))

    def test_the_first_answer_names_the_run_the_log_and_the_three_ways_to_go_on(self):
        text = handover_report(self.run_after(100), "line 1\nline 2", 1000, 100)
        for part in ("Still running after 1 min 40 s", "NOT stopped", "run_id r9, pid 77", str(Path("/tmp/snapgent-r9-x.log")), "line 2",
                     '"command":"wait_command"', '"command":"get_command_output"', '"command":"stop_command"', "tail -f", "stopped by itself after 1 h 0 min"):
            self.assertIn(part, text)
        self.assertIn("(nothing printed yet)", handover_report(self.run_after(100), "", 1000, 100))
        self.assertIn("earlier ones left out", handover_report(self.run_after(100), "x" * 500, 100, 100))

    def test_waiting_says_what_became_of_the_command(self):
        self.assertIn("Still running (1 min 40 s so far", wait_report(self.run_after(100), "new", 1000))
        self.assertIn("(no new output)", wait_report(self.run_after(100), "", 1000))
        self.assertIn("Finished with exit code 0 after 2 min 5 s", wait_report(self.run_after(125, exit_code=0), "done", 1000))
        self.assertIn("Stopped with stop_command", wait_report(self.run_after(125, exit_code=-15, stopped_by="user"), "", 1000))
        with self.assertRaises(RuntimeError) as failed:
            wait_report(self.run_after(125, exit_code=2), "boom", 1000)
        self.assertIn("exited with status 2", str(failed.exception))
        with self.assertRaises(RuntimeError) as limit:
            wait_report(self.run_after(125, exit_code=-15, stopped_by="limit"), "", 1000)
        self.assertIn("longest a background command may run", str(limit.exception))


class RegistrationTests(unittest.TestCase):
    def test_the_two_new_commands_are_listed_with_the_risk_each_one_has(self):
        self.assertEqual((registry.get("wait_command").risk, registry.get("stop_command").risk), (READ, EXECUTE))
        for name in ("wait_command", "stop_command"):
            self.assertEqual(registry.get(name).required, ["run_id"])

    def test_plan_mode_refuses_to_stop_a_command_but_may_wait_for_one(self):
        plan, session = Policy(READONLY), SessionState()
        self.assertEqual(decide(plan, "stop_command", EXECUTE, {"run_id": "r1"}, session).verdict, DENY)
        self.assertTrue(decide(plan, "wait_command", READ, {"run_id": "r1"}, session).allowed)


if __name__ == "__main__":
    unittest.main()
