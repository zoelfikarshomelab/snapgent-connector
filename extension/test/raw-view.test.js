import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { rawViewState, showRawViews } from "../src/infrastructure/calibration/raw-view.js";
import { closestName } from "../src/domain/tools/closest-name.js";
import { FEEDBACK } from "../src/domain/prompt/feedback.js";
import { pageWith } from "./support/jsdom-provider.js";

const TREE = `<div class="block"><div class="bar"><button class="t t--active">Tree</button><button class="t ">Raw</button></div><div class="view">tree: paths 5 items</div></div>`;

describe("JSON tree view", () => {
  test("the Raw button beside a Tree button is pressed, once", () => {
    const { document } = pageWith(`<html><body>${TREE}</body></html>`);
    const [tree, raw] = document.querySelectorAll("button");
    raw.addEventListener("click", () => {
      tree.className = "t ";
      raw.className = "t t--active";
      document.querySelector(".view").textContent = '{"command":"read_files"}';
    });
    assert.equal(showRawViews(document.body), 1);
    assert.equal(document.querySelector(".view").textContent, '{"command":"read_files"}');
    assert.equal(showRawViews(document.body), 0, "already on Raw");
  });

  test("a Raw button with no Tree beside it is left alone", () => {
    const { document } = pageWith(`<html><body><div><button>Raw</button></div></body></html>`);
    assert.equal(showRawViews(document.body), 0);
  });
});

describe("JSON tree view: finding the toggle", () => {
  // What showRawViews presses, and which controls were clicked.
  function press(html) {
    const { document } = pageWith(`<html><body>${html}</body></html>`);
    const hits = [];
    for (const control of document.querySelectorAll("button, [role=tab], [role=radio]")) control.addEventListener("click", () => hits.push(control.textContent.trim()));
    return { pressed: showRawViews(document.body), hits };
  }

  test("a class that only contains the word is not the chosen one", () => {
    // "inactive" and "unselected" say the opposite of "active" and "selected": a plain substring test took them for the chosen button.
    assert.equal(press(`<div><button class="t t--active">Tree</button><button class="t t--inactive">Raw</button></div>`).pressed, 1);
    assert.equal(press(`<div><button>Tree</button><button class="unselected">Raw</button></div>`).pressed, 1);
    assert.equal(press(`<div><button>Tree</button><button class="tab isNotActive">Raw</button></div>`).pressed, 1);
  });

  test("the chosen Raw button is told by a class, an aria attribute or a data-state, and is left alone", () => {
    for (const attributes of ['class="t t--active"', 'class="isActive"', 'class="tab_selected"', 'aria-pressed="true"', 'aria-checked="true"', 'aria-current="page"', 'data-state="on"']) {
      assert.equal(press(`<div><button>Tree</button><button ${attributes}>Raw</button></div>`).pressed, 0, attributes);
    }
    assert.equal(press(`<div><button>Tree</button><button data-state="off" aria-checked="false" aria-current="false">Raw</button></div>`).pressed, 1);
  });

  test("tabs and radios count, and so do controls wrapped one by one", () => {
    assert.equal(press(`<div role="tablist"><span role="tab" aria-selected="true">Tree</span><span role="tab" aria-selected="false">Raw</span></div>`).pressed, 1);
    assert.equal(press(`<div role="radiogroup"><span role="radio" aria-checked="true">Tree</span><span role="radio">Raw</span></div>`).pressed, 1);
    assert.equal(press(`<div class="seg"><div><button>Tree</button></div><div><button>Raw</button></div></div>`).pressed, 1);
  });

  test("every block with its own toggle is switched; a Tree control far away, or an unclear pair, is not paired", () => {
    assert.deepEqual(press(`<div><button>Tree</button><button>Raw</button></div><div><button>Tree</button><button>Raw</button></div>`).hits, ["Raw", "Raw"]);
    assert.equal(press(`<div><button>Tree</button><div><div><div><div><button>Raw</button></div></div></div></div></div>`).pressed, 0);
    assert.equal(press(`<div><button>Tree</button><button>Raw</button><button>Raw</button></div>`).pressed, 0);
  });

  test("rawViewState says how many toggles there are and how many are not on Raw yet", () => {
    const { document } = pageWith(`<html><body><div><button class="a active">Tree</button><button>Raw</button></div><div><button>Tree</button><button class="active">Raw</button></div><div><button>Raw</button></div></body></html>`);
    assert.deepEqual(rawViewState(document.body), { pairs: 2, notShown: 1 });
    assert.deepEqual(rawViewState(null), { pairs: 0, notShown: 0 });
  });
});

describe("unknown command hint", () => {
  const valid = ["read_files", "write_file", "tree"];
  test("a near miss is named", () => {
    assert.equal(closestName(valid, "read_file"), "read_files");
    assert.match(FEEDBACK.unknownTool("read_file", valid), /Did you mean "read_files"\?/);
  });
  test("nothing close gives no hint", () => {
    assert.equal(closestName(valid, "rm_rf"), null);
    assert.doesNotMatch(FEEDBACK.unknownTool("rm_rf", valid), /Did you mean/);
  });
});
