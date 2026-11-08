// SPDX-License-Identifier: GPL-3.0-or-later
// "Output as file": a message longer than the message size goes to the chat as a .txt file instead of in parts. The file is given to the
// page through its file input, the same way the Preferences' test button does (provider.attachFile); the composer then only holds a short
// note that points at it. Off by default, because not every AI reads attached files. The start message never comes through here (see
// `submitInline` in page/chat.js): a session is recognised by its words on the page. Nothing is decided by looking for those words in the
// text, because a file the user tags may quote them too, and such a message would then be typed whole and refused by the site.

import { trimMiddle } from "../domain/prompt/budget.js";

export const FILE_NAME = "snapgent-message.txt";
// The page shows the attachment a moment after the input fires; sending before that would send the note alone.
const UPLOAD_WAIT_MS = 1500;

export const fileNote = (chars) =>
  `[This message was too long to type, so it is attached as ${FILE_NAME} (${chars.toLocaleString("en-US")} characters). Read the attached file and treat its contents as this message.]`;

/** @param {{ provider: object, budget?: object|null, diag?: Function, sleep?: (ms: number) => Promise<void>, makeFile?: (text: string) => File }} deps */
export function createOutputFile({ provider, budget = null, diag = () => {}, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), makeFile = (text) => new File([text], FILE_NAME, { type: "text/plain" }) }) {
  return {
    /** The text to type into the composer: `text` itself, or the note after the file was attached. */
    async prepare(text) {
      if (!budget || typeof budget.asFile !== "function" || !budget.asFile()) return text;
      const limit = budget.limit();
      if (text.length <= limit || typeof provider.attachFile !== "function") return text;
      try {
        await provider.attachFile(makeFile(text), "input");
        await sleep(UPLOAD_WAIT_MS);
        diag("outputFile.attached", { chars: text.length });
        return fileNote(text.length);
      } catch (error) {
        // No file input right now: better a message that fits, with its middle cut, than one the site refuses.
        diag("outputFile.failed", { msg: String((error && error.message) || error) });
        return trimMiddle(text, limit, "this message");
      }
    },
  };
}
