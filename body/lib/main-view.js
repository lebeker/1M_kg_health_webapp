/* The main view's rules — one view per event type, and what a warning means.
 *
 * Pure on purpose, like `state-list.js`: no DOM and no clock, so `scripts/main-view.test.ts` can
 * state the card's acceptance as data and the page can stay in charge of what a view looks like.
 * The card (T11) asked for three views, picked by the event and never by the reader:
 *
 *   analysis   the whole panel as a table — a lipid panel is four rows, a single test is one;
 *              the lab name, its address, a link to the original scan; plain-language meaning;
 *              linked items.
 *   diagnosis  an official note (full text, doctor, clinic, links) or a generated one (badge
 *              `not confirmed`, no doctor link); separately, what was decided — tests, drugs,
 *              diet, activity, restrictions.
 *   summary    what was planned, what was done, what went to plan, what went to hell. No links,
 *              no assignments: a summary reports, it does not prescribe.
 *
 * The four marks, and the only way one moves:
 *
 *   yellow triangle with `!`  check before acting — a generated note, or a doctor's note a later
 *                             test contradicts, or an assignment that is plausible, unverified.
 *   skull                     dangerous, do not act. Advice that can hurt.
 *   red `!` on an assignment  a known side effect, or low trust in the generator.
 *   yellow `!` on an assignment  plausible but unverified.
 *
 * Model advice is red until one of three things is true: there is no alternative, a real
 * diagnosis stands behind it, or the reader applied it and it helped. `toneOf` is that rule, in
 * one place, so the page cannot mark something twice in two different colours.
 *
 * Keys the views read that the contract does not type are carried through untouched (a document
 * may always hold an extra key; §What the template may assume 4). They are listed in
 * `docs/MAIN-VIEW.md`. A missing key hides its row or line — it never invents a value.
 */
