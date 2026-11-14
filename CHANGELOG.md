# Changelog

All notable changes to snapgentV3 Free are documented here.

## [Unreleased]

### Security
- **A privilege command written in one piece is seen again.** The model writes a command the way a person types it, so `sudo rm -rf /` can arrive as one value instead of a program and its arguments. The check that looks for `sudo` and its friends read the whole value as the program's name, missed it, and in Auto the command ran without asking. A command line is now split once, before the policy looks at it: the program and the arguments are apart for the approval check, for the run, and for the log — so `sudo rm -rf /` asks for the user's approval, in every mode, as it always should.

### Fixed
- **The last command of a reply is not lost any more.** The text of a reply is trimmed before it is read, so the last command block ends exactly where the reply ends — and a block that ends there was taken for one the model had not finished writing, and left out. The last command of every reply therefore never ran (three commands written, two run; four written, three run). A command block has no end of its own, so it is now read whenever it is there; only a block that still has its fence open is left for the next tick, because that one is still being written.
- **Two commands written one after the other are two commands.** A site that renders a command block as a code block leaves the next one right behind it, with no line between them, and the two were read as one block: the second command's name and parameters replaced the first one's, so only one command ran. A `name:` line now always starts a new block.
- **A command written in one piece now runs as it says.** `run_command` wanted the program and its arguments apart, so `{"command": "sleep 5"}` was run as a program called "sleep 5" and failed with *No such file or directory*. A command line that is not a program of its own is split into the program and its arguments (`npm test` → `npm test`), the arguments the model gave come after it, and a command that IS a program (it is on PATH, or it is a path) is left exactly as it is. The result is that the command the AI wrote is the command that runs — in the JSON shape and in the command block alike.
- **The command a failure reports no longer says "undefined".** A command with no arguments was shown as `sleep 5 undefined`, which read as if the AI had written something wrong.

### Added
- **A command can be written in the command block instead of JSON.** The shape of a command is now a **template of its own** in Preferences (*Command format*), with two ready-made shapes one click away: the JSON envelope the extension has always read, and the **command block** — a fenced block of `key: value` lines where nothing is escaped:
  ```
  ```command
  name: edit_file
  path: src/a.js
  old_text: |
      const x = "hello";
  ```
  ```
  A file's content or a command line with quotes in it goes in as it is, so the escape dance JSON needs (and that models sometimes get wrong, which cost a command) is gone. A value that is a list, a number or true/false is written as JSON (`["a.js","b.js"]`, `5`, `false`); the tool's own schema says what each parameter is, so a boolean stays a boolean. **Both shapes are read, whichever the AI is taught**, so nothing breaks if it writes the other one. The block is read from the text of the code block the site renders it into, with or without the fence around it (a site keeps the text, not the fence) — and a block that was cut off in the middle is not run. The terminal takes both shapes too: a command copied from the chat runs as it is, the examples it offers are written in the shape in use, and the empty input says which shape that is. Everything that shows a command shape repeats the same template: the start message, the reminder under a result, the example of a command that failed and the note that asks for a rewrite. An empty template means the JSON shape, as before. A template you saved before this change keeps working: the paragraph that taught the JSON shape is replaced by the shape in use (the two never stand next to each other), and a template that never mentioned the shape gets it before the closing question.
- **The agent waits when you tell it to.** Two number fields in Preferences — the seconds to wait — : **Delay per command** (a pause after every command that runs, before the next one starts) and **Random delay after the commands** (a random pause of up to that many seconds, after all the commands of a reply have run and before the results go back to the AI). Both are 0 (off) by default, and both are the same on every site. The composer says what is going on: while a command runs the line reads `Running command 1/3 · run_command · sleep 10` — the pause that follows, named but not counted among the commands — and while the agent waits it reads `delay 10`, counting down to the last second. Stop ends the wait at once, and nothing is sent back to the AI after it.
- **The wording of the messages the AI reads is yours to write.** The start message, the reminder under a result, the answer of a command that ran and the report of one that failed were fixed texts that read like the output of a program (`» tree`, `ERROR calling 'tree': …`, "System note from snapgent"). They are now **templates in Preferences**: five text boxes — *Start message*, *Reminder*, *A command that worked*, *A command that failed*, *Reminder in a long chat* — each with a button right under it that writes an example of that message into the text box, so you can see what the AI will read before you save it. A message is built from your text and a few placeholders (`{{project}}`, `{{commands}}`, `{{tree}}`, `{{command}}`, `{{output}}`, `{{error}}`, `{{example}}`, …); the panel lists the ones each template may use. A paragraph whose value is empty is left out of the message, so a template may hold an optional part (the project tree, the instruction file) without it showing up when there is nothing to show. An empty text box falls back to the wording the extension ships with, so nothing can break by accident, and "Restore the defaults" puts them all back.
- **The messages read like a chat now.** A command that ran says `I ran \`tree .\` for you` — the command as it would be typed in a terminal, not the name of a tool — and shows what came back under it. A command that failed says the command did not work, says why, and shows the call as it should be written (`{"command":"tree","params":{"args":"."}}`), so the model sees the shape it should use. The start message opens with the project, says that there is an MCP server running for the chat and that the commands are the only way to learn anything about the project. The reminder says in plain words that it is a note and not a new task.
- **SSH connections work on Windows.** The bridge used to refuse SSH there, because it held the login open with OpenSSH's shared connections (`ControlMaster`), which Windows does not have. Windows now gets one `ssh` per command instead (`ssh_direct.py`, chosen by `ssh_session.new_session`): the first connection signs in and may ask (a host seen for the first time, a key with a passphrase) through the same popup in the extension, and every command after it runs in `BatchMode` so it can never sit waiting for a person. Linux and macOS keep the shared connection unchanged. The price on Windows is a new connection per command; the gain is that SSH works where a shared connection cannot exist. Two supporting changes: the askpass helper reaches the bridge over a loopback port (with the same random token) because asyncio has no unix sockets on Windows, and `snapgent.exe` recognises itself as the helper from that token, since ssh passes the question where a `--askpass` flag would go. `version_problem` also accepts `OpenSSH_for_Windows_*`. Note for Windows: SSH over there needs a key, not a password typed per command, and the ssh program must be the one Windows ships (Settings > Optional features > OpenSSH Client).

## [V3.9.43] - 2026-11-11

