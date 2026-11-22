/* The right panel's model — forecast and recommendations, as they stood then and as they stand now.
 *
 * Pure on purpose, like `state-list.js` and `main-view.js`: no DOM and no clock, so
 * `scripts/right-panel.test.ts` can state the card's acceptance as data and the page can stay in
 * charge of what the panel looks like. The card (SCRUM-47) corrected the v12 sketch:
 *
 *   - a past record shows the two states together, side by side, in one panel: SOLID = what was
 *     known on that date, PALED = what we know now, same scale, so the two read against each other;
 *   - the delta is stated in words beside them, and names the record that moved it;
 *   - the same sections in both, in the same order: forecast, what moves it, recommended on this
 *     date, what we do not know, on what grounds;
 *   - today's record shows one solid state, no paled column.
 *
 * Where the numbers come from. The page already has one projection: a life-expectancy table for
 * the profile's sex, moved by each record's own effect (`delta`, or `evidence` as a bounded proxy),
 * with the newest record per track superseding the older ones. The panel does not invent a second
 * scale: it evaluates that same projection at two dates. The baseline carries no published
 * interval in this document, so the panel prints no interval and says so — an interval with no
 * source is the kind of number this product refuses to show.
 *
 * "Recommended on this date" is the document's own word: an `advised` edge from a dated encounter
 * to the test or drug it advised. The source is the encounter's document; the status is the
 * advised thing's status on that date (a drug's interval, an observation's own date). Nothing here
 * guesses a guideline the document did not record.
 */
