# Graph view — behind one button (T27)

The graph is a tool, not the product. It is one view, opened by the hexagon button at the top left
(widget 1, `docs/WIDGETS.md`), drawn by this app's own viewer in `body/index.html`: the body, its
layers, the organ nodes and the documents as marks on the map.

The card answered "same viewer or a reduced read-only one?" with **the same viewer, read-only**: a
template app has no write path, so there is nothing to reduce.

## The contract

- **Read-only.** The view renders the document — `<script id="kg-graph">` when the page was rendered,
  or `demo/graph.json` when the reader asks for the demo — and the page has no write path at all: no
  add, no connect, no delete, no storage write, one `fetch` and it is a GET. The node panel's buttons
  (take out of the body, put back, split into systems) move what is on screen; they never touch the
  document.
- **Never required.** The page builds the ruler, the records list and the centre view at launch.
  The models (~35 MB) load the first time the button is pressed: a reader who never opens the graph
  never downloads them, and the boot overlay stays hidden.
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
| what the acceptance run reads | `window.__graph()`, `window.__openGraph()`, `window.__closeGraph()` |
| the rules, pinned without a browser | `scripts/graph-view.test.ts` |
| the viewer still splitting after the move | `body/tools/split-regression.mjs` opens the graph before it waits for the models |

The 3D layer inside this view is its own toggle (T28): this card only puts the door on the view.
