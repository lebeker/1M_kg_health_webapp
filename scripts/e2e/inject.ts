/**
 * Putting a kg/1 document into a built page — the same two things the skill's `render` rewrites:
 * the `#kg-graph` payload and the `<title>`.
 *
 * Replay depends on this being exactly the shipped artifact plus one document, so it is a pure
 * function with its own test rather than three lines buried in the runner.
 */

export type InjectableDocument = { meta?: { title?: string } }

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Replace the `#kg-graph` JSON payload and the page title. Throws when the build carries no
 * `#kg-graph` element: a replay against a page that cannot hold the document would silently
 * test the wrong thing.
 */
export function inject(build: string, document: InjectableDocument): string {
  const payload = JSON.stringify(document).replace(/<\/script/gi, '<\\/script>')
  const injected = build.replace(
    /(<script id="kg-graph" type="application\/json">)[\s\S]*?(<\/script>)/,
    (_match, open: string, close: string) => `${open}${payload}${close}`,
  )
  if (injected === build) throw new Error('the build has no #kg-graph element to put the document in')

  const title = String(document.meta?.title ?? '').trim()
  if (!title) return injected

  const element = `<title>${escapeHtml(title)}</title>`
  const withTitle = injected.replace(/<title>[\s\S]*?<\/title>/i, element)
  if (withTitle === injected && !injected.includes(element)) {
    throw new Error('the build has no <title> to put the document title in')
  }
  return withTitle
}
