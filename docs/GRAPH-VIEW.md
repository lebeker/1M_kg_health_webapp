# Graph view — behind one button (T27)

The graph is a tool, not the product. It is one view, opened by the hexagon button in the header's
right-hand cluster, glued to the left of the profile control (widget 1, `docs/WIDGETS.md`), drawn by
this app's own viewer in `body/index.html`: the body, its layers, the organ nodes and the documents
as marks on the map.

The card answered "same viewer or a reduced read-only one?" with **the same viewer, read-only**: a
template app has no write path, so there is nothing to reduce.

## The contract

- **Read-only.** The view renders the document — `<script id="kg-graph">` when the page was rendered,
  or `demo/graph.json` when the reader asks for the demo — and the page has no write path at all: no
  add, no connect, no delete, no storage write, one `fetch` and it is a GET. The node panel's buttons
  (take out of the body, put back, split into systems) move what is on screen; they never touch the
  document.
- **Never required.** The page builds the ruler, the records list and the centre view at launch.
  The models load only when the reader asks for the 3D layer inside this view — a second, separate
  toggle that is off by default (T28, below): a reader who never asks for it never downloads them,
  and the boot overlay stays hidden.
- **Back returns to the selected date.** Opening and closing changes neither `state.date` nor
  `state.event`. Closing rebuilds the ruler's marker, the marked row and the centre view from the
  date, so the reader lands on the record they opened the graph from. The timeline stays visible in
  both views: it is the product's navigator, not the graph's.

## Where it lives

| Piece | Code |
|---|---|
| the button and the graph chrome | `body/index.html`, `<div class="bar">`; `#openGraph`, `#graphBack`, `.gnote` |
| the two views, one page | `body/index.html`, `<style>`: `body.graph-open` hides `#main`, `#state` and `.only-main`; `body:not(.graph-open)` hides `#stage`, `#boot`, `#node` and the layer list |
| open / close / lazy start | `setGraphView()`, `startViewer()`, and the `graph` field on `state` |
| what the acceptance run reads | `window.__graph()`, `window.__openGraph()`, `window.__closeGraph()`, `window.__ask3d()`, `window.__load3d()`, `window.__set3d()` |
| the rules, pinned without a browser | `scripts/graph-view.test.ts` |
| the viewer still splitting after the move | `body/tools/split-regression.mjs` opens the graph, answers the 3D layer's question, and waits for the models |

The 3D layer inside this view is its own toggle (T28): the card before this one only put the door on
the view.

## The 3D layer — a toggle of its own, off by default (T28)

The view opens without a body. What it draws first is the document's own marks — every analysis and
diagnosis that has a place on the map, framed on themselves — and that costs no request at all.

The body is a layer of that map, behind a second toggle in the same bar (`#layer3d`, `aria-pressed`,
"3D layer · off" when the view opens). It says where a node sits; it is not what the map is.

- **It asks.** The toggle opens `#layerAsk`: what the layer is (the shell, the skeleton and the
  organs), how much it downloads, and "Nothing is downloaded until you say yes." The yes button
  carries the same number the sentence does (`megabytes(anatomyBytes(sex))`), so the size a reader
  agrees to is the size the browser fetches. "not now" closes the question and leaves the page with
  no model requested. It is a page control, not a browser dialog: a question a reader can dismiss
  without reading it is not a question.
- **It is lazy.** `startViewer()` is what starts the layer, and its only caller is the yes button.
  From then on `boot()` runs only while the body is on screen: after the yes, and — when a body
  switch had to be deferred — the next time the layer is turned on or the graph reopened. A switch
  made with the layer off (or the graph closed) downloads nothing; the loaded body is marked stale
  and caught up where a reader can see it. Opening the view, closing it, or coming back to it with
  the layer off never fetches a model; `__graph().models` stays 0 until the answer.
- **The question follows the body.** If the reader switches sex while `#layerAsk` is open,
  `applySex()` calls `refreshAsk()` and the sentence and the yes button restate the new body's size
  (16.6 MB his, 20.6 MB hers) before anything is fetched. A reader cannot agree to one number and
  be charged another.
- **What the ~15 MB is.** The 3D layer is `skin`, `bones` and `organs` — the three layers that say
  where a node sits. The other four of the atlas (muscles, vessels, nerves, lymph) are the body's
  own detail, not part of the map, and the map does not download them. His layer is 16.6 MB, hers
  20.6 MB; the question prints whichever is true instead of a fixed number that would be a lie for
  one of the two bodies. `scripts/graph-view.test.ts` holds every byte in the table to the file on
  disk, so the number cannot drift from the files.
- **Off is not unloaded.** Unticking the toggle hides the anatomy — `tick()` clears the layers, the
  organ nodes and the edges — and keeps it in memory, so ticking it again is free *for the body that
  is loaded*. A sex switch after the layer has loaded does not ask again: the reader has already
  said yes to the layer. It fetches the other body's shell, skeleton fit and tract only when that
  body would be on screen; with the layer off or the graph closed the switch just marks the loaded
  body stale, and the fetch happens the next time the layer is turned on (or the graph reopened
  with the layer on).
- **The bar says what the next toggle will cost.** With the layer off, `#foot` names the price of
  turning it back on: "its models are already here, so turning it back on costs nothing" only while
  the loaded body is the reader's body, and after a deferred switch "turning it back on loads her
  body, 20.6 MB" — the same number that toggle fetches. The `.hint` beside it carries the camera
  controls and nothing else; the two boxes never print the same sentence.
- **The `kg` skill asks too.** `app.json` declares this layer under `models` — its files, their
  bytes, which body each belongs to, and where they are served from — and says in the same sentence
  that it is never downloaded implicitly. A skill that installs an app must read that block and ask
  before downloading; naming the size is the point. Today the `kg` skill never gets there: `kg.py
  fetch-app` installs the page and the app's own declaration, no model has a code path in the
  engine, and its standing rule is "install nothing without a yes" (`SKILL.md`). The declaration is
  what makes the rule enforceable if that ever changes.
