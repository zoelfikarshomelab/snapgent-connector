// SPDX-License-Identifier: GPL-3.0-or-later
// Handing a text to the user as a file and reading the files the user picks: the two halves of every export and import in the
// extension. Both work on the document they are given, so a page (calibrations) and the popup (accounts) share one copy.

/** Offer `text` as a download called `name`. */
export function downloadText(document, text, name, type = "application/json") {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  document.documentElement.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Open the file window and give `onTexts` the text of every chosen file; a cancelled window calls nothing. */
export function chooseTextFiles(document, { multiple = false, accept = "application/json,.json" } = {}, onTexts) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.multiple = multiple;
  input.addEventListener("change", async () => {
    const files = [...(input.files || [])];
    if (files.length) await onTexts(await Promise.all(files.map((file) => file.text())));
  });
  input.click();
}
