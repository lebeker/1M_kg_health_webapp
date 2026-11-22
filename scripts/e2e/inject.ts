/**
 * Putting a kg/1 document into a built page — the same two things the skill's `render` rewrites:
 * the `#kg-graph` payload and the `<title>`.
 *
 * Replay depends on this being exactly the shipped artifact plus one document, so it is a pure
 * function with its own test rather than three lines buried in the runner.
 *
 * The title is optional because the two pages are not the same kind of artifact. The graph page
 * is the skill's own render target, and `render` retitles it from the document. The case page
 * (`dist/demo.html`) is built from a template whose title is the product's, not the document's;
 * a run that retitled it would be capturing a page nobody ships. So the caller says which it is
 * holding, and `{ title: false }` is the case page.
 */

export type InjectableDocument = { meta?: { title?: string } }

export type InjectOptions = {
  /** Rewrite `<title>` from the document's `meta.title`. Default `true` (the graph page). */
  title?: boolean
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Replace the `#kg-graph` JSON payload and, unless told not to, the page title. Throws when the
 * build carries no `#kg-graph` element: a replay against a page that cannot hold the document
 * would silently test the wrong thing.
 */
export function inject(build: string, document: InjectableDocument, options: InjectOptions = {}): string {
  // A `<script id="kg-graph">` element, not a marker: both builds put the document in that slot,
  // and `build-demo.ts`'s `serialize()` writes every `<` as `\u003c`, so no payload can close the
  // tag early.
  const payload = JSON.stringify(document).replace(/<\/script/gi, '<\\/script>')
  const injected = build.replace(
    /(<script id="kg-graph" type="application\/json">)[\s\S]*?(<\/script>)/,
    (_match, open: string, close: string) => `${open}${payload}${close}`,
  )
  if (injected === build) throw new Error('the build has no #kg-graph element to put the document in')

  if (options.title === false) return injected

  const title = String(document.meta?.title ?? '').trim()
  if (!title) return injected

  const element = `<title>${escapeHtml(title)}</title>`
  const withTitle = injected.replace(/<title>[\s\S]*?<\/title>/i, element)
  if (withTitle === injected && !injected.includes(element)) {
    throw new Error('the build has no <title> to put the document title in')
  }
  return withTitle
}