(function (root) {
  "use strict";

  /* kind in the document -> which view opens. Anything else is a record, not a state: a decision
     or a visit has no panel, no verdict and no period to roll up, so it gets its own facts. */
  var VIEW = {
    analysis: "analysis",
    observation: "analysis",
    condition: "diagnosis",
    diagnosis: "diagnosis",
    summary: "summary"
  };

  var GROUP = { test: "tests", drug: "drugs", diet: "diet", activity: "activity", restriction: "restrictions" };
  var GROUPS = ["tests", "drugs", "diet", "activity", "restrictions"];
  /* a node whose `assignment` is missing still lands somewhere honest when its kind says it */
  var KIND_GROUP = { medication: "drugs", procedure: "tests", prediction: "tests" };

  var CONTRADICTS = "contradicts";

  function text(value) {
    return value == null ? "" : String(value).trim();
  }
  function num(value) {
    var n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    return typeof n === "number" && isFinite(n) ? n : null;
  }
  function day(value) {
    if (value && typeof value === "object") value = value.from;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value == null ? "" : String(value));
    return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
  }
  function dateOf(node) {
    return day(node && node.when) || day(node && node.date);
  }
  function labelOf(node) {
    return text(node && (node.label || node.id));
  }
  function idOf(node) {
    return text(node && node.id);
  }

  /* ------------------------------------------------------------------ which view */

  /* The event picks the layout. A generated row (today, the annual marker) is a summary by
     definition; a stored record is whatever its kind says. `stored:false` is the left list's own
     word for "the page invented this row", so the two never have to be told apart twice. */
  function viewOf(row, node) {
    if (row && row.stored === false) return "summary";
    var kind = text(node && node.kind) || text(row && row.kind);
    return VIEW[kind] || "record";
  }

  /* ------------------------------------------------------------------ analysis */

  function referenceText(low, high) {
    if (low === null && high === null) return "";
    if (low === null) return "up to " + high;
    if (high === null) return "from " + low;
    return low + " – " + high;
  }

  /* A marker is a number and the range it was read against. The flag is the lab's, printed on the
     report; when the report printed none, the comparison with the range is marked as the page's
     own reading and never dressed up as the lab's (`from:"range"`). */
  function marker(name, value, unit, ref, flag, code) {
    var low = null, high = null;
    if (Array.isArray(ref)) { low = num(ref[0]); high = num(ref[1]); }
    else if (ref && typeof ref === "object") { low = num(ref.low); high = num(ref.high); }
    var out = (low !== null && value < low) || (high !== null && value > high);
    var printed = flag === "low" || flag === "normal" || flag === "high" || flag === "critical" ? flag : "";
    return {
      name: text(name),
      value: value,
      unit: text(unit),
      ref: low === null && high === null ? null : [low, high],
      reference: referenceText(low, high),
      flag: printed,
      from: printed ? "lab" : out ? "range" : "",
      out: printed ? printed !== "normal" : out,
      code: text(code)
    };
  }

  /* The whole panel, not one number: `values` is a panel, a bare `value` is a single test. */
  function markers(node) {
    var out = [];
    if (!node) return out;
    if (Array.isArray(node.values)) {
      node.values.forEach(function (v) {
        var value = num(v && v.value);
        if (value === null) return;                 // no number, no row: nothing to put in a table
        out.push(marker(v.name || v.label || v.code, value, v.unit, v.ref, v.flag, v.code));
      });
      return out;
    }
    var single = num(node.value);
    if (single !== null) {
      var ref = node.ref_low != null || node.ref_high != null ? [node.ref_low, node.ref_high] : null;
      out.push(marker(node.label || node.id, single, node.unit, ref, node.flag, node.code));
    }
    return out;
  }

  /* Where the numbers came from: the document node behind the analysis, and the lab it names.
     Every field that is missing is said out loud instead of being left blank. */
  function sourceOf(node, byId) {
    var doc = null;
    if (node && typeof node.source === "string" && byId) doc = byId(node.source) || null;
    var lab = text(node && node.lab) || text(doc && doc.lab) || text(doc && doc.publisher);
    var address = text(node && node.address) || text(doc && doc.address);
    var link = text(node && node.scan) || text(node && node.link) || text(doc && doc.link);
    var gaps = [];
    if (!doc) gaps.push("no document behind it");
    if (!lab) gaps.push("no lab named");
    if (!address) gaps.push("no address");
    if (!link) gaps.push("no scan to open");
    return {
      lab: lab,
      address: address,
      link: link,
      confirmed: !node || node.confirmed === true,
      document: doc
        ? { id: idOf(doc), label: labelOf(doc), link: text(doc.link), confirmed: doc.confirmed === true }
        : null,
      gaps: gaps
    };
  }

  function meaning(node) {
    return text(node && node.meaning) || text(node && node.summary) || text(node && node.desc);
  }

  /* ------------------------------------------------------------------ diagnosis */

  function person(value) {
    if (!value) return "";
    if (typeof value === "string") return text(value);
    return text(value.name) + (value.specialty ? " · " + text(value.specialty) : "");
  }
  function place(value) {
    if (!value) return "";
    if (typeof value === "string") return text(value);
    return text(value.name) + (value.address ? " · " + text(value.address) : "");
  }
  /* Every link a note carries, one per href. A note's own `scan` is one of them — an official note
     with no `link` still has the scanned page behind it, and dropping it would show no links at
     all for the one document the reader can actually open. */
  function linkList(node) {
    var out = [];
    var seen = {};
    var push = function (item, title) {
      if (!item) return;
      var href = typeof item === "string" ? text(item) : text(item.href || item.url || item.link);
      if (!href || seen[href]) return;
      seen[href] = true;
      if (typeof item === "string") { out.push({ href: href, title: title || href }); return; }
      out.push({ href: href, title: text(item.title) || title || href });
    };
    if (Array.isArray(node && node.links)) node.links.forEach(function (l) { push(l); });
    push(node && node.link, text(node && node.link_title) || "the document");
    push(node && node.scan, "the original scan");
    return out;
  }

  /* An official note is one a doctor wrote. A generated one is everything else — it carries the
     badge and no doctor link, because the two never look alike. `confirmed` is the contract's
     word for "a person checked it", so an unconfirmed note can never be official by accident. */
  function isOfficial(node) {
    if (!node || node.confirmed !== true) return false;
    if (node.origin === "generated") return false;
    if (node.origin === "doctor") return true;
    return !!(text(node.doctor) || text(node.clinic) || text(node.clinic_address));
  }

  /* A doctor's note gets the yellow triangle when a later test contradicts it: a note that was
     true in October and is contradicted in November has to say so on its own face. */
  function contradictions(node, edges, byId) {
    var out = [];
    var id = idOf(node);
    (edges || []).forEach(function (edge) {
      if (!edge || text(edge.label) !== CONTRADICTS) return;
      var from = text(edge.from), to = text(edge.to);
      if (from !== id && to !== id) return;
      var other = byId && byId(from === id ? to : from);
      if (!other || (other.kind !== "observation" && other.kind !== "analysis")) return;
      if (!(dateOf(other) > dateOf(node))) return;       // only a later test can contradict a note
      out.push({ id: idOf(other), label: labelOf(other), date: dateOf(other) });
    });
    return out;
  }

  function verdict(node, context) {
    var ctx = context || {};
    var official = isOfficial(node);
    var later = official ? contradictions(node, ctx.edges, ctx.byId) : [];
    var warning = "";
    var why = [];
    if (node && node.warning === "danger") { warning = "danger"; why.push("dangerous: do not act on this"); }
    else if (later.length) {
      warning = "check";
      why.push("a later test contradicts this note");
    }
    else if (node && node.warning === "check") {
      warning = "check";
      why.push("looks off: check before acting");
    }
    // a generated note is nobody's diagnosis yet: it gets the triangle on its own face
    else if (node && !official) {
      warning = "check";
      why.push("a generated note: check before acting");
    }
    return {
      official: official,
      generated: !official,
      badge: node && node.confirmed === true ? "" : "not confirmed",
      text: text(node && node.text) || text(node && node.summary) || text(node && node.note),
      doctor: official ? person(node && node.doctor) : "",
      clinic: official ? place(node && node.clinic) : "",
      links: linkList(node),
      warning: warning,
      why: why,
      contradicted: later
    };
  }

  function isRealDiagnosis(node) {
    if (!node) return false;
    if (node.kind !== "condition" && node.kind !== "diagnosis") return false;
    if (node.status !== "active" && node.status !== "resolved") return false;
    return isOfficial(node);
  }

  /* The four marks on one assignment, and the one rule that moves a red one to yellow. */
  function toneOf(item, realDiagnosis) {
    if (item && item.warning === "danger") return { icon: "skull", why: "dangerous: do not act" };
    if (item && item.warning === "check") return { icon: "amber", why: "check before acting" };
    if (item && item.side_effect === true) return { icon: "red", why: "known side effect" };
    var trust = text(item && item.trust);
    if (trust === "unverified") return { icon: "amber", why: "plausible, unverified" };
    if (trust === "low" || trust === "untrusted") {
      if (item.no_alternative === true) return { icon: "amber", why: "no alternative" };
      if (realDiagnosis) return { icon: "amber", why: "a real diagnosis stands behind it" };
      if (item.applied === true && item.helped === true) return { icon: "amber", why: "applied, and it helped" };
      return { icon: "red", why: "low trust in the generator" };
    }
    return { icon: "", why: "" };
  }

  function groupOf(item) {
    var named = GROUP[text(item && item.assignment)];
    if (named) return named;
    return KIND_GROUP[text(item && item.kind)] || "";
  }

  /* What was decided in a note: an assignment names the note in `decided_in`, or a relation the
     contract already has joins them (`treated_by` from the condition, `advised` out of it). */
  function belongs(item, id, edges) {
    if (text(item.decided_in) === id) return true;
    return (edges || []).some(function (edge) {
      if (!edge) return false;
      var from = text(edge.from), to = text(edge.to), rel = text(edge.label);
      if (rel === "treated_by") return from === id && to === idOf(item) && item.kind === "medication";
      if (rel === "advised") return from === id && to === idOf(item);
      return false;
    });
  }

  function assignments(node, context) {
    var ctx = context || {};
    var out = { tests: [], drugs: [], diet: [], activity: [], restrictions: [] };
    if (!node) return out;
    var id = idOf(node);
    var real = isRealDiagnosis(node);
    (ctx.nodes || []).forEach(function (other) {
      if (!other || idOf(other) === id) return;
      if (!belongs(other, id, ctx.edges)) return;
      var group = groupOf(other);
      if (!group) return;                     // no group, no line: never guess what it was
      var tone = toneOf(other, real);
      var label = labelOf(other);
      var detail = text(other.text);
      out[group].push({
        id: idOf(other),
        label: label,
        // the decision's own name is the line; anything else it carries is a second line
        detail: detail && detail !== label ? detail : "",
        date: dateOf(other),
        status: text(other.status),
        tone: tone.icon,
        why: tone.why,
        confirmed: other.confirmed === true
      });
    });
    GROUPS.forEach(function (group) {
      out[group].sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    });
    return out;
  }

  /* ------------------------------------------------------------------ summary */

  function lines(value) {
    var list = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
    return list
      .map(function (item) {
        return typeof item === "string" ? text(item) : text(item && (item.text || item.label || item.id));
      })
      .filter(function (line) { return !!line; });
  }

  function spanOf(row, nodes, today) {
    var id = text(row && row.id);
    var annual = /^annual:(\d{4})$/.exec(id);
    if (annual) {
      var from = annual[1] + "-01-01", to = annual[1] + "-12-31";
      return { from: from, to: to, label: from + " – " + to };
    }
    var dates = (nodes || []).map(dateOf).filter(function (d) { return !!d; }).sort();
    var start = dates.length ? dates[0] : "";
    return { from: start, to: "", label: start && today ? start + " – " + today : today || "" };
  }

  /* A summary reports; it does not prescribe. A stored one carries its own four lists. A
     generated one can only count what the document holds inside its period — it has no judgement
     to show, and saying so is the honest empty state instead of a list somebody invented. */
  function summaryOf(row, node, context) {
    var ctx = context || {};
    var generated = !node || (row && row.stored === false);
    var out = { generated: !!generated, period: "", planned: [], done: [], held: [], dropped: [], note: "" };
    if (!generated) {
      out.period = text(node.period) || (dateOf(node) ? "period ending " + dateOf(node) : "");
      out.planned = lines(node.plan != null ? node.plan : node.planned);
      out.done = lines(node.fact != null ? node.fact : node.done);
      out.held = lines(node.held != null ? node.held : node.went_to_plan);
      out.dropped = lines(node.dropped != null ? node.dropped : node.went_to_hell);
      return out;
    }
    var span = spanOf(row, ctx.nodes, ctx.today);
    out.period = span.label;
    var inside = function (other) {
      var d = dateOf(other);
      return !!d && (!span.from || d >= span.from) && (!span.to || d <= span.to);
    };
    (ctx.nodes || []).forEach(function (other) {
      if (!other || !inside(other)) return;
      var kind = text(other.kind);
      var d = dateOf(other);
      if (kind === "prediction" || kind === "decision") {
        // a plan for next February is exactly what "what was planned" means: no upper bound
        out.planned.push(labelOf(other));
      } else if (kind === "observation" || kind === "analysis" || kind === "procedure" ||
                 kind === "encounter" || kind === "medication") {
        // what was done stops at today — a future event has not happened yet
        if (!ctx.today || d <= ctx.today) out.done.push(labelOf(other) + " · " + d);
      }
    });
    out.planned.sort();
    out.done.sort();
    out.note = "computed from the document: nobody has said what held and what was dropped";
    return out;
  }

  /* ------------------------------------------------------------------ linked items */

  /* Linked items are links, always: the page turns each into a click that opens that item in this
     view. A summary has none — a summary reports, it does not hand out homework. An edge is the
     document's word for a relation; a decision's own `decided_in` is the second place a link can
     come from, and it is read here so a decision always shows the note that decided it. */
  function linked(node, context) {
    var ctx = context || {};
    var out = [], seen = {};
    if (!node) return out;
    var id = idOf(node);
    var add = function (otherId, rel) {
      if (!otherId || otherId === id || seen[otherId]) return;
      var other = ctx.byId && ctx.byId(otherId);
      if (!other) return;
      seen[otherId] = true;
      out.push({ id: otherId, label: labelOf(other), kind: text(other.kind),
                 rel: rel, date: dateOf(other) });
    };
    (ctx.edges || []).forEach(function (edge) {
      if (!edge) return;
      var from = text(edge.from), to = text(edge.to);
      add(from === id ? to : to === id ? from : "", text(edge.label));
    });
    // a decision points at the note it came from; the note itself lists its decisions under
    // "what was decided", so this one direction is enough and nothing is shown twice
    if (node.kind !== "condition" && node.kind !== "diagnosis") add(text(node.decided_in), "decided_in");
    return out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  }

  root.MainView = Object.freeze({
    viewOf: viewOf,
    markers: markers,
    sourceOf: sourceOf,
    meaning: meaning,
    verdict: verdict,
    isOfficial: isOfficial,
    isRealDiagnosis: isRealDiagnosis,
    toneOf: toneOf,
    assignments: assignments,
    summaryOf: summaryOf,
    linked: linked,
    groups: GROUPS,
    VIEW: VIEW
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
