import json
import re
import stat
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path

from scripts import package_release as pr, set_version as sv
import subprocess

from snapgent_bridge import BRIDGE_VERSION

REPO = Path(__file__).resolve().parent.parent


class ReleaseCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.base = Path(self._tmp.name)
        self.dist = self.base / "dist"
        for target in pr.EXTENSION_TARGETS:
            (self.dist / target).mkdir(parents=True)
            (self.dist / target / "manifest.json").write_text("{}", encoding="utf-8")
        self.windows = self.base / "snapgent.exe"
        self.windows.write_bytes(b"MZ")
        self.linux = self.base / "snapgent"
        self.linux.write_bytes(b"\x7fELF")
        self.out = self.base / "out"
        self.out.mkdir()


class AssetTests(ReleaseCase):
    def test_the_extension_zip_holds_the_built_folders_of_both_browsers(self):
        archive = pr.make_extension_zip(self.dist, self.out, "1.2.3")
        self.assertEqual(archive.name, "snapgent-extension-v1.2.3.zip")
        with zipfile.ZipFile(archive) as zf:
            self.assertEqual(sorted(zf.namelist()), ["chrome/manifest.json", "firefox/manifest.json"])

    def test_the_linux_archive_is_one_executable_named_snapgent_and_the_license(self):
        archive = pr.make_linux_archive(self.linux, REPO, self.out, "1.2.3")
        self.assertEqual(archive.name, "snapgent-linux-x64-v1.2.3.tar.gz")
        with tarfile.open(archive) as tf:
            self.assertEqual(sorted(tf.getnames()), ["LICENSE", "snapgent"])
            self.assertTrue(tf.getmember("snapgent").mode & stat.S_IXUSR)

    def test_the_windows_program_is_published_as_it_is(self):
        target = pr.copy_windows_program(self.windows, self.out)
        self.assertEqual((target.name, target.read_bytes()), ("snapgent.exe", b"MZ"))

    def test_a_missing_input_is_a_clear_error_not_a_half_built_release(self):
        self.linux.unlink()
        with self.assertRaisesRegex(pr.ReleaseError, "snapgent"):
            pr.make_linux_archive(self.linux, REPO, self.out, "1.2.3")
        self.windows.unlink()
        with self.assertRaisesRegex(pr.ReleaseError, "snapgent.exe"):
            pr.copy_windows_program(self.windows, self.out)
        (self.dist / "firefox" / "manifest.json").unlink()
        (self.dist / "firefox").rmdir()
        with self.assertRaisesRegex(pr.ReleaseError, "firefox"):
            pr.make_extension_zip(self.dist, self.out, "1.2.3")

    def test_command_line_entry_point_makes_the_three_files_and_the_extension(self):
        code = pr.main(["--version", "9.9.9", "--extension-dist", str(self.dist), "--windows-binary", str(self.windows),
                        "--linux-binary", str(self.linux), "--out", str(self.out / "assets")])
        self.assertEqual(code, 0)
        self.assertEqual(sorted(p.name for p in (self.out / "assets").iterdir()),
                         ["snapgent-extension-v9.9.9.zip", "snapgent-linux-x64-v9.9.9.tar.gz", "snapgent.exe"])
        self.assertEqual(pr.main(["--version", "9.9.9", "--extension-dist", str(self.base / "nope"), "--out", str(self.out)]), 1)


