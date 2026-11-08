# SPDX-License-Identifier: GPL-3.0-or-later
from snapgent_mcp.relations import build_footer
from tests.mcp_support import WorkspaceCase
from tests.test_relations import footer_of, src

USERS = "application/controllers/Users.php"
REPORTS = "application/controllers/Reports.php"


class CodeIgniterTests(WorkspaceCase):
    def setUp(self):
        super().setUp()
        self.write(USERS, src("""
            <?php
            class Users extends CI_Controller {
                public function __construct() {
                    parent::__construct();
                    $this->load->model('user_model');
                    $this->load->helper('url');
                }

                public function index() {
                    $data = $this->user_model->get_all();
                    redirect('x');
                }
            }
            """))
        self.write("application/models/User_model.php", src("""
            <?php
            class User_model extends CI_Model {
                public function get_all() {
                    return $this->db->get('users')->result();
                }

                public function find($id) {
                    return $this->db->get_where('users', array('id' => $id))->row();
                }
            }
            """))
        self.write("application/helpers/url_helper.php", src("""
            <?php
            function redirect($uri) {
                header('Location: ' . $uri);
            }
            """))

    def test_a_model_and_a_helper_are_followed_and_only_the_called_methods_are_listed(self):
        self.assertEqual(build_footer(self.root, USERS, 3), footer_of(
            "→ rantai pemanggilan:",
            f"  application/models/User_model.php: User_model::get_all() L3-5  ← dipanggil {USERS} L10",
            f"  application/helpers/url_helper.php: redirect() L2-4  ← dipanggil {USERS} L11"))

    def test_a_library_a_model_in_a_subfolder_and_a_view_are_found(self):
        self.write("application/libraries/Mailer.php", "<?php\nclass Mailer {\n    public function send($to) {\n        return $to;\n    }\n}\n")
        self.write("application/models/admin/Role_model.php", "<?php\nclass Role_model extends CI_Model {\n    public function all() {\n        return array();\n    }\n}\n")
        self.write("application/views/users/list.php", "<p>hi</p>\n")
        self.write(REPORTS, src("""
            <?php
            class Reports extends CI_Controller {
                public function index() {
                    $this->load->library('Mailer');
                    $this->load->model('admin/role_model');
                    $this->load->view('users/list');
                    $this->mailer->send(1);
                    $this->role_model->all();
                }
            }
            """))
        self.assertEqual(build_footer(self.root, REPORTS, 3), footer_of(
            "→ rantai pemanggilan:",
            f"  application/libraries/Mailer.php: Mailer::send() L3-5  ← dipanggil {REPORTS} L7",
            f"  application/models/admin/Role_model.php: Role_model::all() L3-5  ← dipanggil {REPORTS} L8",
            "  application/views/users/list.php: diimpor, pemanggilan tidak terdeteksi"))

    def test_a_model_loaded_under_another_name_is_not_guessed(self):
        self.write(REPORTS, src("""
            <?php
            class Reports extends CI_Controller {
                public function index() {
                    $this->load->model('user_model', 'um');
                    $this->um->get_all();
                }
            }
            """))
        self.assertEqual(build_footer(self.root, REPORTS, 3), footer_of(
            "→ rantai pemanggilan:", "  application/models/User_model.php: diimpor, pemanggilan tidak terdeteksi"))

    def test_the_array_form_and_system_libraries_are_not_claimed(self):
        self.write(REPORTS, src("""
            <?php
            class Reports extends CI_Controller {
                public function index() {
                    $this->load->model(array('user_model'));
                    $this->load->library('form_validation');
                }
            }
            """))
        self.assertIn("tidak ada impor file lokal", build_footer(self.root, REPORTS, 3))


class PlainPhpTests(WorkspaceCase):
    def test_require_and_use_are_followed(self):
        self.write("a.php", src(r"""
            <?php
            require_once __DIR__ . '/lib/util_x.php';
            use App\Service\Mailer;

            function go() {
                $m = new Mailer();
                return fmt(1);
            }
            """))
        self.write("lib/util_x.php", "<?php\nfunction fmt($x) {\n    return $x;\n}\n")
        self.write("src/Service/Mailer.php", src(r"""
            <?php
            namespace App\Service;

            class Mailer {
                public function send() {
                    return 1;
                }
            }
            """))
        self.assertEqual(build_footer(self.root, "a.php", 3), footer_of(
            "→ rantai pemanggilan:",
            "  lib/util_x.php: fmt() L2-4  ← dipanggil a.php L7",
            "  src/Service/Mailer.php: Mailer() L4-8  ← dipanggil a.php L6"))

    def test_braces_in_strings_and_comments_do_not_end_a_function(self):
        self.write("p.php", src("""
            <?php
            function a() {
                $s = "}"; // {
                # }
                return $s;
            }
            function b() {
            }
            """))
        self.write("c.php", "<?php\nrequire 'p.php';\na();\n")
        self.assertEqual(build_footer(self.root, "c.php", 3),
                         footer_of("→ rantai pemanggilan:", "  p.php: a() L2-6  ← dipanggil c.php L3"))

    def test_a_class_name_shared_by_two_files_needs_the_namespace_to_settle_it(self):
        for folder in ("src/A", "lib/B"):
            self.write(f"{folder}/Mailer.php", "<?php\nnamespace X;\n\nclass Mailer {\n    public function send() {\n    }\n}\n")
        self.write("u.php", "<?php\nuse A\\Mailer;\n\nMailer::send();\n")
        self.write("z.php", "<?php\nuse Z\\Mailer;\n\nMailer::send();\n")
        self.assertEqual(build_footer(self.root, "u.php", 3), footer_of(
            "→ rantai pemanggilan:", "  src/A/Mailer.php: Mailer::send() L5-6  ← dipanggil u.php L4"))
        self.assertIn("tidak ada impor file lokal", build_footer(self.root, "z.php", 3))
