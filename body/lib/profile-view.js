/* The profile view's missing blocks — widgets 27, 28, 29 and 30's other knobs.
 *
 * `body/index.html` draws the profile view (widget 2's view) with the widget numbers named in
 * `docs/WIDGETS.md`; SCRUM-52 drew the wireframe (`docs/wireframe-health-v11d-profile.svg`) and
 * SCRUM-49 put the view behind the header's second button. What the view still had not got was the
 * cohort it is measured against, the inputs each estimate reads, the facts no estimate reads, and
 * three of the four knobs. This file is those four blocks as data, pure and clock-free, so
 * `scripts/profile-view.test.ts` can state the card's acceptance without a browser and the page
 * can stay in charge of what the block looks like.
 *
 * Where every number here comes from — the card's hard constraint is that no number is invented:
 *
 *   - SCORE2's ages (40–69) and its four regions are `AGE_MIN`, `AGE_MAX` and `REGIONS` in
 *     `src/score2.ts`; its six inputs are `SCORE2_FACTS` in the same file;
 *   - the diabetes refusal is `src/score2.ts`'s own doc comment and `LIMITS`: the published
 *     indicator is set to zero for every individual prediction and the model is not for people
 *     with diabetes. It is a refusal, not a term;
 *   - Lee's twelve items, their whole-number points, the four bands and the age floor (60) are
 *     `LEE_ROWS`, `BANDS` and `AGE_MIN` in `src/lee.ts`, and the ceiling (26) is `MAX_POINTS`;
 *   - the cohort's sizes (11,701 developed, 8,009 validated) are `docs/LEE.md` §The cohort, from
 *     the paper; the discrimination (c = 0.84 / 0.82) is `src/lee.ts` `discrimination`;
 *   - what the region costs is `docs/SCORE2.md` §The region: it is not a field in `kg.json`, the
 *     recalibration scale has no default, and nothing in the template guesses a country.
 *
 * What is deliberately NOT here: the wireframe's per-knob years deltas (one for each of sex, birth
 * year, smoking and steps). No file in this repo derives them, so the page prints no such number —
 * the sex knob prints the baseline table it actually reads (`meta.life_expectancy`, default 74/80
 * in `body/index.html`), the birth-year knob prints the ages it recomputes, and the smoking and
 * step rows say in words what stops them. A row that invents a delta is worse than a row that is
 * not drawn.
 *
 * The document is read, never written: every reader below takes `nodes`/`meta` as arguments and
 * the page passes the document it already holds. Nothing here touches storage, the network or the
 * file.
 */
