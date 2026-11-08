# SPDX-License-Identifier: GPL-3.0-or-later
import textwrap

from snapgent_mcp.limits import MAX_FOOTER_LINES
from snapgent_mcp.relations import build_footer
from snapgent_mcp.tools import call, reading
from tests.mcp_support import WorkspaceCase

NL = chr(10)


def src(text):
    return textwrap.dedent(text).lstrip(NL)


def footer_of(*lines):
    return NL.join(lines) + NL


def write_chain(case):
    """a calls b (line 5), b calls c (line 5)."""
    case.write("a.py", src("""
        from b import parse


        def run(x):
            return parse(x)
        """))
    case.write("b.py", src("""
        from c import tokenize


        def parse(s):
            t = tokenize(s)
            return t
        """))
    case.write("c.py", src("""
        def tokenize(s):
            return s.split()
        """))


class PythonChainTests(WorkspaceCase):
    def setUp(self):
        super().setUp()
        write_chain(self)

    def test_the_chain_names_each_function_its_lines_and_its_caller(self):
        self.assertEqual(build_footer(self.root, "a.py", 3), footer_of(
            "→ rantai pemanggilan:",
            "  b.py: parse() L4-6  ← dipanggil a.py L5",
            "    c.py: tokenize() L1-2  ← dipanggil b.py L5"))

    def test_depth_limits_how_far_the_chain_goes(self):
        footer = build_footer(self.root, "a.py", 1)
        self.assertIn("b.py: parse()", footer)
        self.assertNotIn("c.py", footer)

    def test_a_file_read_in_the_same_call_is_named_but_not_opened(self):
        self.assertEqual(build_footer(self.root, "a.py", 3, skip={"b.py"}),
                         footer_of("→ rantai pemanggilan:", "  b.py: ikut terbaca di panggilan ini"))

    def test_a_cycle_points_back_instead_of_looping(self):
        self.write("a.py", src("""
            from b import f

            def g():
                return 1

            def h():
                return f()
            """))
        self.write("b.py", src("""
            from a import g

            def f():
                return g()
            """))
        self.assertEqual(build_footer(self.root, "a.py", 5), footer_of(
            "→ rantai pemanggilan:",
            "  b.py: f() L3-4  ← dipanggil a.py L7",
            "    a.py: lihat di atas"))

    def test_a_file_reached_twice_is_written_once(self):
        self.write("a.py", src("""
            from b import fb
            from c import fc

            def run():
                fb()
                fc()
            """))
        self.write("b.py", "from d import fd\n\ndef fb():\n    fd()\n")
        self.write("c.py", "from d import fd\n\ndef fc():\n    fd()\n")
        self.write("d.py", "def fd():\n    pass\n")
        self.assertEqual(build_footer(self.root, "a.py", 3), footer_of(
            "→ rantai pemanggilan:",
            "  b.py: fb() L3-4  ← dipanggil a.py L5",
            "    d.py: fd() L1-2  ← dipanggil b.py L4",
            "  c.py: fc() L3-4  ← dipanggil a.py L6",
            "    d.py: lihat di atas"))

    def test_a_hub_file_is_named_and_not_opened(self):
        self.write("a.py", "from logger import log\n\ndef run():\n    log()\n")
        self.write("logger.py", "from c import tokenize\n\ndef log():\n    tokenize(1)\n")
        self.assertEqual(build_footer(self.root, "a.py", 3),
                         footer_of("→ rantai pemanggilan:", "  logger.py: file umum, tidak dibuka lebih dalam"))

    def test_a_secret_file_is_never_followed(self):
        self.write("s.py", "from secrets import token\n\ndef r():\n    token()\n")
        self.write("secrets.py", "def token():\n    pass\n")
        self.assertNotIn("secrets.py", build_footer(self.root, "s.py", 3))

    def test_a_module_called_through_its_name(self):
        self.write("a.py", "import b\n\ndef go():\n    b.parse(1)\n")
        self.write("b.py", "def parse(s):\n    return s\n")
        self.assertEqual(build_footer(self.root, "a.py", 3),
                         footer_of("→ rantai pemanggilan:", "  b.py: parse() L1-2  ← dipanggil a.py L4"))

    def test_an_import_whose_calls_cannot_be_seen_says_so(self):
        self.write("a.py", "from b import *\n")
        self.write("b.py", "def parse():\n    pass\n")
        self.assertEqual(build_footer(self.root, "a.py", 3),
                         footer_of("→ rantai pemanggilan:", "  b.py: diimpor, pemanggilan tidak terdeteksi"))

    def test_no_relations_and_no_support_are_told_apart(self):
        self.write("alone.py", "import os\n\ndef f():\n    return os.getcwd()\n")
        self.write("page.vue", "<template></template>\n")
        self.write("broken.py", "def (:\n")
        self.assertIn("tidak ada impor file lokal", build_footer(self.root, "alone.py", 3))
        self.assertEqual(build_footer(self.root, "page.vue", 3), "→ relasi: tidak didukung untuk .vue\n")
        self.assertTrue(build_footer(self.root, "broken.py", 3).startswith("→ relasi: file tidak bisa diurai"))

    def test_a_long_chain_is_cut_and_the_rest_is_counted(self):
        imports = NL.join(f"from m{i} import f{i}" for i in range(40))
        calls = NL.join(f"    f{i}()" for i in range(40))
        self.write("a.py", f"{imports}{NL}{NL}{NL}def run():{NL}{calls}{NL}")
        for i in range(40):
            self.write(f"m{i}.py", f"def f{i}():{NL}    pass{NL}")
        lines = build_footer(self.root, "a.py", 1).splitlines()
        self.assertEqual(len(lines), 1 + MAX_FOOTER_LINES + 1)
        self.assertEqual(lines[-1], "  +12 lainnya")

    def test_a_changed_file_is_read_again(self):
        self.assertIn("L4-6", build_footer(self.root, "a.py", 1))
        self.write("b.py", src("""
            from c import tokenize

            x = 1


            def parse(s):
                return tokenize(s)
            """))
        self.assertIn("L6-7", build_footer(self.root, "a.py", 1))