### Security
- **`sudo` and other privilege escalation now always asks for approval, also in Auto.** Auto (the server's `trusted` mode) used to approve every command before looking at it, so `sudo` ran with no prompt. A command that runs as another user (`sudo`, `sudoedit`, `su`, `doas`, `pkexec`, `runuser`, `runas`) now needs the user's approval in Manual and in Auto, even when the name is on the `SNAPGENT_ALLOWED_COMMANDS` list. It is also found inside a shell or wrapper program (`bash -lc "sudo ..."`, `env sudo ...`, `timeout 5 sudo ...`, `xargs`, `nohup` and similar). The check is deliberately blunt: a false alarm costs one click, a miss gives the model root. Plan mode still refuses every command. The logic is `escalates_privileges()` in `security/commands.py`, called from `security/decision.py` before the Auto shortcut.

### Added
- **A command that takes longer than one call may wait is no longer stopped and reported as a timeout.** The extension, the bridge and the server each gave up on a command after 120 seconds and the first of them to do so won: the model got `timed out ... try a shorter call` with no output, and a build that had run for two minutes was lost. A command still running after 100 seconds (`run_command`, `run_project_script`, `run_tests`) now goes on in the background, and the call answers with the end of what it printed, how big the output is and how to follow it: **`wait_command`** waits up to 90 seconds for it to finish and returns only the output printed since the last look (shown in the terminal panel as it arrives), **`get_command_output`** reads any part of the output so far, and **`stop_command`** ends it and what it started. Everything it prints is also written to a log file in the temporary folder (`snapgent-<run_id>-<random>.log`, readable by the user only, named in the note so the user can follow it with `tail -f`). A command left running is stopped by itself after 60 minutes, at most 5 run at once (one more that takes too long is stopped as before), and a finished one is forgotten with its log after an hour. Stop in the bar still ends a command that is inside the 100-second window; once it went on in the background, `stop_command` ends it.
- **Logins can be exported to a file and imported back** (Claude and DeepSeek, through the same code: any site that offers accounts gets it). The Accounts section of the popup has **Export** and **Import** buttons. Export writes every saved login of the site to `snapgent-accounts-<site>.json`; Import adds the logins of such a file and replaces a login of the same name, without switching the login in use. The file holds live cookies (and DeepSeek's token), so it is as sensitive as the password: the popup says to keep it private, and nothing is exported unless the user presses Export. An import only takes what a login is made of (known cookie fields, cookies of the site's own hosts, the page-storage keys the registry names, names that can be an account); a file of another site, another format or another version is refused with a reason. The download and file-picking code that calibrations used now lives in `ui/file-transfer.js` and is shared. Import opens its file window on the chat page, not in the popup: a file window takes the popup's focus and closes it, so nothing happened once a file was chosen; the page shows what came of the file.
- **Two checkboxes in Preferences choose what the start message carries**: *Send the project tree at the start* and *Send the project instruction files at the start*. Both are on by default, so nothing changes until one is switched off, and "Restore the defaults" ticks them again. With the tree off the start still checks that a folder is open (it reads only the top level) but sends no tree; with the instruction files off none is read.

### Changed
- **The terminal shows what ran and when.** Above the output, an info strip gives the selected command in full (wrapped, not cut like the tab's name) and when it started, ended and how long it took, down to the second in local time. Hovering a tab shows the same in a tooltip. The strip for a running command shows its start time; the end and duration appear when it settles.

### Fixed
- **The log file of a long command stayed empty until the command ended.** The file in the temporary folder was only made when the command went on in the background (after 100 seconds) and the pipes were read line by line, so text without a newline (a progress bar, a prompt) was held back until the process ended. The log is now made when the command starts, every piece of output is written to it as it arrives, and pipes are read in pieces instead of lines. A command that ends inside the 100-second window removes its log. What the model is sent (the first 20 and last 50 lines) is unchanged.
- **The tree in the start message ignored the folders left out of attachments.** Only the `@` list and the Files menu used that list, so a folder such as `.sqlx` that was added to it still filled the tree. The list is now sent with the tree request, and the server adds it to its own list of skipped folders.
- **The folders left out of attachments were still listed when the model asked for the tree itself.** The fix above only covered the tree of the start message: a `tree` the model wrote later (and its `search_files` and `find_files`) went to the server with no list, so `.sqlx`, `bruno` or `.claude` came back whenever the server did not skip them on its own. The runner now adds the list from Preferences to the `exclude` of those three commands, together with any `exclude` the model wrote. The file list of the `@` menu (`find_files` with `exclude_only`) is left as it was.
- **With the wait-longer switch (Patient) on, a command that appeared after the loop had already ended was never picked up.** The resume watchdog skipped any reply as `stale` once the site's "generating" signal had been silent for 3 minutes, and a site with no such signal never sets it. With the switch on, the watchdog no longer judges freshness by that signal, so a complete command that shows up late is run.

### Added
- **`read_files` can read only some lines.** A new optional `ranges` parameter takes `[path, lines]` pairs, where `lines` is `"21-40"`, `"5-10,40-60"` or a list such as `["1-10", "15-25"]`. Lines keep the file's own numbers, so they match `edit_file`. An entry without lines (`[path]` or just the path) reads the whole file instead of being an error. A path named in `ranges` with lines is read only for those lines, a range past the end of the file is cut there with a note saying how long the file is, and a bad range is an error for that file only. Paths named in `ranges` go through the same secret-file approval as `paths`.
- **`read_files` can show what a file calls into.** The footer is on by default (`relations: false` turns it off) and is added to each file: a chain of the files it imports, with the function it calls there, that function's line range and the line of the call, so the next read can use `ranges` instead of whole files. `depth` (default 3) sets how deep it goes. The footer is cut at 28 lines (`+N lainnya`), writes a file reached twice only once, names shared helpers (`logger`, `utils`, `config`, ...) without opening them, never follows secret files, and names a file read in the same call instead of opening it. It says whether a language is `tidak didukung` or simply has no local imports, and only follows what the source states outright (static imports and calls by name), never names matched across files. Python (`ast`), JavaScript/TypeScript, PHP, Go, Rust and HTML (regular expressions, no extra dependency) are supported; parsing is cached by modification time. For PHP the footer follows CodeIgniter 3's `$this->load->model/library/helper/view('x')` (mapped to `application/models`, `libraries`, `helpers` and `views`, and called as `$this->x->method()`), `require`/`include` with a literal path, and `use Name\Kelas;` when exactly one file fits. A model loaded under another name, the array form of the loader and system libraries are not followed rather than guessed. For Go it follows imports of packages inside the module (the module name comes from `go.mod`) to the files that define the functions called as `pkg.Func(`; calls inside the same package and method calls on variables are not seen. For Rust it follows `mod x;` and `use crate::`, `self::` and `super::` paths to `x.rs` or `x/mod.rs`, with calls written as `name(`, `module::name(` and `Type::name(`; method calls on values are not seen. For HTML it lists the local files named by `<script src>` and `<link href>`, and the functions of those scripts that the page calls by name (an inline `onclick`, for example); a style sheet is named, not opened. A function of the same name in the calling file no longer hides a call written through a module or package (`pkg.New()`). The system prompt now tells the model, when `read_files` offers it, to use the footer to pick what to read next, read pieces with `ranges`, and pass `relations: false` when re-reading. Files that hold prose or data (`.md`, `.json`, `.yml`, `.css`, ...) get no footer unless `relations: true` is passed, and the files a user attaches with `@` never get one.

### Changed
- **A long command output reaches the model as a preview, not in full.** `run_command`, `run_project_script` and `run_tests` (and the answers of `wait_command` and of a command that went on in the background) now show only the first 20 and the last 50 lines when the output is longer than that. In place of the middle comes a note that says how many lines were left out, names the `run_id` and gives ready calls: `get_command_output` with `max_lines: 5000` reads the whole log, and with `start_line: -200` reads more of the end (where an error usually is), so the command is never run again. A failing command gets the same preview inside its error. The old size limit (`max_output_chars`, 40,000 characters by default) stays as a safety net for a few enormous lines, and the system prompt now tells the model about the preview. The numbers live in `limits.py` (`PREVIEW_HEAD_LINES`, `PREVIEW_TAIL_LINES`) and the logic in the new `preview.py`.
- **The extension is called `snapgent`.** The `V3` suffix is gone from everything a user or a model sees: the manifest name and toolbar title, the popup header, the menu, dialog and setup-card labels, the banners, the console log prefix, the names of the files it attaches, the trust question the bridge asks in its terminal, and the messages the model reads (error feedback, reminders, the target-selector notes). The GitHub release title and the docs follow. Only the name changed: ids, storage keys, the bridge protocol, the folder layout and the `zs-` selectors are untouched, so an existing install keeps its settings, its remembered sessions and the folders its chats work in.

## [V3.9.4] - 2026-11-07

### Terminal
- **Command examples**: an Examples button in the terminal opens a list of every command the selected MCP server offers, each with a ready JSON call (required parameters filled with placeholders, the optional ones named) that can be copied, or put in the terminal's input to edit and run.

### Tutorial
- **An Info button opens a tutorial** beside the other tool buttons of the bar. The tutorial is written in Markdown, one file per language (`extension/tutorial/id/tutorial.md` and `extension/tutorial/en/tutorial.md`); the dialog follows the browser's language and has an ID/EN switch that is remembered. A line `@gambar(file.png)` places an image from `extension/tutorial/images/`, and `@gambar(file.png, width=300)`, `height=50%` or both set its size, the side left out staying automatic. The build embeds the images in the extension, so nothing is fetched from the page, and it stops with a clear message when a named image is missing.

### Workspace per chat
- **A chat works in the folder it was started in.** The server used to follow VS Code's active window on every command, so a second chat (or a window switch, or a server restart that dropped the pin) moved a running chat into another project: `read_files` of `vue/src/...` failed because the root had silently become another folder. The folder is now kept per conversation, survives reloads, and is sent with every command (an argument only the extension can set).
- When VS Code has more than one folder open, starting a session asks which one; a pinned folder is the default and is used without asking. Choosing a folder in the bar's workspace menu sets it for the current chat.
- **Antigravity IDE's folder is found.** It is a VS Code fork and keeps the same `storage.json`, so it is read the same way: on Linux/macOS from `<config>/Antigravity IDE/User/globalStorage/storage.json`, on Windows under `%APPDATA%` for every known product (not only `Code`). When several of them have a folder open, VS Code wins, then Insiders, VSCodium and Antigravity. A closed editor's stale state is only distrusted on Windows, and only for products whose process name is known (`Code`), so Antigravity keeps working there.
- Older chats adopt the folder the server has at the time they are first used. A chat whose folder is not open because VS Code is closed shows `Active · open <folder> in VS Code`, and the model is told to ask the user rather than being given an empty command list.

### Accounts: switching logins without signing out (Claude first)
- **A login can be saved and switched back to.** The extension popup has an Accounts section (the ☺ button) for sites that offer it — Claude for now. The cookies of the session the site has now are saved under a name the user gives; switching writes another saved account's cookies back and reloads the site's tabs. Nothing is logged out on the server, so the account that was switched away from is still there when it is switched back to. Cookies are only ever read and written in the background worker (`cookies` permission, added only because a site offers accounts), never travel to the popup as values, are never exported or synced, and are removed with the account.
- A switch is refused while the agent is running in that chat, since the running loop would be left talking to a session that is no longer there. The session in use is saved before it is replaced when it is a known account; when it is not, it is replaced and the popup says so.
- The folders a chat works in are now kept per login: the same chat URL under another account no longer inherits the folder the first account's chat worked in.
- The popup's "Max message size" slider is gone; the value lives in Preferences, where the rest of the message settings are.

### Output as file, folders without an editor, and a command guard
- **Output as file** (Preferences): a message longer than the message size can be attached to the chat as a `.txt` file instead of being sent in parts (up to 5, the rest cut). The choice is kept per AI in its calibration (`limits.asFile`, exported and imported with it) or generally (`zsOutputAsFile`); the start message is never turned into a file, because a session is recognised by its words on the page.
- **Folders without an editor**: the MCP server lists its tools whether or not an editor has a folder open (every call carries the folder its chat works in). The bridge keeps the folders used lately (at most 10, in `config.json`), the start question offers them after the editor's open ones, and the bar's folder menu lists them too. With nothing at all to offer, the message says how to choose a folder instead of "no folder open".
- **`run_command` guard**: an argument that names a place outside the workspace root (an absolute path, `~`, a `..` that climbs out, `--flag=/path`) is refused with a message that names the root. A heuristic against the usual accident, not a sandbox.

### Speed and clarity
- **Native tool markup is run, not rejected.** When a model writes a call in its own markup (DeepSeek's DSML `invoke`/`parameter`) the extension now reads and runs it, instead of answering with an error and waiting for a rewrite (a wasted round trip). The result message ends with a note telling the model not to use its internal tools and to call snapgentV3's general commands next time. Formats live in `domain/parser/native/` (one file each, registered in `index.js`), for every site alike.
- The idle wait after a reply is shorter when the site shows a stop button (it ends 0.4 s after the button goes, not 2 s after the last word), sending and polling waits are shorter, and the page is read once per change rather than several times per tick. The VS Code folder is cached until VS Code's state file changes.
- The text above the composer says what is really happening: waiting for the reply, the reply being written, checking it is complete, reading the commands, `Running command 1/2 · ...`, `2/2 commands done · sending the results to the AI...`.

### Build and release
- The project now lives at `github.com/zoelfikarshomelab/snapgent-connector`; links in the README, the project page and the extension point there, and credit to the original project (`herdodp/snapgent-connector`) is kept. The Firefox add-on id is unchanged, so existing installs keep working.
- **Tidy repository root**: the bridge, the VS Code server, their launchers and PyInstaller specs moved
  into `server/` (same layout as the release zip); tests moved into `tests/`. Release zips are unchanged.
  From a clone, run the launchers from `server/`.
- **CI and automatic releases** (`.github/workflows`): lint, tests on three operating systems, and
  Windows executables built from source on every release tag. `bridge.exe` and `vscode_mcp.exe`
  are no longer committed; this also fixes the Windows executable shipping without the security fixes.
- Frozen executables keep `config.json` and `logs/` next to the `.exe` (not in a temp folder).
- `scripts/package_release.py` assembles the release zip (tested).

### Fixed
- **A calibration made in a new chat did not work in an open one (and the reverse).** The selectors learned for the text box named things that change
  with the page's state: Grok's text box is a `combobox` in a new chat and a `textbox` in an open one, Mistral's placeholder exists only in a new chat.
  Calibrating now ignores roles, placeholders, `aria-expanded`-style states and state classes (`is-empty`, `ProseMirror-focused`, ...). A profile that
  already names them heals itself: when its selector finds nothing, the page is searched with the selector's relaxed form, with the text box's role
  swapped for its sibling roles, and finally for the page's only text box outside the turns (noted in the log as `composer.healed`).
- **A message typed into a calibrated site never reached the agent directly.** The send hooks were made once at page load, while the
  provider was still the "not calibrated" one (the stored profile is read a moment later), so they were empty; only the one-second resume
  watchdog started the loop. The hooks are now made again whenever the provider changes, so a typed message starts the agent at once.
- **A command's output kept its start and lost its end.** Output beyond the limit is now cut in the middle (head + tail) with a note of
  how much was left out, because a failing build says why at the end. stderr is kept next to stdout (it was dropped whenever stdout
  had anything), and `read_files` cuts even its first file to the budget it is given.
- **Only the first command of a reply was read.** The parser stopped at the first JSON command, so a second one in the same reply was
  dropped without a word. Every command is now read, in order.
- **A reply with a "thinking" section was read from its thoughts.** A turn holds the reply-body selector twice (the thoughts, then the
  answer) and the first match was taken, so a command in the answer was never seen. The last match is taken now.
- **A long tool call no longer makes the bridge look offline.** The bridge handled one request at a time per connection, so a
  minute-long command (a docker build) left the extension's pings unanswered; the extension then dropped the socket and told the
  model the bridge was unreachable. Each request now runs on its own task.
- `run_command` waits up to 120 seconds (was 30) and says plainly when it stopped a command that took longer.
- The bridge's terminal shows only where it listens, the approval question and fatal errors; everything else is in `logs/bridge_debug.log`.

### Fixed (server)
- **Commands failed with `bash: symbol lookup error` in the Linux program.** The one-file program points `LD_LIBRARY_PATH` at its own bundled libraries and its children
  (bash, git, cargo) inherited it; they now get the user's own value back, with the unpacked folders of the program (and of the bridge that started it) taken out.
- **`search_files` and `find_files` were slow in big projects.** They walked into `target/`, `vendor/`, `.cache/` and the like only to drop the files afterwards; those
  folders are no longer entered. `search_files` also skips binary files and files over 1 MB, and stops after 20 seconds with what it has found (and says so).
- **Tagging files was slow to load, and the list missed new files.** Listing a project took seconds (a path calculation per file, and everything was walked even
  though only 2000 files were returned); it is now about a tenth of a second for 2000 files and under a second for 50,000, and the list for tagging covers the whole
  project instead of its first 2000 files. The list is read again after any command ran and when the workspace changes (a plan saved in `.snapgent/plans/` is found
  at once), and an open `@` list follows when it changes.
- **The file list no longer drowns in generated folders** (`.rustup`, `.cargo`, `target`, ... differ per framework). In a git project the list is what git counts as
  the project (tracked files, and new files `.gitignore` does not hide), so it follows each project's own `.gitignore`; `.snapgent/` (plans) is listed even if ignored.
  Without git, a longer list of toolchain and cache folders is skipped. `search_files` uses the same list.
- **The workspace check no longer lists the whole project every 5 seconds**: it asks for the root folder only, so it cannot time out on a big project.

### Added
- **Plan mode can save the plan.** Besides reading, the AI may now create and edit Markdown files (any name, any depth) under `.snapgent/plans/`
  (for example `.snapgent/plans/add-login.md`); every other change is still refused in Plan mode, and the refusal message tells it where it may write.
- **Preferences panel** (the new ☰ button in the "Switch AI" menu): message size, commands per reply (moved here from the toolbar popup, which keeps the message
  size), and the **folders left out of the files you can attach**, one name per line, with the usual ones (`node_modules`, `target`, `.rustup`, ...) as the
  starting list and a button to restore it. Saved as your preference, the same on every site; the `@` list and the Files menu follow it at once. In a git project
  `.gitignore` still applies on top.
- "Copy diagnostics" also says which approval mode (plan / manual / auto) the page is sending.
- **The composer says exactly what is running**: `1/4 · run_command · go test ./... -run TestLogin` (the command with all its arguments, other tools with their first argument in full), up to three lines, and the full text on hover.
- **Attach a folder.** Tag a folder like a file (`@src/` or `@"my folder/"`, from the `@` list or the Files menu, where folders are listed with a closing
  slash): every text file under it is read and attached (images, archives and lock files are skipped; up to 200 files).
- **Commands per reply is a slider** in the popup (1 to 30, 8 by default), next to the message size.
- **Output that does not fit in one message continues in the next ones** (up to 5 messages) instead of being cut. The first message says "Part 1 of N",
  the AI is told to answer only briefly (for example "received") and not to act yet, and the extension sends the next part when it has answered; the last part
  says it is everything. The same goes for attached files and folders. Commands the AI sends between the parts are not run (it is told so). Stop, or an error,
  drops the parts still waiting.
- **One program on every system.** `snapgent.exe` (Windows) and `snapgent` (Linux) are the same program: it writes its own `config.json`, replaces an
  older Snapgent bridge on the port (on Windows found with `netstat`, ended with `taskkill`) and serves; when started by a double-click its window waits
  for Enter at the end so a message can be read. macOS runs the same program with `python3 server/snapgent.py` (`pip3 install websockets`); a ready-made
  macOS program comes later. CI builds it on Windows and Linux and checks that it answers as the VS Code MCP server, listens, and is replaced by a second start.

### Removed
- **The old launchers and programs**: `start.bat`, `Linux_Start.sh`, `MacOS_Start.command`, `setup-config.py/.ps1`, `bridge.py`, `vscode_mcp.py`, and the
  `bridge.exe` / `vscode_mcp.exe` builds. A release is now `snapgent.exe`, `snapgent-linux-x64-v<version>.tar.gz` and `snapgent-extension-v<version>.zip`.
- Automatic detection of EffectCraft and Roblox Studio (it lived in the setup scripts): add those servers to `config.json` yourself.

- **Calibrations that ship with the extension.** `extension/profiles/default-calibrations.json` (the file "Export all calibrations" writes) is built into the
  content script, and a site the user has not calibrated is read with the profile shipped for it, so a new user starts without calibrating. The user's own
  calibration always wins, and an own profile that is not usable falls back to the shipped one. "Copy diagnostics" says whose calibration is in use.
- **Export and import every calibration at once.** The "switch AI" menu has **Export all calibrations** (one file, `snapgent-calibrations.json`, kept apart
  per AI: `sites.<id>.profiles.<host>`) and **Import calibrations…**: choose one or more files (that file, or single-site files from "Export calibration"),
  see what they hold per AI, in the order of the menu, untick the ones you do not want (an AI you already calibrated is marked as replaced) and
  import. A profile that is not usable is left out and named.
- **Typing `@` in the message opens the file list** beside the composer: what follows the `@` is the search, ↑↓ Enter/Tab choose (the `@word`
  is replaced by `@path/to/file`, the same tag the Files menu inserts), Esc, ✕ or a click elsewhere closes it, and **Turn off** (also a
  checkbox in the Files menu) stops it for good. A name with spaces is written `@"docs/My Notes.md"`; single quotes and backticks are read too, and
  an unquoted name that runs into spaces is still attached when it names a file. Only the tag at the end of the text opens the list.
- **Files menu in the bar** (while a VS Code session is on): search the workspace's files, tick up to 20 and **Insert** them as `@path` in the
  composer. When the message is sent, the page holds it back, reads the tagged files with `read_files` (line numbers, the message size limit and
  the same approval for a file that may hold secrets) and sends the message with the contents under it, so the model does not spend a turn
  reading them. An `@path` typed by hand that names a file of the workspace is attached the same way. The system prompt tells the model the
  attached files are current.
- **Several commands in one reply.** They run in order and are answered with ONE message (fewer turns, so fewer requests). A failure, an
  image result or a stop ends the batch and the rest is listed as `NOT RUN` so the model can send it again. The composer cover says
  which command is running (`Running 2/4 · run_command · command: sleep`).
- **One size limit per message**, set with a slider in the toolbar popup (20k to 400k characters, 100k by default; a site that refuses a
  message as too long lowers it for that site). The command reminder and a re-stated system prompt count too. Each command in a batch gets
  a share of what is left, tools that can limit their own output do (`read_files` lists the files that did not fit), and a message that
  is still too big is trimmed in the middle. A toast suggests a new chat when a conversation has sent a lot.
- **`get_command_output`**: the cut part of a command's output stays on the server under a `run_id` (the last 20 runs) and can be read
  by line range without running the command again.
- **Commands are jobs.** The extension names each command (batch id + place + content) and the VS Code server keeps it under that name.
  If the page is reloaded in the middle of a batch, the reply is run again under the same name: what already ran is answered from the
  server, a command still running is waited for, the rest runs. **Stop** now ends the process (and what it started) instead of only
  giving up waiting. The server answers several requests at once so a running job can be asked about or cancelled. Reading tools are
  not kept (they are cheap to repeat and should show fresh data). A restart of the bridge or the server clears the record.
- **Stop while the bar is hidden**: a Stop button appears on top of the show/hide button (under it when the bar sits in the top corner).
- **The project tree and the command list reach the model at the start.** If the model answers the start prompt in plain words instead of
  asking for the command list, the extension fetches it and sends it together with the tree (within the size limit).
- Start diagnostics (`start.*`, `send.*`, `resume.skip`, `loop.crash` in the `[zs-diag]` log) say why a session did not begin or a reply was not run.
- **Choose the workspace in the bar**: a pill beside the mode pill. *Auto* (default) follows VS Code's active window as before; the menu
  also lists every folder VS Code has open, and **Choose a folder…** opens the system's own folder window (through the desktop portal, zenity, kdialog, PowerShell or osascript), so no path is copied by hand; a box for typing a path only appears when the machine has no folder window. The bridge keeps
  the chosen folder until it is changed or the bridge restarts. The root folder or a whole drive is refused.
- **Plan / Manual / Auto in the bar**: a dropdown pill chooses how the VS Code server treats risky actions. *Plan* allows reading only
  and tells the model to describe its plan; *Manual* asks before deleting, committing or running commands (as before); *Auto* never asks
  (switching to it asks once). The choice is kept for every site and sent with each call in a reserved argument the model cannot set.
  A mode fixed in `config.json` (`SNAPGENT_POLICY`) stays a ceiling: the bar can tighten it, never loosen it. Hard rules (nothing inside `.git`) apply in every mode.
- **One program for Linux (beta)**: `snapgent` runs the bridge, and `snapgent --vscode-mcp` runs the VS Code MCP server the bridge
  starts, so a release needs no Python. It writes its own `config.json`, replaces an older Snapgent bridge on the port, and is built by
  CI on Ubuntu 22.04. Releases now also publish the extension on its own (`snapgent-extension-v<version>.zip`) and the Linux program
  (`snapgent-linux-x64-v<version>.tar.gz`); a tag with a suffix (`v3.9.4-beta1`) is published as a pre-release. Windows is unchanged for now.
- **Calibration** replaces the built-in per-site adapters. On any supported chat site, press **Calibrate** in the bar:
  click the text box, the send button (or choose "Enter sends"), a reply and one of your own messages, check the preview
  of what will be read and the write test (nothing is sent), and the site is taught. One part can be redone alone; the
  result can be exported, imported and removed from the switch-AI menu. See [docs/CALIBRATION.md](docs/CALIBRATION.md).

### Removed
- **The chip code and everything that only served it** (turn chips, the command-phase and regenerate-look rules, hiding raw command blocks,
  pre-hiding injected turns, screenshots, the "unstable" pill, the send jitter, per-site CSS). The chat has been left as the site draws it
  for a while; this removes what was switched off. `overlay.css` is about 40% smaller.
- **All per-site chat adapters** (ChatGPT, Gemini, Claude, DeepSeek, Grok, Mistral, Kimi, Qwen, GLM, Arena, Meta,
  Ptero), their main-world scripts, the ChatGPT layout table and every test and fixture that only exercised them.
  They are replaced by one *uncalibrated* provider until the calibration-based engine is built
  ([design](docs/CALIBRATION.md)). The extension still loads, connects to the bridge and offers the switch-AI
  shortcuts, but cannot run the agent on a chat site. The old code is in the git tag `pre-calibration`.
  Also dropped on purpose (see the design for the full list): image / vision round-trips, per-site continue and
  stop workarounds, per-site badges and mode warnings.

### Changed
- **The start is one message, and it reads like a person wrote it.** It opens with the project ("snapgent-connector is your current workspace. It is at
  /home/… and it is a git repository…") instead of a `⟦ZS-SYS⟧` tag and a "CONTEXT:" line, and it already holds what the model used to ask for one
  command at a time: the command list, the workspace the user chose and the project tree. The model's whole part is to answer "understood", so a
  start costs one turn instead of two or three (and a site that checks git status or lists files on its own has nothing left to do). A conversation is
  now recognised as a session by the words "is your current workspace" (the old tag is still recognised in chats started with it), and the reminder that
  re-states the instructions is worded the same way.
- **Results are headed `» name`** instead of `Output of 'name':`, so they read as plain text rather than as a protocol. Chats started with
  the old wording are still recognised (session detection and the system-prompt budget).
- **The extension is rebuilt as layers** (`domain`, `application`, `infrastructure`, `ui`, `page`) with ONE content script,
  `src/entry/content.js`, that only composes the page modules. `legacy/` (the 2,400-line `main.js` and the provider loader), the global
  bridge (`ZSApp`, `ZSUi`, ...) and `globals.js` are gone; the manifest loads a single `content.js`. The "switch AI" list comes from the site registry.
- **The user chooses the model and the thinking mode, never the extension.** Meta AI no longer switches itself to
  Thinking on Start, and DeepSeek no longer forces Expert or turns the DeepThink toggle on; whichever Instant /
  Thinking / Expert / Vision the user picked stays. The extension is only the bridge between the chat and the IDE.
- **Project is now VS Code only.** Roblox Studio, EffectCraft and Luau (`###LUA###`)
  support was removed from the extension, bridge and setup scripts (`start-effectcraft.ps1`
  is gone). Generic extra MCP servers can still be added.
- **Firefox support.** One source tree builds both browsers (`npm run build` in
  `extension/` -> `dist/chrome`, `dist/firefox`). Firefox gets an event-page
  background and a gecko id; Chrome keeps the service worker.
- **`vscode_mcp.py` is now a package** (`snapgent_vscode/`): one registry defines each tool once;
  workspace detection, path fencing, security and JSON-RPC are separate modules. Releases must
  include the `snapgent_vscode/` folder.
- **`bridge.py` is now a package** (`snapgent_bridge/`: protocol, security, config,
  mcp client, registry, router, server). `bridge.py` stays as the entry point, so launchers
  are unchanged; releases must include the `snapgent_bridge/` folder (the macOS/Linux
  launchers now check for it). 79 bridge tests replace the old 6.
- **New layered structure** (`docs/ARCHITECTURE.md`): parser, prompt and tool
  formatting moved into a pure, unit-tested domain layer; the supported-site list
  lives in one registry that generates the manifest, background and popup.
  `bridge.exe` / `vscode_mcp.exe` are not rebuilt by this change.

### Fixed
- **ChatGPT's new page layout was not recognised** (replies are wrapped in
  `data-content-search-unit-key` elements; the old `data-message-author-role`/`.markdown`
  markers are gone). The adapter saw no turns at all, so the start stalled and the system
  prompt and commands were shown unhidden. Page layouts are now data
  (`chatgpt-layouts.js`), the whole code block is hidden, and both old layouts still work.
- **A site the adapter cannot read now fails loudly** (banner after 15 s plus a `layout.unreadable`
  diagnostic with the surrounding markup) instead of hanging for minutes.
- **Firefox could not connect to the bridge**: its default extension CSP upgrades `ws://` to
  `wss://`. The manifest now sets an explicit CSP.
- **A MCP server that crashed at startup stalled the bridge for 12 seconds** (the whole
  `initialize` timeout) instead of failing at once, and requests in flight on a server that
  died waited for their own timeout. They now fail immediately.
- The system prompt for the VS Code target did not carry the session marker, so the
  bootstrap turn was not recognised for camouflage and session detection.

### Security
- **Browser extensions must be approved once** (`snapgent_bridge/trust.py`). Any installed extension
  used to pass the origin check, so a hostile one could drive the bridge. Now an unknown extension is
  turned away and the bridge terminal asks you to allow it (remembered in `trusted_origins.json`);
  the popup shows *Approve in the bridge terminal* meanwhile. `ZS_ALLOWED_ORIGINS` still pins an origin.
- **The VS Code server now has a security policy** (`snapgent_vscode/security/`). By default it asks the
  user before deleting files, committing, running arbitrary commands, reading secret files
  (`.env`, keys, `.ssh`) and running project scripts the AI has edited; searches and listings hide
  secret files; writes inside `.git/` are always refused. Modes `readonly` / `standard` / `trusted`
  and an allowlist are set in `config.json` (`SNAPGENT_POLICY`, `SNAPGENT_ALLOWED_COMMANDS`); the
  launcher no longer overwrites them. Approval is a one-time token only the extension receives.
- On Windows, command arguments containing `cmd.exe` metacharacters are refused.
- **Bridge now rejects connections that do not come from a browser extension.**
  Any website could previously open `ws://127.0.0.1:17613` and call tools such as
  `run_command` or `write_file`. The bridge now checks the WebSocket `Origin` and
  accepts only `chrome-extension://`, `moz-extension://` and `ms-browser-extension://`
  origins; pages and clients without an Origin are closed with code 1008. Set
  `ZS_ALLOWED_ORIGINS` (comma separated) to pin the exact extension origin.

## [V3.9.3] - 2026-10-31

### Added
- **Bridge version is now visible.** The bridge defines `BRIDGE_VERSION`, writes it
  to the startup log (`snapgent bridge v...`), sends it to the extension in the
  `connected` message, and reports it as the MCP `clientInfo` version instead of
  the fixed `1.0.0`.
- **Versions in the popup header.** The popup shows `ext vX · bridge vY`. If the
  bridge is too old to report a version, it shows `bridge old`, which means the
  bridge was not updated and restarted after pulling.

### Upgrade
Pull the latest `main`, restart the bridge, then reload the extension at
`chrome://extensions` (or `edge://extensions`) and refresh open chat tabs (F5).

## [V3.9.2] - 2026-10-31

### Fixed
- **Bridge stops responding after a large MCP response.** asyncio limits each
  line read from an MCP server to 64 KB. A single large response (for example
  `read_files` or `list_dir` on a big folder such as a home directory) made the
  stdout reader fail while the server process stayed alive, so the bridge never
  restarted it and every later request timed out. The stream limit is now
  64 MB, a dead reader now counts as a dead server so it is restarted
  automatically, and the cause is written to the log.

### Tests
- Added a regression test that sends a 200 KB response line through the bridge.

### Upgrade
Pull the latest `main` and restart the bridge. No extension reload is needed
for the bridge fix itself.

## [V3.9.1] - 2026-10-31

### Fixed
- **Target dropdown not clickable.** The target menu is no longer rewritten when
  its contents have not changed. Periodic status updates used to redraw the
  buttons between mouse-down and mouse-up, so the click never fired.
- **Re-enabled MCP server missing from the dropdown.** Toggling a server in the
  **MCP servers** panel now refreshes the target dropdown immediately, without
  waiting for the panel to close.

### Documentation
- Added troubleshooting rows to `README.md` for a missing MCP server in the
  target dropdown and for dropdown clicks that do nothing.

### Upgrade
Pull the latest `main`, reload the extension at `chrome://extensions` (or
`edge://extensions`), then refresh open chat tabs (F5).

## [V3.9] - 2026-10-30

### Added
- **Mistral (Vibe Code) provider** for `chat.mistral.ai`. It is marked
  *Experimental*: the page selectors (editor, messages, send and stop buttons)
  are generic and have not yet been verified against the live site, so detection
  may need adjusting. Requires signing in to Mistral.

### Changed
- **MCP isolation.** The AI can now only see and use the MCP server selected in
  the target dropdown:
  - `list_mcp_servers` lists only the selected server, and only if its toggle is on.
  - `list_commands` refuses any `server` other than the selected one, without
    revealing whether that server exists or is enabled.
  - Commands are refused when the selected server is toggled off, when they use
    another server's `server/tool` prefix, or when the tool is not in the
    selected server's catalogue (this check is no longer skipped when the
    catalogue is empty).
  - Error messages and the periodic reminder no longer mention other servers.
  - The extension now sends the selected server with every `call_tool` request,
    and `bridge.py` rejects a tool that belongs to a different server. Requests
    without this field keep the old behaviour, so older extensions still work.

### Known limitations
- Isolation relies on the extension telling the bridge which server is
  selected. The bridge does not know the toggle state by itself.
- The Roblox system prompt still tells the AI to call `list_mcp_servers` when the
  user names another app. This does not affect the VS Code target.
- The Mistral selectors are untested on the live site.

## [V3.8] - 2026-10-30

### Added
- **Skills.** Reusable instructions stored in the workspace at
  `.snapgent/skills/<name>/SKILL.md`. The skill list is added to the system
  prompt at the start of a chat, and the AI reads a skill's `SKILL.md` with
  `read_file` when a task matches its description. Skills are guidance only and
  scripts are never run without user confirmation. Includes an example
  `commit-message` skill.
- **Skills popup.** A star (★) button in the snapgentV3 menu opens a popup with
  a toggle for each skill, so only the skills you want are listed to the AI.
- **Skill import.** Import a skill by pasting text or by choosing a `.md` or
  `.txt` file, then review it and confirm before it is saved.
- **Global skill library.** Save a skill to a library shared across workspaces,
  install it into the current workspace, or delete it from the library.

### Fixed
- **False "Studio offline" message** shown on every target, not only Roblox
  Studio.

### Known limitations
- The skill list is loaded at bootstrap, so changes apply from the next chat
  session.
- Skills only work for the VS Code target.
- Zip import is not available yet.
- The global library is stored in the browser and does not sync across devices.

## [V3.7.1] - 2026-10-30

### Fixed
- **ChatGPT: "Agent is working" and the Stop button could stay on forever** when
  the loop got stuck waiting for a reply. A watchdog now stops the loop after 3
  minutes with no progress (tab visible, no tool running), releases the cover
  and Stop button, and shows an "Agent stopped waiting" banner. Time spent with
  the tab hidden or a tool running is not counted.
- **ChatGPT: tool results could stay visible as a raw blue bubble.** A hidden
  screen-reader label ("You said:") at the start of a user turn is now ignored
  when detecting injected `Output of '...'` results, so they can be masked.
  This is a best-effort fix and is not yet confirmed on the live site.

## [V3.7] - 2026-10-30

### Added
- **MCP settings popup.** A gear button next to "Switch AI" opens a popup with a
  toggle for each MCP server. Disabled servers disappear from the target
  dropdown and are filtered out of `list_mcp_servers` and `list_commands`, so
  their tool schemas are never sent to the AI and cost no tokens. Servers that
  were never toggled stay enabled.

### Changed
- **Switch AI menu** now lists AI sites in a 3-column grid (2 columns on narrow
  screens) instead of one long vertical list.
- **MCP target dropdown** uses a custom dark menu that matches the Switch AI
  menu instead of the native browser select.
- **Stop button** is now yellow with black text and the same pill shape as the
  dropdown buttons.
- **Banners** (such as "Reload page") use the yellow and black theme and appear
  at the top center instead of the top-right corner.

## [V3.6] - 2026-10-29

### Added
- **Four new VS Code workspace tools, 28 in total.**
  - `delete_file` deletes one file inside the workspace. Directories, the
    workspace root, and anything under `.git` are refused.
  - `apply_patch` applies several exact text replacements to one file in a
    single call. Each `old_text` must match exactly once, and nothing is written
    if any edit fails.
  - `git_add` stages specific paths. Staging the whole workspace is refused.
  - `git_commit` commits the staged changes with a message. It never stages
    files on its own and has no amend option.
- Tests for the 28-tool catalog, `delete_file` safety checks, and the
  all-or-nothing behavior of `apply_patch`.

### Changed
- The VS Code MCP server now reports 28 workspace tools instead of 24.

## [V3.5] - 2026-10-29

### Changed
- **MCP target can be switched at any time.** The MCP selector in the chat bar
  is no longer locked while the agent is starting or running, and the "Choose a
  target first" guard is gone. After a switch the new target is saved and the
  page reloads automatically, so the extension restarts against the newly
  selected MCP server. A running session in that tab stops on reload and must be
  started again.

## [V3.4] - 2026-10-29

### Changed
- **Extension renamed to snapgentV3.** The extension name and description no
  longer refer to a Roblox Studio agent; they now describe a VS Code agent
  connected through the local bridge.
- **ChatGPT: supports the newer chatgpt.com layout.** Assistant replies rendered
  in a `DilResponseRoot` element (without `data-message-author-role`) are now
  counted and read as replies, and the composer is also detected as the
  accessible "Ask ChatGPT" textbox. The classic layout keeps working.

### Added
- Tests for the new ChatGPT layout: composer detection, reply counting, reply
  text, and command parsing from a `DilResponseRoot` reply.

## [V3.2] - 2026-10-29

### Added
- **Optional EffectCraft MCP support on Windows.** The chat bar includes
  EffectCraft as a selectable target. `start.bat` detects EffectCraft in common
  install locations, configures its local MCP entry, and starts the app's
  control channel automatically. Custom install locations can still be set in
  the local, Git-ignored `config.json`.

## [V3.3] - 2026-10-29

### Added
- **macOS MCP auto-setup.** The launcher detects the bundled VS Code MCP,
  Roblox Studio's `StudioMCP`, and an installed EffectCraft CLI, then writes
  their local configuration and starts EffectCraft's control channel.
- **macOS VS Code workspace detection.** The VS Code MCP server now reads
  workspace state from the macOS stable, Insiders, and VSCodium storage paths.
- **Cross-platform Python bridge for macOS.** The macOS launcher now runs
  `bridge.py`, which serves the same local WebSocket protocol and manages
  configured MCP stdio servers independently from the Windows `bridge.exe`.
- **Linux launcher and MCP setup.** `Linux_Start.sh` uses the Python bridge,
  detects VS Code and EffectCraft, and writes local MCP configuration.
- **Linux VS Code workspace detection.** The VS Code MCP server now reads
  stable, Insiders, and VSCodium workspace state from XDG config locations.

### Fixed
- **macOS launcher no longer attempts to run `bridge.exe`.** It prefers a
  native `bridge` binary when present, then falls back to the Python bridge.

## [3.0.0] - 2026-10-25

### Changed
- Align the extension version with the SnapgentV3 release line.

## [1.5.4] - 2026-09-06

### Fixed
- **ChatGPT: the snapgentV3 bar is back where it belongs, above the composer.**
  ChatGPT redesigned its input box and renamed the layout slots it is built
  from: the full-width row across the top used to be called `header` and is now
  called `eyebrow`. snapgentV3 still asked for `header`, a name that no longer
  exists, so the browser invented a place for the bar instead - it landed in a
  stray strip at the bottom right of the composer, and the text field itself was
  squeezed to zero width in the process. The bar now claims the correct row, and
  it also reads the layout live rather than trusting a fixed name, so the next
  time ChatGPT renames its slots the bar will follow instead of breaking.

### Changed
- **ChatGPT: replies are read straight from the page again.** The same redesign
  replaced the code-block editor that used to render each line separately and
  cut long lines off around 2000 characters - the cause of the truncated
  commands fixed in 1.5.1. Code blocks are now plain text with real line breaks,
  and a 400-line block reads back whole. The workaround stays in place for
  anyone still on the old interface.

## [1.5.3] - 2026-08-22

### Changed
- **Kimi moved to kimi.ai.** Kimi's old address, `kimi.com`, now asks for a
  Chinese phone number to sign in, which locked most people out. Kimi runs on
  `kimi.ai` from now on - the extension only activates there. The page itself is
  unchanged, so nothing about using Kimi with snapgentV3 is different: open
  https://www.kimi.ai, the bar appears above the input box as before. If you had
  Kimi tabs open on the old address, reopen them on the new one.
- **DeepSeek: the Instant model is now allowed to run the agent.** Starting a
  session forced the Expert tab and, worse, the readiness gate only ever accepted
  Expert or Vision - so picking Instant left "Start Roblox agent" spinning
  forever with no explanation. Instant is now respected like Vision: pick it
  before starting and the session runs on it. It is much faster than Expert, at
  the cost of the reasoning pass. Images stay disabled on Instant exactly as they
  are on Expert - the Vision tab is still the only one that can see screenshots,
  so `screen_capture` is not offered to the model on the other two.

### Fixed
- **DeepSeek: a reply written in DeepSeek's own tool-call markup no longer kills
  the turn.** DeepSeek sometimes answers with its internal DSML invoke tags
  instead of a snapgentV3 command. That format carries none of the markers
  snapgentV3 looks for, so nothing recognised it as a command attempt: the tool
  never ran, the raw tags were left on screen, and the agent silently stopped
  with the user waiting on a dead turn. It is now detected, the markup is hidden
  behind a tool chip like any other command, and DeepSeek is told the format is
  unreadable so it rewrites the call properly. The chip shows the usual spinner
  while the model is still writing, then settles red as "wrong format".
- **ChatGPT: the snapgentV3 bar no longer collides with the composer's rounded
  corners.** The composer card is rounded by 28px and the bar sits flush against
  its top edge, so the Discord button's corner fell outside the rounded shape and
  was sliced off by the card. Both ends of the bar are inset to clear the curve.

## [1.5.2] - 2026-08-14

### Added
- **ChatGPT: the operating instructions are now re-stated periodically.** ChatGPT
  summarises its own context mid-session, and the part it drops first is the
  *mechanism* - that an extension reads its replies and really runs them. It
  would then answer "I can't invoke those commands in this session" while the
  extension sat there, ready. The full instructions are now re-sent
  automatically, riding along on a tool result so they cost no extra message and
  stay hidden from you (they appear as a "Reminder" chip). A tool result is
  never shortened to make room: if the pair would not fit, the reminder simply
  waits for the next one. ChatGPT only - no other provider needs it.
- **ChatGPT: an image you send is now treated as reference material.** Unless you
  explicitly ask for a picture, ChatGPT used to answer a screenshot or a mockup
  by *generating a new image* instead of doing the work it was meant to
  illustrate - and its image tool cannot reach your place anyway.

### Fixed
- **ChatGPT: you can chat normally again without starting an agent.** On a blank
  ChatGPT tab the extension refused to let a message send until you clicked
  "Start Roblox agent". Every other provider only suggests it; ChatGPT was the
  odd one out.
- **A finished command is no longer stranded as "not run".** After a long reply
  (seen on Qwen writing for 400s and more) the loop could give up while the model
  was still going; eight seconds later the completed command was written off for
  good. That window is now three minutes, so the command actually runs.
- **A clear message when snapgentV3 is updated while a tab is open.** Chrome
  updates extensions underneath open tabs, which leaves the page running a
  version that no longer exists. snapgentV3 reported this as "the bridge stopped
  on your PC - run start.bat", sending you to fix something that was never
  broken. It now says plainly that the page needs reloading, and offers a Reload
  button - your bridge and Studio are untouched.
- **The AI no longer claims your bridge is offline without checking.** After one
  momentary outage it would keep repeating "Roblox is offline" from memory, even
  once everything was back. It must now actually run a command before saying so.

## [1.5.1] - 2026-08-13

### Added
- **ChatGPT support (chatgpt.com).** snapgentV3 now runs on ChatGPT as an
  eighth provider. Image input is deliberately disabled there: ChatGPT's free
  tier caps files/images on a separate quota from messages, so vision would
  work only part of the day. Reasoning mode ("Analyser") and the model picker
  are left entirely to you.

### Fixed
- **Meta AI: fixed large commands failing with "bad JSON".** Meta renders a
  ```json block as an interactive viewer whose default *Tree* view does not
  merely decorate the JSON - it **abridges** it: a large array or object is
  replaced by a summary placeholder. A 19103-character `multi_edit` was present
  in the page as 223 characters ending in `"edits":[1 item]`, so snapgentV3 sent
  the parser a truncated object and the command came back as a parse error every
  time. This is also why the tool chip's token counter climbed while the reply
  streamed and then **collapsed to about 44 tokens** the moment the block
  finished rendering - the counter was faithfully reporting what could be read.
  Command blocks are now switched to the viewer's *Raw* tab, which holds the
  verbatim source; the 19103-character payload is read whole.
- **Clearer diagnosis when Roblox refuses to parse Luau.** "Failed to parse
  command code" is Studio's generic parse rejection, but snapgentV3 always
  answered it with "your code block was empty or the marker was wrong". When a
  full code string *had* been sent, that advice pointed the model at a problem
  that did not exist, so it re-sent the same payload and failed again. The hint
  now only mentions the `###LUA###` markers when the code really was empty, and
  otherwise reports how many characters were sent and names the real causes -
  invalid syntax, or code too large/complex for the parser. (Measured live: a
  `return 1+1+1+…` chain ran at 1006 characters and was rejected at 2006.)
- **ChatGPT: fixed most tool calls failing outright.** ChatGPT renders code
  blocks with CodeMirror, which puts one element per line and **no newline
  characters at all** in the page. Reading a reply the usual way therefore
  returned the whole script glued onto a single line, so a perfectly valid
  command came back as "Failed to parse command code / your code block was
  empty", and the calls that did run reported every Luau error on line 1.
  Replies are now read with the line structure preserved.
- **ChatGPT: fixed long commands being executed truncated.** Beyond roughly
  2000-4000 characters, CodeMirror only renders *part* of a long line and the
  rendered text then stays frozen while the model keeps writing - the tool
  chip's token counter would climb, drop back to about 500 tokens, freeze
  there, and the command would run cut off. Measured live: a 21273-character
  command of which the page exposed 4049. snapgentV3 now reads the editor's
  real document instead of the rendered page, through a new MAIN-world tap
  (`providers/chatgpt-cm.js`), the same approach already used for Qwen's
  Monaco editor. A 5.3k-token `multi_edit` now applies whole.
- **ChatGPT: fixed the raw command staying visible.** When the model writes a
  command without wrapping it in a code fence, ChatGPT splits it into dozens of
  sibling paragraphs (68 of them for a 208-line script) and only the first one
  carried the marker, so the rest of the script stayed on screen. The whole
  marker-to-marker range is now hidden, including while it streams.
- **Fixed the agent dying silently when the model called a tool the
  function-calling way.** A reply like
  `{"toolName": "get_studio_state", "studio_id": "…"}` names a real tool but
  uses the wrong key, so nothing recognised it as a command: the turn was
  finalised as a plain-text answer and the loop simply ended, leaving the agent
  looking frozen (seen on ChatGPT in a long session). snapgentV3 now spots a
  known tool named under `toolName` / `tool` / `name` / `function` / `action`
  and asks the model to rewrite it with the proper envelope, exactly as it
  already did for a missing `###LUA###` opener or bare parameters. Prose that
  merely mentions a tool name is not affected - the check requires a tool that
  is really in the catalogue.
- **Fixed the "Agent is working…" cover hanging past the composer on the first
  send.** Injecting the system prompt grows the composer, the page gains a
  scrollbar and the content column narrows, so the composer slides sideways -
  and a site that animates that move updates its layout after the cover has
  already been placed, leaving it a frame behind (28px past the card's right
  edge on ChatGPT). The cover is now clamped to the composer card, so a stale
  measurement can never be seen. Only the first send was affected, because the
  composer stops moving once it is docked at the bottom.

## [1.5.0] - 2026-07-30

### Fixed
- **Backgrounding the AI tab no longer strands a pending command as a grey
  "not run".** `waitForResponse` now parks entirely while the tab is hidden and
  shifts every internal deadline (inactivity timeout, warm-up, text-stability,
  etc.) forward by the parked duration, instead of letting them keep ticking
  off-screen. `waitVisible` switched from polling to listening for
  `visibilitychange` - Chrome clamps chained background timers to one tick per
  minute after 5 minutes hidden, which used to delay the resume by up to a
  minute. The bar now shows a **Paused** state while parked, and a genuinely
  empty reply from the site now shows a banner instead of ending the loop
  silently.
- **Gemini: fixed the page freezing (nothing clickable) on a large tool
  result.** Gemini's composer inserts text line by line, synchronously, on the
  main thread - a 2599-line `http_get` result froze the page for about a
  minute. Outgoing text is now capped (120k chars / 1200 lines, head and tail
  kept) and the insert yields to the browser every 120 lines.
- **Gemini: fixed the system prompt occasionally never leaving the composer on
  Start.** The wedged-stop-button detector latches for 2 seconds from the
  first time it sees a stop button, so the single recovery attempt at boot -
  the very first sighting - was refused by its own guard. It now retries
  across that window and retypes as a last resort.
- **Kimi: fixed the model picker opening and closing in a loop.** Kimi's K3
  update removed the model (K2.6) the default-model routine used to select,
  so it kept hunting for a row that no longer exists. It now only acts when
  the current model is **K3 Swarm** (matched by name, any UI language) and
  gives up after a few tries instead of looping. The native-agent warning
  guard was equally broken by the same update and now reads the model label
  at its new location.
- **Degraded mode (Roblox Studio closed, running on an addon server only)
  starts much faster.** The tool catalogue request blocks until timeout when
  Roblox is down, and the boot sequence called it three times in a row. Added
  a 30s cache on the catalogue and cut the request timeout from 25s to 10s.

## [1.4.9] - 2026-07-24

### Added
- **Popup: new Settings button.** Opens the same Switch AI / support panel
  as the in-page bar, without needing an already-started conversation. The
  footer text no longer singles out chat.deepseek.com - it now points to
  "a supported AI" since seven providers are supported.
- **Bridge: auto-recovers its own port on relaunch.** Relaunching `start.bat`
  while a previous Bridge was still holding port 17613 (window closed with
  the X, a crash, a double launch) used to crash with a cryptic, sometimes
  localized `OSError [WinError 10048]`. The Bridge now detects and kills a
  leftover Bridge process it can positively identify (by command line, never
  by process name alone) before binding, and falls through to a clear,
  actionable message - with the exact `netstat`/`taskkill` commands and the
  `ZS_BRIDGE_PORT` override - if the port is held by something else.

### Fixed
- **The agent could parse/execute commands while its AI tab was backgrounded
  or the window minimized.** Background tabs throttle rendering and timers,
  which made DOM reads unreliable and could send duplicate feedback or run a
  tool blind (observed live: GLM kept running `execute_luau` while minimized).
  The agent loop, the tool-dispatch step, and the auto-resume watchdog now
  all gate on `document.visibilityState` and park - with no time limit -
  until the AI tab is the foreground tab again, then resume exactly where
  they left off. Working with Roblox Studio focused while the AI tab stays
  the active tab in its own window is unaffected; this only pauses execution
  while that tab is truly backgrounded or its window minimized.

## [1.4.8] - 2026-07-22

### Added
- **macOS and Linux support for the Bridge.** A new self-contained
  `MacOS_Start.command` launcher (double-click in Finder - no Terminal
  knowledge needed) finds Python 3.9+, installs `websockets` if missing,
  frees a previous Bridge still holding the port, and runs `bridge.py`,
  mirroring what `start.bat` already does on Windows. `launch_studio_mcp.py`
  now also locates Roblox Studio's MCP binary inside the macOS app bundle
  (`RobloxStudio.app/Contents/MacOS/StudioMCP`), with a `ZS_STUDIO_MCP_PATH`
  override for non-standard installs.
- **DeepSeek: outgoing messages are now truncated to fit its input limit.**
  DeepSeek's composer silently refuses to send past 163840 characters
  (validated live), which could wedge the agent in the input box after a
  large tool result (a big `http_get` / `get_page_text` / Luau dump). Long
  results are now truncated to a safe margin below that limit, keeping both
  the start and the end of the content, the same approach already used for
  Qwen and Arena.

## [1.4.7] - 2026-07-21

### Fixed
- **Qwen: a tool could show a green "done" check while it never ran and returned
  no result** (seen rarely with repeated `multi_edit` / `execute_luau` calls, with
  no Stop or regenerate involved). Qwen virtualizes its message list, so the
  off-DOM "already executed" record was keyed on the positional turn index, and
  two turns that shared the same 60-character command prefix could collide on the
  same index. That false positive made the auto-resume watchdog skip the fresh
  command (so it never ran, no result was injected) while the chip was still
  painted a green check. The dedupe now keys on Qwen's stable per-turn id
  (`chat-response-message-<uuid>`, exposed as `itemKey`) instead of the index, so
  the collision cannot happen.
- **Qwen: the snapgentV3 bar covered the "Expand more models" submenu.** That
  fly-out is a separate body-portalled `.ant-dropdown` at a low z-index, not the
  main model dropdown, so the bar drew on top of it. Raised just that dropdown
  above the bar (scoped so other Ant menus and tooltips are untouched).

### Added
- **Per-model image support on Qwen.** Qwen offers both multimodal and text-only
  models, switchable mid-conversation, and image input only works on the
  multimodal ones. `screen_capture` and image input are now enabled only on a
  vision-capable model (Qwen3.7-Plus, Qwen3.6-Plus, Qwen3.6-27B, Qwen3.8-Max-Preview)
  and correctly withheld on a text-only one (Qwen3.7-Max, Qwen3.6-Max-Preview),
  read from the selected model and updated when you switch models.
- **Image support on DeepSeek's Vision model.** DeepSeek forces its Expert model
  for the agent, but if you choose the Vision tab that choice is now respected and
  `screen_capture` plus image input are enabled for it. Selecting Vision is
  detected reliably, including after switching conversations. Image attachment was
  also fixed: it used to stage the same image multiple times and never send,
  because the upload went through a paste that only made a local preview and never
  uploaded the file. It now uses DeepSeek's real file upload and sends once the
  upload completes.

## [1.4.6] - 2026-07-19

### Fixed
- **Kimi's login and "priority queue" popups were covered by the snapgentV3
  bar**: both render as full-screen fixed masks (`.login-modal-mask` and
  `.modal-mask`) rather than a standard `[role="dialog"]`, so the generic
  overlay probe used by other providers never caught them. The anchored bar
  (a full-width fixed element hugging the composer) and the "unstable"
  warning pill sat on top of the mask and could intercept clicks meant for
  its buttons (e.g. "Continue with Google"). Added a Kimi-specific
  `overlayBlocking()` that detects both mask classes by real visibility; the
  core already hides the whole bar while it reports true, and restores it the
  instant the mask clears.

### Added
- **Kimi now defaults fresh chats to K2.6**: Kimi lands new chats on K3,
  which is flagged unstable here and easy to miss switching away from. A
  brand new or emptied chat now picks K2.6 automatically, once; a deliberate
  manual switch to K3 on that same chat is left alone.

## [1.4.5] - 2026-07-18

### Fixed
- **DeepSeek re-executed old tool commands when scrolling up in a long
  conversation**: DeepSeek virtualizes its message list, so scrolling up makes
  an OLD command turn the last *rendered* assistant turn - its injected result
  sits below the fold (unrendered), the in-memory "already executed" record is
  empty after a page reload, and the node change makes generation detection
  flicker true, refreshing the auto-resume watchdog's freshness clock. The
  watchdog then re-fired the historical tool. Three-layer fix (validated live):
  - The off-DOM executed/halted dedupe maps now key on a virtualization-stable
    per-turn id (`itemKey`, DeepSeek's `data-virtual-list-item-key`) instead of
    the positional assistant index, which collides across scroll windows.
  - The watchdog skips any command turn whose stable id is below the session's
    high-water mark (`A.maxTurnId`) - a scrolled-back old turn can never resume,
    even right after a reload (`resume.skipOld` in the diag ring).
  - The watchdog also skips a command turn whose injected result is rendered
    right below it (settled history), a provider-generic guard.
- **Gemini stranded a tool result in the composer ("Message could not be
  sent")**: after a generation ends, Gemini's action button can stay WEDGED on
  the stop icon instead of reverting to the send arrow. The loop's generation
  *detection* already tolerates this (WEDGE_MS), so the tool ran, but the *send*
  waited for an `arrow_upward` button that never appeared - four retries failed
  and the injected result sat unsent in the composer. `typeAndSend` now resets a
  frozen stop button (clicking it, guarded by the same not-actually-generating
  check) so the send button reappears, then sends (validated live). The native
  stop-click hook now ignores non-trusted (programmatic) clicks, so this
  un-wedge click is never mistaken for the user halting the agent - otherwise
  the next legitimate command was wrongly marked "stopped".

## [1.4.4] - 2026-07-16

### Fixed
- **Qwen fired tool commands mid-stream ("Bad JSON" while Qwen was still
  writing)**: Qwen's frontend update (fe 0.2.73) now emits `status:"finished"`
  in its SSE stream ~12s before the stream actually closes. The network tap
  treated that as the turn's end, so a still-incomplete command (e.g. an
  unclosed `###LUA###` block) was extracted and sent, and the loop's premature
  "unclosed" feedback was injected while the model kept writing. Fixed by no
  longer treating `status:"finished"` as done, and by having generation
  detection check the DOM stop button first (validated live: it now tracks the
  real stream end closely, unlike its old ~6s lag).

### Changed
- **Removed the "⚠ unstable" badge on Qwen's Auto/Think modes**: those modes
  used to make Qwen claim a tool "does not exist" without even trying it. The
  extension never force-switches Qwen's mode, so Auto (Qwen's own default) is
  left untouched.

## [1.4.3] - 2026-07-15

Adds a seventh AI provider (Meta AI) and fixes a Qwen tool-turn regression, plus
further Studio-port recovery hardening and a friendlier system prompt.

### Added
- **Meta AI (www.meta.ai) as a provider**: full snapgentV3 support on Meta AI -
  new `providers/meta.js`, manifest content script + host permissions, and the
  provider switcher entry. Handles Meta's React DOM: reasoning ("Réflexion")
  chain-of-thought is excluded from the read text, the interactive JSON viewer
  and collapsible code blocks are masked so a streamed command never flashes, and
  the composer card is fully covered while typing. Meta AI accepts very large
  prompts, so no Qwen-style send cap is needed.

### Fixed
- **Qwen tool result took ~30s to inject on every tool turn**: Qwen dropped the
  assistant turn's own `id`, so `lastAssistantId()` returned null and the core
  fell back to the virtualized flat count, waiting the full ~30s NO_TURN_GRACE
  each turn. It now reads the stable `chat-response-message-<uuid>` descendant
  (with the old id kept as a fallback).
- **Qwen refused oversized messages**: a large tool result past Qwen's 131072
  character composer cap silently wedged the loop in the input box. Outgoing text
  is now truncated to a safe margin, keeping the head and tail and marking the gap
  so the model does not re-run the command.

### Changed
- **Friendlier, less restrictive system prompt**: the "do not use native tools"
  wording is reframed as a technical note (the site's own sandbox cannot reach the
  user's Studio) rather than a hard prohibition, with an explicit "you can act
  directly in the user's project" section. Reduces provider refusals.
- **Studio-port recovery hardening**: PID-based reclaim of leftover `StudioMCP`
  zombies and clearer, de-duplicated action banners on top of the 1.4.2 port
  hijack recovery.

## [1.4.2] - 2026-07-13

Follow-up robustness fixes for the Studio-connection failures the 1.4.1 work
did not cover: a rare "0 tools that survives every restart" deadlock, and a
third-party app silently hijacking Studio's MCP port.

### Fixed
- **A third-party app (e.g. ropilot) hijacking Studio's MCP port**: whichever
  program binds Studio's MCP port (13469) FIRST wins it, and if that is not
  Studio, `StudioMCP.exe` connects to the wrong host - the handshake succeeds
  but no tools ever appear. A PC reboot never helps because the offending app
  restarts with Windows and can grab the port before Studio again. The existing
  one-shot port check at boot could miss it. The bridge now detects the hijack
  from an unmistakable, timing-independent signal - `StudioMCP.exe` reporting it
  cannot parse the host's messages on that port - then kills the offending
  process (by port owner, with a fallback that kills the known squatter by
  name), restarts the proxy, and tells the user which app to uninstall or remove
  from Windows startup so it stops coming back. It never stays silent: if it
  cannot identify or kill the squatter it prints how to find it by hand.
- **`_port_owner` was IPv4-only**: the internal port-owner probe ran
  `netstat -p TCP`, so a squatter listening on IPv6 loopback was invisible to
  it; it now scans TCP and TCPv6.
- **A missing custom-MCP command (e.g. `uvx` not installed) looked like an
  endless silent restart loop**: when a configured server's command could not
  be found on PATH, the process never started, so there was no exit code and no
  stderr, and the crash-loop banner printed "the server printed no error output
  before dying". The bridge now catches the launch failure and names the real
  cause ("command not found: 'uvx' ...") both on the first attempt and in the
  crash-loop banner, while auto-restart keeps retrying in case the dependency
  is installed later.

### Changed
- After killing a port squatter, the "toggle Studio's MCP server OFF/ON"
  instruction now prints IMMEDIATELY (right after the kill) instead of only
  after the ~48s server-launch grace loop - so the user acts within seconds
  instead of staring at a seemingly-idle terminal for a minute. Toggling early
  also lets the grace loop pick up the tools and go green right away.
- **0 tools that no restart could fix**: if a `StudioMCP.exe` from a crashed
  session kept listening on Studio's MCP port (13469), reopening Studio made
  its MCP plugin do its one-shot registration against that *zombie* process.
  Because a Studio window was now running, both existing cleanups skipped it
  (the orphan-killer only acts when no Studio runs; the port check treats any
  Roblox-path owner as legitimate), so our fresh proxy could never own the
  port - 0 tools forever, unfixable by restarting Studio or the bridge in any
  order. The bridge now identifies the port owner by process ID: a
  `StudioMCP.exe` holding the port that this bridge did not launch (outside our
  own process tree) is a leftover by definition, so it is killed and the proxy
  restarted - at boot and again in the live watcher if the catalogue stays
  empty with Studio open. It then tells the user the one action that finishes
  recovery: open Assistant Settings > MCP Servers so Studio re-registers. If
  the process tree can't be read, nothing is killed (a healthy connection is
  never put at risk).
- The extension now tells non-technical users to "Run start.bat" instead of
  "Run python bridge.py" / "Run the snapgentV3 bridge" in the offline panel,
  popup, and startup banner, matching the one-click launcher the README ships.

## [1.4.1] - 2026-07-11

Robustness release focused on the Roblox Studio connection lifecycle. Every
fix below was reproduced and validated live against a real Studio + Blender
setup, including the Roblox-side bugs reported on the devforum (StudioMCP
stale-pipe disconnects, MCP toggle turning off after a Studio update).

### Fixed
- **Phantom "Studio connected" state**: leftover `StudioMCP.exe` processes
  from a previous session or a Studio crash kept answering the bridge as if a
  Studio were attached, so the terminal and the extension showed green with
  Studio fully closed. The bridge now kills orphaned `StudioMCP.exe` at boot
  (only when no real Studio window exists, so a live connection can never be
  hit), and the boot banner re-confirms a positive probe before announcing a
  connection.
- **Status dot stuck green with Studio closed**: when StudioMCP advertised an
  empty tool catalogue (Studio closed at launch), the connectivity probe
  returned "unknown" instead of "disconnected", and the extension's
  don't-degrade-on-unknown rule kept the dot green forever. An alive Roblox
  proxy with an empty catalogue is now an authoritative "not connected".
- **Studio opened after the bridge was never detected** (yellow until a full
  bridge restart): two combined causes. (1) Nothing ever re-asked for the
  tool catalogue once the launch-time retry window expired - the watcher now
  re-polls `tools/list` while the catalogue is empty, so a late-attaching
  Studio is picked up within seconds. (2) Studio's MCP plugin registers with
  the MCP channel exactly ONCE (late in Studio's boot, or when the Assistant
  Settings > MCP Servers panel is opened/toggled) and never retries; the
  bridge's own recovery restarts could kill the MCP listener at that exact
  moment, permanently orphaning the plugin. The bridge no longer restarts the
  Roblox proxy while a Studio window is running, and both the terminal and
  the extension now say the one thing that actually fixes an orphaned
  plugin: open Assistant Settings > MCP Servers in Studio (validated three
  times live; a proxy-side restart provably cannot repair it).
- **Watcher crash silently disabling all Studio monitoring**: an unbound
  variable in the place-churn detector could kill the background watcher
  right after a reconnect, silently stopping every status update until the
  next bridge restart. Fixed, and both watchers are now supervised: a crash
  is logged in red and the watcher restarts itself in 5 seconds.
- Boot/connection messages no longer blame the merged multi-server tool count
  on Roblox ("49 tools loaded but NO Roblox Studio connected" when 22 of
  those were Blender's): every Roblox-specific message now uses the
  Roblox-only count.

### Added
- **Fast startup with addon servers**: MCP servers now launch in parallel and
  the extension-facing socket opens immediately, so a slow or absent Roblox
  Studio no longer delays Blender (or any addon) by up to a minute. The
  Roblox diagnostic continues in the background and the bridge pushes status
  updates to already-connected extensions as servers come up - previously an
  extension that connected early could keep a stale "addon offline" snapshot
  forever (greyed Start button instead of the orange degraded start).
- **Self-healing for Roblox's own disconnect bugs**: sustained loss of the
  Studio connection (stale named-pipe state, periodic silent disconnects)
  now auto-restarts the Roblox proxy - but only when no Studio window is
  running, where it is safe and effective.
- **Studio-update detection**: when a disconnect coincides with a new Studio
  version folder appearing, the terminal says Studio likely turned its MCP
  toggle off after updating (a known Roblox bug) and points at the exact
  setting, instead of retrying a recovery that cannot work.
- Extension messages distinguish "Roblox Studio is not running" from "Studio
  is running but not connected" (new `studio_proc` status field), each with
  its own corrective step.
- Terminal spinner during slow startup phases (server launch, Studio
  attach), so the console never looks frozen; only one spinner animates at a
  time.
- start.bat hardening: refuses to run from an unextracted ZIP, handles
  missing winget, rescans install folders after a winget install (PATH not
  refreshed), prints the Python version and the bridge's exit code on
  screen, and logs the Windows build - so a single screenshot of the
  terminal carries enough context for support.

## [1.4.0] - 2026-07-08

### Added
- Multi-MCP addon servers (experimental): a new "MCP servers" section in the
  panel menu lets you add or remove additional MCP servers (Blender,
  Sketchfab, or any local MCP command) alongside the always-primary Roblox
  Studio connection. The bridge rewrites `config.json` and restarts itself to
  load a change; Roblox stays protected from edits/removal and its status dot
  is scoped to Roblox alone so an addon going down never misrepresents the
  primary connection. New `list_mcp_servers` command and a `server` param on
  `list_commands` let the model discover and use addon tool sets on demand.
  When Roblox is down but an addon server is alive, the panel now offers a
  degraded start instead of refusing to start at all.
- Vision support (screen_capture / other tool-returned images) enabled for
  Arena, Gemini, GLM, Kimi and Qwen, each with a real "upload finished" signal
  before sending instead of trusting the first local preview, fixing several
  silent-attachment-drop and duplicate-attachment-on-retry bugs. A tool from
  any connected server that returns an image now gets the camera chip and is
  remembered for future calls, even for a custom MCP server whose name gives
  no hint it returns images.
- Parser: a JSON command cut off by the model's own output limit, missing
  only its trailing closing brackets, is now auto-completed and executed
  instead of failing with a parse error and forcing a full retry turn.
  Strictly refuses to salvage anything where real content (not just closers)
  was cut off.
- Per-reason parse-error feedback (cut off, bad JSON, missing ###LUA###
  opener, wrong envelope) instead of one generic "bad JSON" message, so the
  model fixes the actual problem instead of guessing.

### Fixed
- DeepSeek: a command's chip could show green "done" while DeepSeek was still
  streaming the reply, on back-to-back calls to the same tool. Caused by
  DeepSeek's list virtualization defeating the turn-count identity guard;
  fixed with a stable per-turn id.
- GLM: new "scroll to bottom" buttons were mistaken for the Stop button and
  permanently latched generation state to "busy." Raw command JSON could leak
  into the visible reply when nested inside a paragraph. An image filename
  could corrupt result-chip detection.
- Kimi: added detection of Kimi's own native "Agent" mode, which conflicts
  with snapgentV3's command protocol; Start is disabled with a warning until
  it's turned off. Fixed the hidden file-upload input not existing until the
  "+" menu is opened, raw command text leaking when nested/oversized, and
  normal model prose containing "try again" being misread as a site error.
- Qwen: same "try again" false-busy fix as Kimi. A/B "carousel" comparison
  turns (where the composer disappears mid-carousel) now auto-resolve to
  Response 1 once both candidates finish, instead of stalling or misreading a
  candidate as a truncated command.
- Arena: send is now confirmed until the composer actually clears instead of
  trusting a single click, preventing stranded messages/attachments; the chip
  now anchors below the reply text instead of floating above it.
- A command turn abandoned mid-stream (reload, or superseded by a
  regenerate) no longer shows a false green checkmark; it now shows a
  neutral "not run" state instead.
- A tool's own in-body error (e.g. "Output of '...': Error executing code...")
  now settles the chip red instead of green, even when the tool didn't use
  snapgentV3's own ERROR wrapper.
- Regenerating a stopped command no longer briefly re-shows the old call's
  chip before the new one streams in.

### Changed
- The version number next to the snapgentV3 name in the panel is now small,
  plain text instead of a bordered green badge.
- System prompt updated to cover multiple MCP servers: the model must call
  `list_mcp_servers` before assuming something outside Roblox is unsupported,
  and the tool list is no longer inlined in the prompt (fetched on demand via
  `list_commands`).

## [1.3.9] - 2026-07-04

### Fixed
- Bridge: kill the full process tree on restart instead of just the wrapper
  process, which used to leave orphaned StudioMCP.exe instances behind that
  fought the next launch and caused seemingly random "Studio looks connected
  but nothing responds" failures.
- Bridge: a dead MCP server is now auto-restarted by a background watchdog
  instead of waiting for the next tool call to notice.
- Bridge: a tool call that hits one of Studio's own brief connection blips now
  retries once instead of surfacing a spurious "Studio not connected" error.
- Extension: the status bar no longer shows a falsely healthy "N tools" label
  when the agent is active but Studio, the place, or the bridge itself isn't
  actually usable, it now names the real blocker (open a place / enable the
  MCP server / bridge offline).
- Cross-provider: DeepSeek, Gemini, Kimi, GLM and Qwen composer menus, model
  pickers and tooltips (including GLM's search hover card and Kimi's model
  popover) no longer render clipped or hidden behind snapgentV3's own
  bar/pill/cover.
- Cross-provider: a thinking model quoting command JSON in its own reasoning
  area no longer makes the tool chip flap between done/run/done (Gemini, Kimi,
  GLM and Qwen).
- The "Agent is working" composer cover now blocks clicks into the composer
  underneath it instead of letting them through, and can no longer balloon
  past the composer's visible band or drag itself off position when a site
  recreates its editor node mid-session (seen on Kimi).
- A command chip could briefly flash or restart its spinner when revisiting a
  past turn; it now settles to done correctly instead.
- DeepSeek: the raw system-prompt turn no longer flashes for a frame before
  being hidden.
- Gemini: "New chat" no longer gets stuck on "Agent active" from a reused
  previous conversation URL.
- Kimi: reasoning is read separately from the actual reply, so a command
  drafted while the model is still "thinking" is no longer detected or
  executed; input can no longer be typed mid-run after the editor node is
  recreated.
- Arena: unsupported-mode gate now also covers Web Search and Generate Image,
  and chip alignment is fixed when a command turn renders as an A/B
  model-comparison carousel.
- Bridge: a long-running tool call no longer starves the connection's ping
  handling and trips the half-open-socket watchdog.

### Changed
- Bridge and installer logs moved to `logs/bridge_debug.log` and
  `logs/start.log`; the console now only shows what a user actually needs to
  read, full detail still lands in the log files.
- `start.bat` now detects and explains a double launch instead of silently
  replacing the previous instance, and warns clearly if port 17613 stays held
  after trying to free it.
- Removed remaining em dashes from user-visible strings.
- Removed remaining em dashes from user-visible strings.

## [1.3.3] - 2026-06-24

### Fixed
- Bridge no longer depends on Roblox's `mcp.bat`, which hard-coded a single
  Studio version path and broke (0 tools / "Bridge or Studio offline") once
  Studio auto-updated and that version folder was removed. A new
  `launch_studio_mcp.py` finds the newest installed `StudioMCP.exe` and launches
  it directly.
- `bridge.py` now runs a `.py` MCP command with the same Python interpreter as
  the bridge, so it works on installs where only the `py` launcher exists.

## [1.0.0] - 2026-06-09

### Added
- Initial public release of snapgentV3 Free
- Browser extension for Chrome and Edge (DeepSeek chat integration)
- Local Python bridge (`bridge.py` + `start.bat`) for Roblox Studio communication
- Built-in MCP server support (no plugin required - activate directly in Roblox Studio)
- Read and edit Luau scripts directly from DeepSeek chat
- Run Luau code in real time inside Roblox Studio
- Inspect game tree and instances
- Generate meshes, materials, and models
- Browse and insert assets from the Creator Store
- Control play-testing from chat
- Panel status indicator (green / yellow / grey)
- Auto kill port 17613 on start to avoid conflicts
- Ko-fi support link with Robux tip passes in the extension panel
- Setup tutorial video on YouTube