(function (root) {
  "use strict";

  var DAY = /^(\d{4})-(\d{2})-(\d{2})/;

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
  function markerText(m) {
    return m ? String(m.value) + (m.unit ? " " + m.unit : "") : "";
  }
  function text(node) {
    return [label(node), node && node.panel, node && node.name, node && node.summary, node && node.meaning]
      .filter(Boolean).join(" ");
  }
  /* The newest record dated on or before `asOf` that `test` accepts. Same rule the right panel
     uses: a record without a date cannot stand on a date. */
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
  function isMark(node) {
    return !!node && (node.kind === "observation" || node.kind === "analysis");
  }
  /* A condition in the record is a fact the record states. A condition *not* in the record is not
     "no": it is a fact nobody asked about, which is a different row (and `src/lee.ts` says so). */
  function conditionNamed(nodes, re) {
    for (var i = 0; i < (nodes || []).length; i += 1) {
      var node = nodes[i];
      if (node && node.kind === "condition" && re.test(text(node))) return node;
    }
    return null;
  }

  /* SCORE2's table, as `src/score2.ts` states it. `fact` is the document's name for the fact and
     `input` the model's — `SCORE2_FACTS` is the one place the two vocabularies meet, and the test
     holds this list to it. */
  var SCORE2 = {
    ages: { min: 40, max: 69 },
    regions: ["low", "moderate", "high", "very_high"],
    facts: [
      { fact: "age", input: "age", label: "age" },
      { fact: "sex", input: "sex", label: "sex" },
      { fact: "current_smoker", input: "currentSmoker", label: "current smoking" },
      { fact: "systolic_bp", input: "systolicBp", label: "systolic blood pressure" },
      { fact: "total_cholesterol", input: "totalCholesterol", label: "total cholesterol" },
      { fact: "hdl_cholesterol", input: "hdlCholesterol", label: "HDL cholesterol" }
    ]
  };

  /* Lee's table, as `src/lee.ts` states it: the age item is six printed bands, every other item is
     one row, and the points are the paper's whole numbers. */
  var LEE = {
    ageMin: 60,
    ageTypoMax: 120,
    maxPoints: 26,
    cohort: "community-dwelling US adults over 50 — Health and Retirement Study, 1998 wave",
    developed: 11701,
    validated: 8009,
    discrimination: { development: 0.84, validation: 0.82 },
    bands: [
      { from: 0, to: 5, printed: "less than 4%" },
      { from: 6, to: 9, printed: "15%" },
      { from: 10, to: 13, printed: "42%" },
      { from: 14, to: null, printed: "64%" }
    ],
    ageBands: [
      { id: "age_60_64", label: "age 60–64", from: 60, to: 64, points: 1 },
      { id: "age_65_69", label: "age 65–69", from: 65, to: 69, points: 2 },
      { id: "age_70_74", label: "age 70–74", from: 70, to: 74, points: 3 },
      { id: "age_75_79", label: "age 75–79", from: 75, to: 79, points: 4 },
      { id: "age_80_84", label: "age 80–84", from: 80, to: 84, points: 5 },
      { id: "age_85_plus", label: "age 85 or more", from: 85, to: null, points: 7 }
    ],
    items: [
      { fact: "sex", label: "male sex", points: 2 },
      { fact: "diabetes", label: "diabetes", points: 1 },
      { fact: "cancer", label: "cancer", points: 2 },
      { fact: "lung_disease", label: "lung disease", points: 2 },
      { fact: "heart_failure", label: "heart failure", points: 2 },
      { fact: "current_smoker", label: "current tobacco use", points: 2 },
      { fact: "bmi", label: "body mass index under 25", points: 1 },
      { fact: "difficulty_bathing", label: "difficulty bathing", points: 2 },
      { fact: "difficulty_walking_several_blocks", label: "difficulty walking several blocks", points: 2 },
      { fact: "difficulty_managing_money", label: "difficulty managing money", points: 2 },
      { fact: "difficulty_pushing_large_objects", label: "difficulty pushing large objects", points: 1 }
    ]
  };

  /* Widget 29. These are named because neither estimate reads them: the test holds each name to
     the absence of the fact in `SCORE2_FACTS` and `LEE_ROWS`. `why` says where that is written
     down, not what the page wishes were true. */
  var BLIND = [
    { name: "family history", why: "not one of SCORE2's six inputs or Lee's twelve items" },
    { name: "sleep", why: "not an input of either model" },
    { name: "vaccinations", why: "a record can hold one; neither estimate reads it" },
    { name: "depression", why: "Lee's own limits say social and psychological measures carry no weight" },
    { name: "loneliness", why: "a social measure neither paper scores" }
  ];

  function ageOf(meta, born, asOf) {
    var year = num(born);
    if (year === null) year = num(meta && meta.profile && meta.profile.year_of_birth);
    var m = /^(\d{4})/.exec(String(asOf || ""));
    if (year === null || !m) return null;
    var age = Number(m[1]) - year;
    return age >= 0 ? age : null;
  }

  function ageBandAt(age) {
    if (age === null) return null;
    for (var i = 0; i < LEE.ageBands.length; i += 1) {
      var band = LEE.ageBands[i];
      if (age >= band.from && (band.to === null || age <= band.to)) return band;
    }
    return null;
  }

  /* The dates the record covers, as ages of the reading year. Nothing is stored: correct the year
     and every dated fact stands at a different age, which is the only way this page can show what
     the birth-year knob moves. Same rule as `src/profile.ts` `recordAges`: a node dated before the
     birth year yields a negative age deliberately. */
  function spanOf(nodes, year) {
    var dates = [];
    var dated = 0;
    (nodes || []).forEach(function (node) {
      var when = node && node.when;
      var found = [];
      if (typeof when === "string") {
        if (DAY.test(when)) found.push(day(when));
      } else if (when && typeof when === "object") {
        if (typeof when.from === "string" && DAY.test(when.from)) found.push(day(when.from));
        if (typeof when.to === "string" && DAY.test(when.to)) found.push(day(when.to));
      }
      if (!found.length) {
        var single = node && day(node.date);
        if (single) found.push(single);
      }
      if (found.length) {
        dates = dates.concat(found);
        dated += 1;
      }
    });
    if (!dates.length || year === null) return null;
    dates.sort();
    var first = dates[0];
    var last = dates[dates.length - 1];
    return {
      first: first,
      last: last,
      fromAge: Number(first.slice(0, 4)) - year,
      toAge: Number(last.slice(0, 4)) - year,
      dated: dated
    };
  }

  /* ---- widget 27: the cohort the forecast is measured against ------------------------------- */
  function cohortOf(meta, nodes, age, today) {
    var region = meta && (meta.region || (meta.profile && meta.profile.region));
    var score2Refusals = [];
    if (!region || SCORE2.regions.indexOf(String(region)) === -1) {
      score2Refusals.push(
        "no ESC region in this document: the recalibration scale is chosen by region and there is no default, so SCORE2 refuses to print a risk"
      );
    }
    if (age === null) {
      score2Refusals.push("no age: the model reads age as (age − 60) / 5 and cannot be given a guess");
    } else if (age < SCORE2.ages.min || age > SCORE2.ages.max) {
      score2Refusals.push(
        "age " + age + " is outside " + SCORE2.ages.min + "–" + SCORE2.ages.max + ": over 70 is SCORE2-OP, a different model with different coefficients, and under 40 has no scale here"
      );
    }
    if (conditionNamed(nodes, /diabet/i)) {
      score2Refusals.push(
        "the record says diabetes: SCORE2 sets the published diabetes indicator to zero and is not for people with diabetes (SCORE2-Diabetes is a separate algorithm), so it refuses instead of printing a risk"
      );
    }

    return {
      score2: {
        title: "SCORE2 — 10-year risk of fatal and non-fatal cardiovascular disease",
        ages: SCORE2.ages,
        regions: SCORE2.regions.slice(),
        regionInDocument: !!region && SCORE2.regions.indexOf(String(region)) !== -1,
        note: "a group model on a published scale, recalibrated to one ESC region; the page prints no number for it here",
        refusals: score2Refusals
      },
      lee: {
        title: "Lee — 4-year mortality index, in points",
        cohort: LEE.cohort,
        developed: LEE.developed,
        validated: LEE.validated,
        ageMin: LEE.ageMin,
        maxPoints: LEE.maxPoints,
        bands: LEE.bands.slice(),
        discrimination: { development: LEE.discrimination.development, validation: LEE.discrimination.validation },
        note: "the bands are the validation cohort's observed mortality for a group with that many points, not a probability for one person",
        refusals: []
      }
    };
  }

  /* ---- widget 28: what each model reads, and what it refuses --------------------------------- */

  /* One row per fact: `supplied` (the document states it), `supplied` with 0 points
     (`did not score`), `absent` (nobody asked) or `refused` (the model will not read it). */
  function factRow(key, labelText, state, detail, hit, value, points) {
    return {
      key: key,
      label: labelText,
      state: state,
      detail: detail || "",
      record: hit ? String(hit.node.id) : "",
      date: hit ? hit.at : "",
      value: value || "",
      points: points == null ? null : points
    };
  }

  function score2Rows(meta, nodes, age, sex, smoker, today) {
    var rows = [];
    var profile = (meta && meta.profile) || {};
    var reading = sex || profile.sex;

    rows.push(
      factRow("age", "age", age === null ? "absent" : "supplied",
        age === null ? "no year of birth in the document" : "age " + age + " · from meta.profile.year_of_birth",
        null, age === null ? "" : String(age), null)
    );
    rows.push(
      factRow("sex", "sex", reading ? "supplied" : "absent",
        reading
          ? reading + " · " + (profile.sex && profile.sex !== reading
              ? "the document says " + profile.sex + "; the file is not written"
              : "from meta.profile")
          : "no sex in the document, and the page does not pick one",
        null, reading || "", null)
    );

    /* A document that mentions smoking is not a smoking status — only a condition or a
       measurement can say what the person does, which is the right panel's rule too. The knob is
       the reader's reading, not the record's, and the row says which one it is showing. */
    var smoke = newest(nodes, today, function (n) {
      if (String(n.kind || "") !== "condition" && !isMark(n)) return false;
      return /smok|tobacco/i.test(text(n));
    });
    rows.push(smoke
      ? factRow("current_smoker", "current smoking", "supplied", "recorded in the document", smoke, label(smoke.node), null)
      : smoker === true || smoker === false
        ? factRow("current_smoker", "current smoking", "supplied",
            "reading it as " + (smoker ? "a smoker" : "a non-smoker") +
            " — the document records nothing; the file is not written",
            null, smoker ? "smoker" : "non-smoker", null)
        : factRow("current_smoker", "current smoking", "absent",
            "no record says whether he smokes, and an unknown smoking status is not a non-smoker", null, "", null));

    var bp = newest(nodes, today, function (n) {
      return isMark(n) && (!!markerNamed(n, /systolic/i) || /blood pressure/i.test(label(n)));
    });
    rows.push(bp
      ? factRow("systolic_bp", "systolic blood pressure", "supplied",
          "the newest reading on or before today", bp, markerText(markerNamed(bp.node, /systolic/i)), null)
      : factRow("systolic_bp", "systolic blood pressure", "absent", "no blood-pressure record", null, "", null));

    var tc = newest(nodes, today, function (n) {
      return isMark(n) && !!markerNamed(n, /total cholesterol/i);
    });
    rows.push(tc
      ? factRow("total_cholesterol", "total cholesterol", "supplied",
          "the newest reading on or before today", tc, markerText(markerNamed(tc.node, /total cholesterol/i)), null)
      : factRow("total_cholesterol", "total cholesterol", "absent", "no total-cholesterol record", null, "", null));

    var hdl = newest(nodes, today, function (n) {
      return isMark(n) && !!markerNamed(n, /hdl/i);
    });
    rows.push(hdl
      ? factRow("hdl_cholesterol", "HDL cholesterol", "supplied",
          "the newest reading on or before today", hdl, markerText(markerNamed(hdl.node, /hdl/i)), null)
      : factRow("hdl_cholesterol", "HDL cholesterol", "absent", "no HDL record", null, "", null));

    var diabetes = conditionNamed(nodes, /diabet/i);
    rows.push(diabetes
      ? factRow("diabetes", "diabetes", "refused",
          "in the record (" + label(diabetes) + "), and SCORE2 is not for people with diabetes — the row refuses the record instead of printing a number",
          null, label(diabetes), null)
      : factRow("diabetes", "diabetes", "absent",
          "not a SCORE2 input: the published indicator is multiplied by zero", null, "", null));

    return rows;
  }

  function leeRows(meta, nodes, age, sex, smoker, today) {
    var rows = [];
    var band = ageBandAt(age);

    rows.push({
      key: "age",
      label: band ? band.label : "age",
      state: band ? "supplied" : "absent",
      detail: band ? "the printed band the age falls in" : (age === null ? "no year of birth in the document" : "age " + age + " is under " + LEE.ageMin + ", where the printed table begins"),
      record: "",
      date: "",
      value: age === null ? "" : String(age),
      points: band ? band.points : null
    });

    function conditionRow(fact, labelText) {
      var hit = conditionNamed(nodes, new RegExp(fact === "lung_disease" ? "lung" : fact === "heart_failure" ? "heart failure|cardiac failure" : fact, "i"));
      rows.push({
        key: fact,
        label: labelText,
        state: hit ? "supplied" : "absent",
        detail: hit ? "in the record: " + label(hit) : "no such condition in the record — and 'we do not know' is not 'no'",
        record: hit ? String(hit.id) : "",
        date: hit ? dateOf(hit) : "",
        value: hit ? label(hit) : "",
        points: hit ? (fact === "diabetes" ? 1 : 2) : null
      });
    }

    rows.push({
      key: "sex",
      label: "male sex",
      state: sex === "male" || sex === "female" ? "supplied" : "absent",
      detail: sex === "male" ? "male — the 2 points apply" : sex === "female" ? "female — supplied, and the item scores nothing" : "no sex in the document",
      record: "",
      date: "",
      value: sex || "",
      points: sex === "male" ? 2 : 0
    });
    conditionRow("diabetes", "diabetes");
    conditionRow("cancer", "cancer");
    conditionRow("lung_disease", "lung disease");
    conditionRow("heart_failure", "heart failure");

    var bmi = newest(nodes, today, function (n) {
      return isMark(n) && !!markerNamed(n, /bmi|body mass index/i);
    });
    rows.push({
      key: "current_smoker",
      label: "current tobacco use",
      state: smoker === true || smoker === false ? "supplied" : "absent",
      detail: smoker === true ? "reading it as a smoker — the document records nothing; the file is not written"
        : smoker === false ? "reading it as a non-smoker — the document records nothing; the file is not written"
          : "the document records no smoking status",
      record: "",
      date: "",
      value: smoker === true ? "smoker" : smoker === false ? "non-smoker" : "",
      points: smoker === true ? 2 : smoker === false ? 0 : null
    });
    rows.push({
      key: "bmi",
      label: "body mass index under 25",
      state: bmi ? "supplied" : "absent",
      detail: bmi ? "the newest BMI record" : "no height and weight on one day, so no BMI — and an unknown weight is not a normal one",
      record: bmi ? String(bmi.node.id) : "",
      date: bmi ? bmi.at : "",
      value: bmi ? markerText(markerNamed(bmi.node, /bmi|body mass index/i)) : "",
      points: bmi ? 1 : null
    });

    ["difficulty_bathing", "difficulty_walking_several_blocks", "difficulty_managing_money", "difficulty_pushing_large_objects"]
      .forEach(function (fact) {
        var labelText = fact.replace(/_/g, " ").replace("difficulty ", "difficulty ");
        rows.push({
          key: fact,
          label: labelText,
          state: "absent",
          detail: "a self-reported difficulty nobody asked about — and a difficulty that was not asked is not an absence",
          record: "",
          date: "",
          value: "",
          points: null
        });
      });

    return rows;
  }

  /* The document's newest dated fact, used as the "today" reading for a document with no clock. */
  function today0(nodes) {
    var last = "";
    (nodes || []).forEach(function (node) {
      var at = dateOf(node);
      if (at && at > last) last = at;
    });
    return last || "";
  }

  function leeSummary(rows) {
    var supplied = rows.filter(function (row) { return row.state === "supplied"; });
    var points = supplied.reduce(function (sum, row) {
      return sum + (row.points === null ? 0 : row.points);
    }, 0);
    return {
      supplied: supplied.length,
      items: rows.length,
      points: points,
      maxPoints: LEE.maxPoints,
      complete: supplied.length === rows.length
    };
  }

  function inputsOf(meta, nodes, age, sex, smoker, today) {
    var score2 = score2Rows(meta, nodes, age, sex, smoker, today);
    var lee = leeRows(meta, nodes, age, sex, smoker, today);
    var summary = leeSummary(lee);
    var region = meta && (meta.region || (meta.profile && meta.profile.region));
    var score2Refusals = [];
    if (!region || SCORE2.regions.indexOf(String(region)) === -1) {
      score2Refusals.push("no ESC region in the document, and the recalibration scale has no default");
    }
    if (score2.some(function (row) { return row.state === "refused"; })) {
      score2Refusals.push("the record says diabetes, which SCORE2 does not score");
    }
    var missing = score2.filter(function (row) { return row.state === "absent"; }).map(function (row) { return row.label; });
    if (missing.length) score2Refusals.push("no record for " + missing.join(", ") + ", and a missing input is not a normal one");

    return {
      score2: { rows: score2, refusals: score2Refusals },
      lee: {
        rows: lee,
        summary: summary,
        refusals: summary.complete
          ? []
          : [
              "the index needs all twelve items and this document supplies " + summary.supplied +
                " — a missing item is not a zero, so no index and no band are printed",
            ]
      }
    };
  }

  /* ---- widget 30: the knobs ------------------------------------------------------------------ */

  function baselineOf(leBySex, sex) {
    var table = leBySex || {};
    var value = num(table[sex]);
    if (value === null) value = num(table.male);
    return value === null ? null : value;
  }

  function knobsOf(meta, age, sex, born, smoker, leBySex) {
    var profile = (meta && meta.profile) || {};
    var documentYear = num(profile.year_of_birth);
    var table = leBySex || {};
    var male = num(table.male);
    var female = num(table.female);
    var base = baselineOf(table, sex);
    var other = sex === "female" ? male : female;
    var move = base === null || other === null ? null : Math.round((other - base) * 10) / 10;

    var birthRefusals = [];
    if (age === null) birthRefusals.push("no age to read: the page cannot compute one without a year of birth");
    else {
      if (age < SCORE2.ages.min || age > SCORE2.ages.max) {
        birthRefusals.push("SCORE2 refuses age " + age + ": it is validated for " + SCORE2.ages.min + "–" + SCORE2.ages.max);
      }
      if (age < LEE.ageMin) birthRefusals.push("Lee refuses age " + age + ": its printed table begins at " + LEE.ageMin + "–64");
    }

    return {
      sex: {
        value: sex,
        documentValue: profile.sex || "",
        edited: !!profile.sex && !!sex && profile.sex !== sex,
        table: { male: male, female: female },
        move: move,
        detail: move === null
          ? "the forecast's baseline for the other sex is not in this document's table, so the page prints no number for the move"
          : "the forecast's baseline in this document's table: " + (male === null ? "male —" : "male " + male) +
            " · " + (female === null ? "female —" : "female " + female) +
            "; reading as " + sex + " puts it at " + base + ", the other row at " + other + " (" + (move >= 0 ? "+" : "−") +
            Math.abs(move).toFixed(1) + " years)"
      },
      birth: {
        value: born === null || born === undefined ? documentYear : num(born),
        documentValue: documentYear,
        age: age,
        edited: born !== null && born !== undefined && documentYear !== null && num(born) !== documentYear,
        detail: "every age on this page is read from it — the age today, the record's age span and the age the projection's age factor states — and the file is not written",
        refusals: birthRefusals
      },
      smoker: {
        value: smoker === true ? "smoker" : smoker === false ? "non-smoker" : "not stated",
        documentValue: "not stated",
        edited: smoker === true || smoker === false,
        points: smoker === true ? 2 : smoker === false ? 0 : null,
        detail: "Lee scores current tobacco use at 2 of its " + LEE.maxPoints + " points and SCORE2 carries a smoking term with an age interaction; neither estimate can be evaluated for this document, so no years are printed for this knob"
      },
      steps: {
        value: null,
        detail: "no model in this repo reads a step count: it is not one of SCORE2's six inputs and not one of Lee's twelve items, and no effect size with a published source exists — so the knob is not drawn rather than drawn with a number nobody published"
      }
    };
  }

  /* ---- the whole view, as data ---------------------------------------------------------------- */

  /**
   * One profile view's blocks.
   *
   * `input`: { meta, nodes, sex, born, smoker, today, leBySex }
   *   - `meta`/`nodes` are the document the page holds, read and never written;
   *   - `sex`, `born` and `smoker` are the reader's readings (a knob turned, or nothing);
   *   - `today` is the day the page is read on; the module never asks the clock.
   */
  function build(input) {
    var opts = input || {};
    var meta = opts.meta || {};
    var nodes = opts.nodes || [];
    var profile = meta.profile || {};
    var today = day(opts.today) || today0(nodes);
    var sex = opts.sex || profile.sex || "";
    var born = opts.born === undefined ? null : opts.born;
    var documentYear = num(profile.year_of_birth);
    var year = born === null ? documentYear : num(born);
    var age = ageOf(meta, born === null ? null : born, today);

    return {
      subject: {
        name: typeof profile.name === "string" && profile.name.trim() ? profile.name.trim() : null,
        sex: profile.sex || null,
        year: documentYear,
        age: ageOf(meta, null, today),
        reading: { year: year, age: age, sex: sex },
        span: spanOf(nodes, year),
        edited: (born !== null && documentYear !== null && num(born) !== documentYear) ||
          (!!profile.sex && !!sex && profile.sex !== sex),
        today: today
      },
      cohort: cohortOf(meta, nodes, age, today),
      inputs: inputsOf(meta, nodes, age, sex, opts.smoker === undefined ? null : opts.smoker, today),
      blind: BLIND.map(function (row) { return { name: row.name, why: row.why }; }),
      knobs: knobsOf(meta, age, sex, born, opts.smoker === undefined ? null : opts.smoker, opts.leBySex),
      sources: {
        score2: "src/score2.ts",
        lee: "src/lee.ts",
        region: "docs/SCORE2.md §The region",
        cohortSizes: "docs/LEE.md §The cohort",
        baseline: "meta.life_expectancy, default {male: 74, female: 80} in body/index.html"
      }
    };
  }

  root.ProfileView = Object.freeze({
    build: build,
    SCORE2: SCORE2,
    LEE: LEE,
    BLIND: BLIND,
    ageBandAt: ageBandAt,
    baselineOf: baselineOf
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
