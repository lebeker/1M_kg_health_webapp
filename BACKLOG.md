# Deferred

Things agreed, then parked — with the date and the reason, so nobody re-derives them.

## Layer merge (plan point 4) — deferred 2026-10-27

> "rearrange layers: combine mussles and bones (same click to split), combine lymph with
> blood, and put reproductive system back to organs"

- reproductive is already inside `organs` (14 meshes) — nothing left to do there
- left: `muscles` + `bones` as one row that splits on a second click; `lymphoid` merged into cardio
- parked: "let's think about it later" — the next work is the analyses/timeline layer, not the
  layer list

## Known defects, not fixed

- the shell is transparent, so the atlas face (skull, teeth, eyeballs) shows inside the head —
  the meshes inside the head volume are being hidden by name and bounds, and some are missing
  the test
- viscera do not fit the shell: liver past the left flank, gut below the pelvis, lungs to the
  clavicles
- the male reproductive tract sits in front of the thighs instead of inside the pelvis