class RepositoryLayoutTests(unittest.TestCase):
    """The repository root stays a table of contents, not a drawer. Add a folder here only on purpose."""

    ALLOWED_ROOT = {
        ".gitattributes", ".gitignore", "AGENTS.md", "CHANGELOG.md", "LICENSE", "README.md", "VERSION",
        ".github", ".snapgent", "assets", "docs", "extension", "scripts", "server", "tests",
    }

    def test_nothing_unexpected_is_tracked_at_the_root(self):
        try:
            tracked = subprocess.run(["git", "ls-files"], cwd=REPO, capture_output=True, text=True, check=True).stdout.splitlines()
        except (OSError, subprocess.CalledProcessError):
            self.skipTest("not a git checkout")
        at_root = {path.split("/")[0] for path in tracked}
        self.assertEqual(sorted(at_root - self.ALLOWED_ROOT), [], "move it into server/, extension/, docs/ or scripts/")

    def test_the_server_folder_holds_one_program_and_its_packages(self):
        try:
            tracked = subprocess.run(["git", "ls-files", "server"], cwd=REPO, capture_output=True, text=True, check=True).stdout.splitlines()
        except (OSError, subprocess.CalledProcessError):
            self.skipTest("not a git checkout")
        at_top = {path.split("/")[1] for path in tracked}
        self.assertEqual(sorted(at_top), ["snapgent.py", "snapgent.spec", "snapgent_bridge", "snapgent_mcp"])

    def test_no_compiled_binaries_are_tracked(self):
        try:
            tracked = subprocess.run(["git", "ls-files"], cwd=REPO, capture_output=True, text=True, check=True).stdout.splitlines()
        except (OSError, subprocess.CalledProcessError):
            self.skipTest("not a git checkout")
        self.assertEqual([p for p in tracked if p.endswith((".exe", ".dll", ".pyc"))], [])


class VersionTests(unittest.TestCase):
    """The version appears in several places; a release with disagreeing numbers confuses users and the popup."""

    def test_the_version_file_is_the_source_of_the_bridge_and_the_package(self):
        version = (REPO / "VERSION").read_text(encoding="utf-8").strip()
        self.assertEqual(BRIDGE_VERSION, version)
        package = json.loads((REPO / "extension" / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], version)

    def test_set_version_rewrites_every_place_that_repeats_the_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            (repo / "extension").mkdir()
            (repo / "docs").mkdir()
            (repo / "VERSION").write_text("3.9.4\n", encoding="utf-8")
            (repo / "extension" / "package.json").write_text('{\n  "version": "3.9.4"\n}\n', encoding="utf-8")
            (repo / "extension" / "package-lock.json").write_text(
                '{\n  "version": "3.9.4",\n  "packages": {\n    "": {\n      "version": "3.9.4"\n    },\n    "node_modules/x": {\n      "version": "3.9.4"\n    }\n  }\n}\n', encoding="utf-8")
            (repo / "README.md").write_text("RELEASE-V3.9.4 and releases/tag/V3.9.4\n", encoding="utf-8")
            (repo / "docs" / "index.html").write_text("<p>Latest release: V3.9.</p>", encoding="utf-8")
            changed = sv.set_version(repo, "4.0.1")
            self.assertEqual(sorted(changed), ["README.md", "VERSION", "docs/index.html", "extension/package-lock.json", "extension/package.json"])
            self.assertEqual((repo / "VERSION").read_text(encoding="utf-8"), "4.0.1\n")
            self.assertEqual(json.loads((repo / "extension" / "package.json").read_text(encoding="utf-8"))["version"], "4.0.1")
            lock = json.loads((repo / "extension" / "package-lock.json").read_text(encoding="utf-8"))
            self.assertEqual((lock["version"], lock["packages"][""]["version"]), ("4.0.1", "4.0.1"))
            self.assertEqual(lock["packages"]["node_modules/x"]["version"], "3.9.4", "a dependency's version is not ours")
            self.assertEqual((repo / "README.md").read_text(encoding="utf-8"), "RELEASE-V4.0.1 and releases/tag/V4.0.1\n")
            self.assertIn("Latest release: V4.0.1.", (repo / "docs" / "index.html").read_text(encoding="utf-8"))
            self.assertEqual(sv.set_version(repo, "4.0.1"), [], "running it again changes nothing")

    def test_set_version_refuses_a_version_that_is_not_three_numbers(self):
        with self.assertRaises(ValueError):
            sv.set_version(REPO, "3.10")

    def test_the_readme_badge_and_download_links_name_that_version(self):
        readme = (REPO / "README.md").read_text(encoding="utf-8")
        self.assertIn(f"RELEASE-V{BRIDGE_VERSION}", readme)

    def test_the_changelog_has_a_section_for_the_current_version(self):
        changelog = (REPO / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertIsNotNone(re.search(rf"^## \[V?{re.escape(BRIDGE_VERSION)}\]", changelog, re.MULTILINE))


if __name__ == "__main__":
    unittest.main()
