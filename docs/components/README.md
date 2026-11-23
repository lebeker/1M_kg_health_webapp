# Components

One file per component of the page: what it is for, what it must do, and the scenarios a reviewer
runs by hand. The scenarios are text on purpose — the e2e is a model in a room reading them, so they
have to be readable by somebody who has never seen the code, and they have to name what is *seen*,
not what is called.

| component | file | fixed by |
|---|---|---|
| the ruler (timeline) | [`timeline.md`](timeline.md) | `docs/wireframe-health-v11-analysis.svg` |
| the records list | *(to write)* | `docs/wireframe-health-v11-analysis.svg` |
| the record column | *(to write)* | `docs/wireframe-health-v11b-diagnosis.svg` |
| the forecast panel | *(to write)* | `docs/wireframe-health-v11c-summary.svg` |
| the profile view | *(to write)* | `docs/wireframe-health-v11d-profile.svg` |

A component file has four parts: **what it is**, **what it must do** (the behaviours, one line each),
**scenarios** (what a reviewer does and what they should see), and **what is still missing**, so a
gap is written down where the next person looks instead of being rediscovered.
