# SPDX-License-Identifier: GPL-3.0-or-later
from snapgent_mcp.relations import build_footer
from tests.mcp_support import WorkspaceCase
from tests.test_relations import footer_of, src


class GoTests(WorkspaceCase):
    def setUp(self):
        super().setUp()
        self.write("go.mod", "module example.com/app\n\ngo 1.21\n")
        self.write("internal/store/store.go", src(r"""
            package store

            func Open(name string) string {
                return name
            }

            func helper() {}
            """))
        self.write("internal/store/other.go", "package store\n\nfunc Close() {}\n")
        self.write("internal/strutil/trim.go", src(r"""
            package strutil

            func Trim(s string) string {
                return s
            }
            """))

    def test_packages_in_the_module_are_followed_to_the_files_that_define_what_is_called(self):
        self.write("main.go", src(r"""
            package main

            import (
                "fmt"

                "example.com/app/internal/store"
                str "example.com/app/internal/strutil"
            )

            func main() {
                fmt.Println(store.Open("x"))
                str.Trim(" a ")
            }
            """))
        self.assertEqual(build_footer(self.root, "main.go", 3), footer_of(
            "→ rantai pemanggilan:",
            "  internal/store/store.go: Open() L3-5  ← dipanggil main.go L11",
            "  internal/strutil/trim.go: Trim() L3-5  ← dipanggil main.go L12"))

    def test_a_function_of_the_same_name_does_not_hide_a_call_through_the_package(self):
        self.write("x.go", src(r"""
            package main

            import "example.com/app/internal/store"

            func Open() {
                store.Open("a")
            }
            """))
        self.assertEqual(build_footer(self.root, "x.go", 3), footer_of(
            "→ rantai pemanggilan:", "  internal/store/store.go: Open() L3-5  ← dipanggil x.go L6"))

    def test_standard_library_imports_are_not_relations(self):
        self.write("solo.go", src(r"""
            package main

            import "fmt"

            func f() {
                fmt.Println(1)
            }
            """))
        self.assertIn("tidak ada impor file lokal", build_footer(self.root, "solo.go", 3))


class RustTests(WorkspaceCase):
    def test_mod_and_use_are_followed_and_only_called_functions_are_listed(self):
        self.write("Cargo.toml", "[package]\n")
        self.write("src/strings.rs", "pub fn slug(s: &str) -> String {\n    s.to_lowercase()\n}\n")
        self.write("src/net/mod.rs", "pub mod client;\n")
        self.write("src/net/client.rs", src(r"""
            pub struct Client;

            impl Client {
                pub fn new() -> Client {
                    Client
                }

                pub fn send(&self) {}
            }
            """))
        self.write("src/main.rs", src(r"""
            mod strings;
            mod net;
            use crate::net::client::Client;

            fn main() {
                let c = Client::new();
                strings::slug("a");
            }
            """))
        self.assertEqual(build_footer(self.root, "src/main.rs", 3), footer_of(
            "→ rantai pemanggilan:",
            "  src/strings.rs: slug() L1-3  ← dipanggil src/main.rs L7",
            "  src/net/mod.rs: diimpor, pemanggilan tidak terdeteksi",
            "  src/net/client.rs: Client::new() L4-6  ← dipanggil src/main.rs L6"))

    def test_lifetimes_character_literals_and_strings_do_not_confuse_the_end_of_a_function(self):
        self.write("Cargo.toml", "[package]\n")
        self.write("src/text.rs", src(r"""
            pub fn first<'a>(s: &'a str) -> &'a str {
                let open = '{';
                let _ = "}";
                s
            }
            """))
        self.write("src/main.rs", "mod text;\n\nfn main() {\n    text::first(\"a\");\n}\n")
        self.assertEqual(build_footer(self.root, "src/main.rs", 3), footer_of(
            "→ rantai pemanggilan:", "  src/text.rs: first() L1-5  ← dipanggil src/main.rs L4"))

    def test_external_crates_are_not_relations(self):
        self.write("Cargo.toml", "[package]\n")
        self.write("src/main.rs", "use std::fmt;\nuse serde::Serialize;\n\nfn main() {}\n")
        self.assertIn("tidak ada impor file lokal", build_footer(self.root, "src/main.rs", 3))


class HtmlTests(WorkspaceCase):
    def test_local_scripts_and_styles_are_listed_and_a_called_function_is_shown(self):
        self.write("index.html", src(r"""
            <!doctype html>
            <link rel="stylesheet" href="css/site.css">
            <script src="js/app.js"></script>
            <button onclick="save()">x</button>
            """))
        self.write("css/site.css", "body {}\n")
        self.write("js/app.js", "function save() {\n  return 1;\n}\n")
        self.assertEqual(build_footer(self.root, "index.html", 3), footer_of(
            "→ rantai pemanggilan:",
            "  css/site.css: dirujuk, isi tidak dianalisis (.css)",
            "  js/app.js: save() L1-3  ← dipanggil index.html L4"))

    def test_addresses_with_a_scheme_are_not_relations(self):
        self.write("page.html", "<script src=\"https://cdn.example.com/x.js\"></script>\n<script src=\"//cdn.example.com/y.js\"></script>\n")
        self.assertIn("tidak ada impor file lokal", build_footer(self.root, "page.html", 3))