class JavaScriptChainTests(WorkspaceCase):
    def setUp(self):
        super().setUp()
        self.write("a.js", src("""
            import { parse } from './b.js';
            const c = require('./c');

            export function run(v) {
              parse(v);
              c.render(v);
            }
            """))
        self.write("b.js", src("""
            export function parse(s) {
              const o = { a: "}" };   // } in a string and a comment {
              return o;
            }
            export const other = (a) => a + 1;
            """))
        self.write("c.js", src("""
            function render(v) {
              return `${v}}`;
            }
            module.exports = { render };
            """))

    def test_imports_and_requires_are_followed_and_braces_in_strings_and_comments_are_ignored(self):
        self.assertEqual(build_footer(self.root, "a.js", 3), footer_of(
            "→ rantai pemanggilan:",
            "  b.js: parse() L1-4  ← dipanggil a.js L5",
            "  c.js: render() L1-3  ← dipanggil a.js L6"))

    def test_an_arrow_function_with_an_expression_body_is_one_line(self):
        self.write("d.js", "import { other } from './b.js';\n\nother(1);\n")
        self.assertEqual(build_footer(self.root, "d.js", 3),
                         footer_of("→ rantai pemanggilan:", "  b.js: other() L5  ← dipanggil d.js L3"))

    def test_a_typescript_file_is_found_behind_a_js_import(self):
        self.write("x.ts", "export function f() {\n  return 1;\n}\n")
        self.write("y.ts", "import { f } from './x.js';\n\nf();\n")
        self.assertEqual(build_footer(self.root, "y.ts", 3),
                         footer_of("→ rantai pemanggilan:", "  x.ts: f() L1-3  ← dipanggil y.ts L3"))

    def test_a_package_import_is_not_a_relation(self):
        self.write("p.js", "import React from 'react';\n\nReact.createElement();\n")
        self.assertIn("tidak ada impor file lokal", build_footer(self.root, "p.js", 3))


class ReadFilesRelationsTests(WorkspaceCase):
    def setUp(self):
        super().setUp()
        write_chain(self)

    def test_relations_are_off_unless_asked_for(self):
        self.assertNotIn("→", reading.read_files(self.ctx, ["a.py"]))

    def test_the_footer_follows_each_file_and_skips_files_read_in_the_same_call(self):
        text = reading.read_files(self.ctx, ["a.py", "b.py"], relations=True)
        self.assertIn("  b.py: ikut terbaca di panggilan ini", text)
        self.assertIn("  c.py: tokenize() L1-2  ← dipanggil b.py L5", text)

    def test_depth_and_ranges_work_through_the_tool_call(self):
        text = call(self.ctx, "read_files", {"paths": [], "ranges": [["a.py", "1-1"]], "relations": True, "depth": 1})
        self.assertIn("1: from b import parse", text)
        self.assertIn("b.py: parse()", text)
        self.assertNotIn("c.py", text)
