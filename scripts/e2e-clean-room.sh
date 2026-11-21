#!/usr/bin/env bash
# Clean-room test: a folder with nothing but the kg skill.
#
# Answers the only question that matters before shipping a template:
# "does a fresh agent, given one skill and a vague human sentence, find the right app?"
#
# Usage:  ./scripts/e2e-clean-room.sh [path-to-kg-skill]
# Exit:   0 = pass, 1 = fail.
#
# What makes this test real: it checks exit codes, it checks the document's own `meta.levels`
# (not the default colour palette, which contains every kind and would pass whatever the
# catalogue says), and it expects `new --app <unknown>` to FAIL. A test that cannot go red
# proves nothing.

set -u

SKILL=""
for cand in "${1:-}" "../1M_kg_skill" "$HOME/Work/other/1M_kg_skill"; do
  [ -n "$cand" ] && [ -f "$cand/scripts/kg.py" ] && { SKILL="$cand"; break; }
done
[ -n "$SKILL" ] || { echo "FAIL: no kg skill found (pass its path as \$1)"; exit 1; }
SKILL="$(cd "$SKILL" && pwd)"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/kg-clean.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
cp -R "$SKILL" "$WORK/kg"
cd "$WORK" || exit 1

fail=0
ok()   { echo "  ok   $1"; }
bad()  { echo "  FAIL $1"; fail=$((fail + 1)); }
have() { printf '%s' "$2" | grep -q -- "$1"; }

KG="python3 kg/scripts/kg.py"
echo "clean room: $WORK"
echo "skill:      $SKILL -> $WORK/kg (the only thing installed)"
echo

# 1 ---------------------------------------------------------------------------
echo "1. a vague health question, asked in English"
OUT="$($KG suggest "is there anything here to show my health data" 2>&1)"; RC=$?
[ "$RC" -eq 0 ] && ok "suggest exits 0" || bad "suggest exit $RC"
have "app       health-viewer" "$OUT"  && ok "picks health-viewer"     || bad "does not pick health-viewer"
have "installed no" "$OUT"             && ok "says it is not installed" || bad "does not say it is missing"
have "fetch-app health-viewer" "$OUT"  && ok "names the install command" || bad "no install command"
echo

# 2 ---------------------------------------------------------------------------
echo "2. a research question does not steal the health app"
OUT="$($KG suggest "map this research field" 2>&1)"; RC=$?
[ "$RC" -eq 0 ] && ok "suggest exits 0" || bad "suggest exit $RC"
have "app       viewer" "$OUT" && ok "still picks viewer" || bad "research ask landed elsewhere"
echo

# 3 ---------------------------------------------------------------------------
echo "3. a graph can be born with the health vocabulary"
OUT="$($KG new --id probe --app health-viewer --title probe 2>&1)"; RC=$?
[ "$RC" -eq 0 ] && ok "new exits 0" || bad "new exit $RC: $(echo "$OUT" | head -2)"
DOC="storage/probe/graph.json"
if [ -f "$DOC" ]; then
  ok "$DOC exists"
  # meta.levels is the app's own anchor table. The default colour palette also contains these
  # words, so grepping the file for "condition" would stay green even with an empty catalogue.
  WANT="$(printf 'condition encounter medication observation prediction source summary\n' | tr ' ' '\n' | sort | tr '\n' ' ')"
  GOT="$(python3 -c "import json;print(' '.join(sorted(json.load(open('$DOC'))['meta'].get('levels',{}))))")"
  [ "$WANT" = "$GOT " ] && ok "levels are the seven health anchors" \
                       || bad "levels are '$GOT', expected '$WANT'"
  have '"app": "health-viewer"' "$(cat "$DOC")" && ok "document names its app" || bad "app not stamped"
  URL="$(python3 -c "import json;print(json.load(open('$DOC'))['meta'].get('app_url') or '')")"
  [ -z "$URL" ] && ok "no app_url borrowed from the built-in viewer" \
                || bad "app_url points somewhere: $URL"
  OUT="$($KG validate --graph probe 2>&1)"; RC=$?
  [ "$RC" -eq 0 ] && ok "validate exits 0" || bad "validate exit $RC"
  have "conformant" "$OUT" && ok "document is conformant" || bad "validate did not say conformant"
else
  bad "$DOC was not created"
fi
echo

# 4 ---------------------------------------------------------------------------
echo "4. an unknown app is refused, not silently accepted"
OUT="$($KG new --id nope --app nonsense-app --title nope 2>&1)"; RC=$?
[ "$RC" -ne 0 ] && ok "new exits $RC for an unknown app" || bad "unknown app accepted (exit 0)"
[ ! -f storage/nope/graph.json ] && ok "no document was written" || bad "a document was written anyway"
echo

if [ "$fail" -eq 0 ]; then echo "PASS"; exit 0; fi
echo "FAIL: $fail check(s)"; exit 1