(function (root) {
  "use strict";

  var DAY = /^(\d{4})-(\d{2})-(\d{2})/;

  /* A calendar day, not an instant. An interval (`when:{from,to}`) starts on its `from` day. */
  function day(value) {
    if (value && typeof value === "object") value = value.from;
    var m = DAY.exec(value == null ? "" : String(value));
    return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
  }
  function dateOf(node) {
    return day(node && node.when) || day(node && node.date);
  }
  function label(node) {
    return String((node && (node.label || node.id)) || "");
  }
  function num(value) {
    if (typeof value === "string" && value.trim() !== "") value = Number(value);
    return typeof value === "number" && isFinite(value) ? value : null;
  }
  function signed(value, digits) {
    var v = Math.abs(value).toFixed(digits == null ? 1 : digits);
    return (value >= 0 ? "+" : "\u2212") + v;
  }

  /* A mark is something with a number: the observation, or the older artifact's `analysis`. */
  function isMark(node) {
    return !!node && (node.kind === "observation" || node.kind === "analysis");
  }
  /* `evidence` is the page's own 0..100 weight; a document without it is neutral 50, never zero. */
  function evidenceOf(node) {
    var e = num(node && node.evidence);
    return e === null ? 50 : Math.max(0, Math.min(100, e));
  }
  /* The effect a record *records*, or null when it records none. `delta` is the document's own
     number; `evidence` is the page's own 0..100 weight, and only a record that carries one has an
     effect through it. A record with neither has no effect — it is not an effect of zero. Printing
     one in the same column as a real number claims the record was weighed and came out empty, which
     is how eight lab panels ended up in "what moves it" at +0.0. */
  function recordedEffect(node) {
    if (!node) return null;
    var explicit = num(node.delta);
    if (explicit !== null) return explicit;
    var e = num(node.evidence);
    if (e === null) return null;
    return Math.max(-2, Math.min(2, (Math.max(0, Math.min(100, e)) - 50) / 25));
  }
  /* What the projection is moved by: a recorded effect, or — for a measurement that records none —
     the neutral zero the page's own arithmetic has always used, so the forecast number itself does
     not move. The two questions are different: the forecast asks "how many years", the panel asks
     "which record weighed on it", and a record that records nothing cannot answer the second. */
  function effectOf(node) {
    var recorded = recordedEffect(node);
    if (recorded !== null) return recorded;
    return isMark(node) ? 0 : null;
  }
  function trackOf(node) {
    return String((node && (node.track || node.id)) || "");
  }

  /* The newest record per track dated on or before `asOf`, in the model's own order (track id).
     A record without a date cannot stand on a date, so it cannot move the estimate at one. */
  function latestByTrack(nodes, asOf) {
    var out = {};
    (nodes || []).forEach(function (node) {
      if (!node) return;
      var at = dateOf(node);
      if (!at || at > asOf) return;
      var delta = effectOf(node);
      if (delta === null) return;
      var track = trackOf(node);
      if (!track) return;
      var current = out[track];
      if (!current || at > current.at) out[track] = { at: at, node: node, track: track, delta: delta };
    });
    return out;
  }

  function baseline(leBySex, sex) {
    var table = leBySex || {};
    var value = num(table[sex]);
    if (value === null) value = num(table.male);
    return value === null ? 76 : value;
  }

  /* The projection at one date: the table's baseline plus the newest effect of every track that
     existed by then. Zero records is "not enough data", never zero years and never the bare
     baseline dressed up as a forecast. */
  function forecastAt(nodes, asOf, leBySex, sex) {
    var latest = latestByTrack(nodes, asOf);
    var tracks = Object.keys(latest).sort();
    var years = baseline(leBySex, sex);
    var drivers = tracks.map(function (track) {
      var hit = latest[track];
      years += hit.delta;
      return { track: track, label: label(hit.node), date: hit.at, delta: hit.delta };
    });
    return {
      available: tracks.length > 0,
      years: tracks.length > 0 ? years : null,
      records: tracks.length,
      drivers: drivers
    };
  }

  /* ---- the factors: what the estimate is explained by, read as a reader names it -----------------
     The owner's list (wireframes v11/v13; audit 2026-11-22): LDL, blood pressure, age, statin,
     smoking, steps. A lab panel is not on it. ALT, blood count, HbA1c and fasting glucose are
     measurements: none of them is a factor the projection reads, and listing them here — at +0.0 —
     said "this moved the estimate by nothing" in the same column as a number that did, while the
     four things that can move it were absent.

     A factor row is drawn only when the document says something about that factor, and it carries
     what the document says (`value`), the record it says it in (`source`, with the record's link),
     and the effect that record records — null, not zero, when it records none. A factor the
     document is silent about is not a row here: it is a gap, and widget 23 already lists it. */

  function markers(node) {
    return node && Array.isArray(node.values) ? node.values : [];
  }
  function markerNamed(node, re) {
    var hit = null;
    markers(node).forEach(function (m) {
      if (!hit && m && re.test(String(m.name || ""))) hit = m;
    });
    return hit;
  }
  function markerText(m, node) {
    if (m) return String(m.value) + (m.unit ? " " + m.unit : "");
    var v = num(node && node.value);
    return v === null ? "" : String(v) + (node.unit ? " " + node.unit : "");
  }
  /* The newest record dated on or before `asOf` that `test` accepts, or null. Same rule as the
     projection: a record without a date cannot stand on a date. */
  function newest(nodes, asOf, test) {
    var best = null;
    (nodes || []).forEach(function (node) {
      if (!node || !test(node)) return;
      var at = dateOf(node);
      if (!at || at > asOf) return;
      if (!best || at > best.at) best = { at: at, node: node };
    });
    return best;
  }
  function factorRow(key, labelText, value, hit, byId) {
    var node = hit ? hit.node : null;
    return {
      key: key,
      label: labelText,
      value: value,
      cause: label(node) || labelText,
      record: node ? String(node.id) : "",
      date: hit ? hit.at : "",
      delta: recordedEffect(node),
      source: node ? sourceOf(node, byId) : { label: "", link: "" }
    };
  }
  /* Whole years at a date, from the profile's birth year — the same reading `src/profile.ts` makes
     and the same one the page prints: a document carries a year, so an age is never in months. */
  function ageYears(meta, asOf) {
    var m = /^(\d{4})/.exec(String(asOf || ""));
    var source = meta || {};
    var year = num(source.profile && source.profile.year_of_birth);
    if (year === null) {
      var birth = /^(\d{4})/.exec(String(source.birth || ""));
      year = birth ? Number(birth[1]) : null;
    }
    if (year === null || !m) return null;
    return Number(m[1]) - year;
  }
  function ldlRow(nodes, asOf, byId) {
    var hit = newest(nodes, asOf, function (n) {
      if (!isMark(n)) return false;
      return !!markerNamed(n, /\bldl\b/i) || /\bldl\b/i.test(label(n));
    });
    if (!hit) return null;
    var m = markerNamed(hit.node, /\bldl\b/i);
    return factorRow("ldl", "LDL", m ? markerText(m, hit.node) : markerText(null, hit.node), hit, byId);
  }
  function bpRow(nodes, asOf, byId) {
    var hit = newest(nodes, asOf, function (n) {
      if (!isMark(n)) return false;
      return !!markerNamed(n, /systolic/i) || /blood pressure|blood-pressure/i.test(label(n) + " " + trackOf(n));
    });
    if (!hit) return null;
    var sys = markerNamed(hit.node, /systolic/i);
    var dia = markerNamed(hit.node, /diastolic/i);
    var value = sys && dia
      ? String(sys.value) + "/" + String(dia.value) + (sys.unit ? " " + sys.unit : "")
      : markerText(null, hit.node);
    return factorRow("blood-pressure", "blood pressure", value, hit, byId);
  }
  function ageRow(nodes, asOf, byId, meta) {
    var age = ageYears(meta, asOf);
    if (age === null) return null;
    return {
      key: "age",
      label: "age",
      value: String(age),
      cause: "age",
      record: "",
      date: asOf,
      delta: null,
      source: { label: "profile", link: "" }
    };
  }
  function statinRow(nodes, asOf, byId) {
    var hit = newest(nodes, asOf, function (n) {
      return String(n.kind || "") === "medication" && /statin/i.test(label(n));
    });
    if (!hit) return null;
    return factorRow("statin", "statin", statusAt(hit.node, asOf), hit, byId);
  }
  function smokingRow(nodes, asOf, byId) {
    var hit = newest(nodes, asOf, function (n) {
      /* A document that mentions smoking is not a smoking status: only a condition or a
         measurement can say what he does. */
      if (String(n.kind || "") !== "condition" && !isMark(n)) return false;
      return /smok|tobacco/i.test([label(n), n.summary, n.name].filter(Boolean).join(" "));
    });
    if (!hit) return null;
    return factorRow("smoking", "smoking", "recorded", hit, byId);
  }
  function stepsRow(nodes, asOf, byId) {
    var hit = newest(nodes, asOf, function (n) {
      if (!isMark(n)) return false;
      return !!markerNamed(n, /step|walk/i) || /step count|steps a day|activity/i.test(label(n));
    });
    if (!hit) return null;
    var m = markerNamed(hit.node, /step|walk/i);
    return factorRow("steps", "steps", m ? markerText(m, hit.node) : markerText(null, hit.node), hit, byId);
  }
  var FACTORS = [ldlRow, bpRow, ageRow, statinRow, smokingRow, stepsRow];

  /* Every row "what moves it" draws at one date. The factors first, then every other record that
     records an effect and is not one of those records — so the rows still add up to the change, and
     a record that moved the number is never silently missing from the list that explains it. A
     record that records no effect is never a row here. */
  function explainAt(nodes, asOf, byId, meta) {
    var rows = [];
    FACTORS.forEach(function (read) {
      var row = read(nodes, asOf, byId, meta);
      if (row) rows.push(row);
    });
    var covered = {};
    rows.forEach(function (row) { if (row.record) covered[row.record] = true; });
    var latest = latestByTrack(nodes, asOf);
    Object.keys(latest).forEach(function (track) {
      var hit = latest[track];
      if (covered[String(hit.node.id)]) return;
      var delta = recordedEffect(hit.node);
      if (delta === null || Math.abs(delta) < 1e-12) return;
      rows.push({
        key: "effect:" + track,
        label: label(hit.node),
        value: markerText(null, hit.node),
        cause: label(hit.node),
        record: String(hit.node.id),
        date: hit.at,
        delta: delta,
        source: sourceOf(hit.node, byId)
      });
    });
    return rows;
  }

  /* The rows, aligned so a reader can hold the two states against each other: same factor, then's
     value on the left, now's on the right. A factor the document only speaks about after the
     selected date has no then value; one it stopped speaking about has no now value. Rows that move
     the number come first, largest first; the rows that carry no recorded effect follow, in the
     owner's factor order, so the list reads "here is what weighs, and here is what the record says
     about the rest" rather than sorting a zero in among the effects. */
  function cellOf(row) {
    return row
      ? { delta: row.delta, date: row.date, value: row.value, source: row.source }
      : null;
  }
  function moveRows(thenRows, nowRows) {
    var seen = {}, out = [];
    thenRows.concat(nowRows).forEach(function (row) { seen[row.key] = true; });
    Object.keys(seen).forEach(function (key) {
      var was = thenRows.filter(function (r) { return r.key === key; })[0] || null;
      var is = nowRows.filter(function (r) { return r.key === key; })[0] || null;
      var hit = is || was;
      out.push({
        key: key,
        label: hit.label,
        value: hit.value,
        then: cellOf(was),
        now: cellOf(is)
      });
    });
    var weigh = function (row) {
      var d = row.now && row.now.delta != null ? row.now.delta
            : row.then && row.then.delta != null ? row.then.delta : 0;
      return Math.abs(d);
    };
    out.sort(function (a, b) {
      return weigh(b) - weigh(a) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
    });
    return out;
  }

  /* The record(s) that moved the estimate between the two dates: the card's "and +3.6 of it —
     the statin we recommended in 2021" needs a name, not just a number. Every row whose recorded
     effect changed is named, largest first, so the sentence reconciles with the total. */
  function moversBetween(thenRows, nowRows) {
    var out = [];
    var seen = {};
    thenRows.concat(nowRows).forEach(function (row) { seen[row.key] = true; });
    Object.keys(seen).forEach(function (key) {
      var was = thenRows.filter(function (r) { return r.key === key; })[0] || null;
      var is = nowRows.filter(function (r) { return r.key === key; })[0] || null;
      var before = was && was.delta != null ? was.delta : 0;
      var after = is && is.delta != null ? is.delta : 0;
      var change = after - before;
      if (Math.abs(change) < 0.049) return;
      var hit = is || was;
      out.push({ change: change, label: hit.cause || hit.label, date: hit.date, key: key });
    });
    out.sort(function (a, b) {
      return Math.abs(b.change) - Math.abs(a.change) ||
             (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
    });
    return out;
  }

  /* Two clauses, the shape the owner asked for: the total movement, then what moved it. */
  function deltaWords(then, now, thenRows, nowRows, asOf) {
    if (!then.available || !now.available) {
      return { total: "cannot compare \u2014 no record on that date", because: "" };
    }
    var change = now.years - then.years;
    if (Math.abs(change) < 0.05) {
      return { total: "no change since " + asOf, because: "nothing after " + asOf + " moved the estimate" };
    }
    var movers = moversBetween(thenRows, nowRows);
    return {
      total: signed(change) + " years since " + asOf,
      because: movers.length
        ? movers.map(function (m) {
            return signed(m.change) + " of it \u2014 " + m.label + " (" + m.date + ")";
          }).join(" \u00b7 ")
        : "no single record explains it"
    };
  }

  function sourceOf(node, byId) {
    var source = node && node.source ? byId(node.source) : null;
    if (source) {
      return { label: label(source), link: String(source.link || source.scan || "") };
    }
    return { label: label(node), link: String((node && (node.link || node.scan)) || "") };
  }

  /* The status of the advised thing on a date, in the document's own terms. A drug's interval is
     the one field that says this; an observation or a procedure is dated by its own day. */
  function statusAt(node, asOf) {
    if (!node) return "";
    var when = node.when && typeof node.when === "object" ? node.when : null;
    var from = when ? day(when.from) : (node.kind === "medication" ? dateOf(node) : "");
    var to = when ? day(when.to) : "";
    if (node.kind === "medication") {
      if (from && from > asOf) return "not started yet";
      if (to && to <= asOf) return "stopped " + to;
      return from ? "since " + from : (node.status ? String(node.status) : "active");
    }
    var at = dateOf(node);
    if (node.kind === "observation" || node.kind === "analysis") {
      return at && at <= asOf ? "recorded " + at : "not yet done";
    }
    if (node.kind === "procedure") return at && at <= asOf ? "done " + at : "not yet done";
    if (node.kind === "condition") return node.status ? String(node.status) : (at ? "noted " + at : "");
    return at && at <= asOf ? "noted " + at : "advised";
  }

  /* What the document itself says was advised, by a dated encounter, on or before `asOf`. */
  function adviceAt(nodes, edges, asOf, byId) {
    var byTarget = {};
    (edges || []).forEach(function (edge) {
      if (!edge) return;
      var rel = String(edge.label || "");
      if (rel !== "advised" && rel !== "recommended") return;
      var from = byId(edge.from);
      var to = byId(edge.to);
      if (!from || !to) return;
      var on = dateOf(from);
      if (!on || on > asOf) return;
      var id = String(to.id);
      var current = byTarget[id];
      if (!current || on > current.advisedOn) {
        byTarget[id] = { id: id, advisedOn: on, by: from, node: to };
      }
    });
    var out = {};
    Object.keys(byTarget).forEach(function (id) {
      var hit = byTarget[id];
      out[id] = {
        id: id,
        label: label(hit.node),
        kind: String(hit.node.kind || ""),
        advisedOn: hit.advisedOn,
        by: label(hit.by),
        source: sourceOf(hit.by, byId),
        status: statusAt(hit.node, asOf),
        link: String(hit.node.link || hit.node.scan || "")
      };
    });
    return out;
  }

  function recommendedRows(thenAdvice, nowAdvice) {
    var seen = {};
    Object.keys(thenAdvice).forEach(function (id) { seen[id] = true; });
    Object.keys(nowAdvice).forEach(function (id) { seen[id] = true; });
    var out = Object.keys(seen).map(function (id) {
      var was = thenAdvice[id] || null;
      var is = nowAdvice[id] || null;
      return {
        key: id,
        label: (is || was).label,
        then: was ? { status: was.status, advisedOn: was.advisedOn, by: was.by, source: was.source } : null,
        now: is ? { status: is.status, advisedOn: is.advisedOn, by: is.by, source: is.source } : null
      };
    });
    out.sort(function (a, b) {
      var da = String((a.now || a.then).advisedOn);
      var db = String((b.now || b.then).advisedOn);
      return da < db ? 1 : da > db ? -1 : 0;
    });
    return out;
  }

  /* A record that closes a gap, dated on or before a date, or null. */
  function closedBy(nodes, test, asOf) {
    var best = null;
    (nodes || []).forEach(function (node) {
      if (!node || !test(node)) return;
      var at = dateOf(node);
      if (!at || at > asOf) return;
      if (!best || at < best) best = at;
    });
    return best;
  }
  function hasText(node, re) {
    return re.test([node.label, node.panel, node.name, node.code, node.summary]
      .filter(Boolean).join(" "));
  }

  /* The gaps the page can actually name: a fact the model needs that no record carries, and the
     two blind spots the projection is honest about. A gap that a later record closes is still a
     row — it reads "missing" on the date and "recorded <date>" now, which is the whole point of
     showing the two states together. */
  function gaps(nodes, thenOn, nowOn) {
    var defs = [
      { key: "family", text: "no family history recorded",
        test: function (n) { return hasText(n, /family\s*history|family_history/i) || n.family_history != null; } },
      { key: "smoking", text: "no smoking record",
        test: function (n) { return n.smoking != null || n.pack_years != null || hasText(n, /smok|tobacco/i); } },
      /* The owner's sixth factor, and the one a kg/1-health document has no record kind for: steps
         live in the profile's knobs (widget 30), not in a dated event. It is named here rather than
         silently absent from widget 21, so the reader can see that the factor exists and that this
         record does not carry it. */
      { key: "steps", text: "no step count \u2014 a document carries no activity record",
        test: function (n) { return n.steps != null || hasText(n, /step count|steps a day|walks? \d/i); } },
      { key: "vaccines", text: "no vaccination records",
        test: function (n) { return hasText(n, /vaccin|immunis|immuniz/i); } },
      { key: "sleep", text: "no sleep data \u2014 the model does not read it", blind: true,
        test: function () { return false; } },
      { key: "mood", text: "the model does not account for depression or loneliness", blind: true,
        test: function () { return false; } }
    ];
    return defs.map(function (def) {
      var closed = closedBy(nodes, def.test, nowOn);
      var knownThen = closed !== null && closed <= thenOn;
      var missing = def.blind ? "not in the model" : "missing";
      return {
        key: def.key,
        text: def.text,
        then: knownThen
          ? { known: true, text: "recorded " + closed }
          : { known: false, text: missing },
        now: closed ? { known: true, text: "recorded " + closed } : { known: false, text: missing }
      };
    });
  }

  /* On what grounds: the table, the projection's rule, and how many records each state stands on.
     The same section in both columns; only the count differs. */
  function groundsRows(thenForecast, nowForecast, leBySex, sex) {
    var base = baseline(leBySex, sex);
    var table = sex === "female" || sex === "male" ? sex : "male (default)";
    return [
      { key: "table", label: "baseline", then: table + " " + base + " years", now: table + " " + base + " years" },
      { key: "model", label: "projection",
        then: "the newest record per track, each capped at \u00b12 years",
        now: "the newest record per track, each capped at \u00b12 years" },
      { key: "records", label: "records behind it",
        then: thenForecast.records + (thenForecast.records === 1 ? " record" : " records"),
        now: nowForecast.records + (nowForecast.records === 1 ? " record" : " records") },
      { key: "rule", label: "the rule",
        then: "every number carries a source or it is not shown",
        now: "every number carries a source or it is not shown" }
    ];
  }

  var ORDER = [
    { key: "forecast", n: 20, title: "forecast" },
    { key: "moves", n: 21, title: "what moves it" },
    { key: "recommended", n: 22, title: "recommended on this date" },
    { key: "unknown", n: 23, title: "what we do not know" },
    { key: "grounds", n: 24, title: "on what grounds" }
  ];

  /**
   * Build the panel for one selected date.
   *
   * `input`: {nodes, edges, date, today, leBySex, sex, birth}
   *   - `date` is the selected day (ISO); anything before `today` is a past record;
   *   - `today` is the state we know now; a document may pass the real clock's day.
   *
   * Returns `{past, asOf, today, states, order, sections, empty}`. When `past` is false the same
   * data is built with `then === now`; the page draws one solid column and no paled one.
   */
  function build(input) {
    var opts = input || {};
    var nodes = opts.nodes || [];
    var edges = opts.edges || [];
    var today = day(opts.today) || day(opts.date);
    var asOf = day(opts.date) || today;
    var byId = (opts.byId || function (id) {
      var key = String(id);
      return nodes.filter(function (n) { return n && String(n.id) === key; })[0] || null;
    });
    var past = asOf < today;
    var thenOn = asOf;
    var nowOn = past ? today : asOf;
    var sex = opts.sex || "";
    var leBySex = opts.leBySex || {};

    var thenForecast = forecastAt(nodes, thenOn, leBySex, sex);
    var nowForecast = past ? forecastAt(nodes, nowOn, leBySex, sex) : thenForecast;
    var thenAdvice = adviceAt(nodes, edges, thenOn, byId);
    var nowAdvice = past ? adviceAt(nodes, edges, nowOn, byId) : thenAdvice;
    /* The gaps are computed for both states at once: a gap a later record closes reads "missing"
       on the selected date and "recorded <date>" now. */
    var gapRows = gaps(nodes, thenOn, past ? nowOn : thenOn);

    /* "What moves it" is drawn from the factors and from the records that record an effect, not
       from the measurement tracks: a lab panel that records no effect cannot move a life
       expectancy, and listing it at +0.0 said it had been weighed and came out empty. */
    var meta = opts.meta || {};
    var thenRows = explainAt(nodes, thenOn, byId, meta);
    var nowRows = past ? explainAt(nodes, nowOn, byId, meta) : thenRows;

    var delta = past
      ? deltaWords(thenForecast, nowForecast, thenRows, nowRows, asOf)
      : { total: "", because: "" };

    return {
      past: past,
      asOf: asOf,
      today: today,
      states: past
        ? [{ key: "then", label: "then", date: asOf, solid: true },
           { key: "now", label: "now", date: today, solid: false }]
        : [{ key: "then", label: "today", date: asOf, solid: true }],
      order: ORDER,
      empty: !thenForecast.available && !nowForecast.available,
      sections: {
        forecast: {
          then: thenForecast,
          now: past ? nowForecast : thenForecast,
          delta: delta,
          note: "the page's own projection \u2014 no interval is published for this baseline \u00b7 not a promise"
        },
        moves: {
          rows: moveRows(thenRows, nowRows),
          /* Said once, under the rows, only when nothing in this document records an effect: a
             kg/1-health document carries facts and its forecasts, and the panel must not let an
             all-dash column read as "we checked and nothing weighs". */
          note: moveNote(thenRows, nowRows)
        },
        recommended: { rows: recommendedRows(thenAdvice, nowAdvice) },
        unknown: { rows: gapRows },
        grounds: { rows: groundsRows(thenForecast, nowForecast, leBySex, sex) }
      }
    };
  }

  /* One sentence for the empty-effect case, and none when a row carries a number: a note that
     always says "no effect recorded" would become furniture and stop being read. */
  function moveNote(thenRows, nowRows) {
    var weighs = thenRows.concat(nowRows).filter(function (row) {
      return row.delta !== null && Math.abs(row.delta) >= 0.049;
    });
    if (weighs.length) return "";
    return "no record here carries an effect size \u2014 the rows are what the document says about " +
      "each factor, not a number nobody published";
  }

  root.RightPanel = Object.freeze({
    build: build,
    forecastAt: forecastAt,
    explainAt: explainAt,
    adviceAt: adviceAt,
    statusAt: statusAt,
    latestByTrack: latestByTrack,
    ORDER: ORDER
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
