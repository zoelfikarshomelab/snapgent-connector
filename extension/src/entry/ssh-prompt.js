// SPDX-License-Identifier: GPL-3.0-or-later
// The script of ssh-prompt.html: the question to show is named by the `id` in the page's address.
import { mountSshPrompt } from "../ui/ssh-prompt.js";

mountSshPrompt({ document, runtime: chrome.runtime, promptId: new URLSearchParams(location.search).get("id") || "" });
