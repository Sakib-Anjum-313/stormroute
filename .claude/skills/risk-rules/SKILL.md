---
name: risk-rules
description: The single source of truth for weather-risk classification in the Spotter truck-routing app — the exact wind/rain/snow threshold table, the load-weight rules, the agreed boundary conventions, unit conversions, ETA-to-weather time alignment, mile attribution, average-risk scoring and the route recommendation comparator, plus the canonical test cases. Use this skill whenever you write, change, review or test any code that classifies risk, applies load rules, aggregates miles by level, ranks routes, colors the heatmap by risk, or explains a recommendation — in Python (backend/trips/domain) or TypeScript (frontend/src/lib/risk). Also use it when a reviewer or user asks "why is this checkpoint High?" or "why was this route recommended?".
---

# Risk rules

These rules come from the assessment spec plus decisions the user approved (see PLAN.md, section 3, ADR table). Every number below is either from the spec table or from an approved decision. Do not add, tune or "improve" thresholds. If something seems missing, ask the user instead of inventing it — graders check these rules line by line, so a silent deviation costs more than a question.

## 1. Levels and numeric score

| Level | Enum | Score |
|---|---|---|
| Low | `LOW` | 0 |
| Moderate | `MODERATE` | 1 |
| High | `HIGH` | 2 |
| Severe | `SEVERE` | 3 |
| No Travel | `NO_TRAVEL` | 4 |

`NO_DATA` is a checkpoint *status*, not a level. It has no score and its miles are kept separately.

Implement levels as an ordered `IntEnum` in Python (`trips/domain/levels.py`) and a matching const object in TypeScript (`frontend/src/lib/risk/levels.ts`). The overall level of anything is `max()` over component levels.

## 2. Threshold bands (boundary convention: lower bound inclusive)

Bands are half-open `[low, high)`: a value exactly on a boundary goes to the **worse** band. The only exceptions are where the spec says `>` explicitly (rain and snow No Travel), so the top of Severe is closed there. Compare raw floats; never round before classifying.

**Wind — sustained 10 m wind speed, mph** (Open-Meteo `wind_speed_10m`; gusts are display-only)

| Level | Range |
|---|---|
| LOW | `w < 25` |
| MODERATE | `25 <= w < 35` |
| HIGH | `35 <= w < 45` |
| SEVERE | `45 <= w < 55` |
| NO_TRAVEL | `w >= 55` |

**Rain — in/hr** (Open-Meteo `rain + showers`, preceding-hour sums, requested with `precipitation_unit=inch`)

| Level | Range |
|---|---|
| LOW | `r < 0.10` |
| MODERATE | `0.10 <= r < 0.25` |
| HIGH | `0.25 <= r < 0.50` |
| SEVERE | `0.50 <= r <= 1.00` |
| NO_TRAVEL | `r > 1.00` |

**Snow — in/hr** (Open-Meteo `snowfall`, preceding-hour sum, in inches of snow depth when `precipitation_unit=inch` — verified live: `hourly_units.snowfall == "inch"`)

| Level | Range |
|---|---|
| LOW | `s < 0.5` |
| MODERATE | `0.5 <= s < 1.0` |
| HIGH | `1.0 <= s < 2.0` |
| SEVERE | `2.0 <= s <= 3.0` |
| NO_TRAVEL | `s > 3.0` |

## 3. Load rules (weight in lb, strict `>` as in the spec)

The load rules can only make a level worse. Apply them to the wind level, then take the max over wind, rain and snow.

1. `w >= 55` → NO_TRAVEL for any load (already true from the table; keep it as a named rule so it shows in the trigger list).
2. `45 <= w < 55` and `weight_lb > 30_000` → NO_TRAVEL.
3. `35 <= w < 45` and `weight_lb > 40_000` → SEVERE.

```
wind_level = band(wind)
if rule2: wind_level = NO_TRAVEL
elif rule3: wind_level = max(wind_level, SEVERE)
level = max(wind_level, rain_level, snow_level)
```

Return the list of triggered rules with each result (for example `{"rule": "load_45_54_over_30k", "detail": "wind 47.2 mph with 36,000 lb > 30,000 lb → No Travel"}`) so the UI popup can show *why*.

Input validation happens at the API edge. The domain functions get finite, non-negative floats. Missing or NaN weather means status `NO_DATA`, not LOW.

## 4. Time alignment (weather at the truck's ETA)

Keep everything in UTC epoch seconds internally.

- **Wind** is instantaneous at each hour mark. Linearly interpolate between `floor_hour(eta)` and `floor_hour(eta) + 1h`. If ETA is exactly on an hour, use that hour's value.
- **Rain/snow** values labeled hour `H` cover the interval `(H-1h, H]`. Use the bucket that contains the ETA: label `= ceil_hour(eta)`, and an ETA exactly on the hour `H` uses label `H`. The value is already an in/hr rate.
- Heatmap frame `k` (k = 0..48) is at time `T0 + k h`, with `T0 = floor_hour(departure_utc)`. It uses the same two functions at that instant, so checkpoints and the heatmap can never disagree.

## 5. Mile attribution (half-interval ownership)

Checkpoints sit at miles `0, I, 2I, …` (each `< L`) plus the destination at `L`, for interval `I ∈ {10, 25, 50}`. Checkpoint `i` owns `[(m[i-1]+m[i])/2, (m[i]+m[i+1])/2]`, clipped to `[0, L]`. Owned miles sum exactly to `L`.

Example: L = 25, I = 10 gives checkpoints 0, 10, 20, 25 owning 5, 10, 7.5, 2.5.

Per route and interval:
- `miles_by_level[level]` is the sum of owned miles. NO_DATA miles go in their own bucket.
- `avg_risk = Σ(score × owned_mi) / Σ(owned_mi over checkpoints with data)`. If there is no data at all, it is `null`.

## 6. Recommendation comparator (lexicographic, smaller is better)

```
key(route) = (
  round(no_travel_mi, 1),   # step 0 — approved addition: No Travel is strictly worse than Severe
  round(severe_mi, 1),      # step 1 (spec)
  round(high_mi, 1),        # step 2 (spec)
  round(avg_risk, 2),       # step 3 (spec)
  round(duration_s / 60),   # step 4 (spec): travel time in whole minutes, HOS stops included when the toggle is on
  route_index,              # final deterministic tie-break: provider order (A, B, C)
)
```

The rounding exists only to absorb float noise. Report `decided_by` as the first step where the winner's key differs from the runner-up's, and record for every other route the step that separated it from the winner. If every route has `no_travel_mi > 0`, still rank them, but set `all_no_travel = true` so the UI shows a blocking red banner.

Each interval (10/25/50) has its own recommendation. They can differ, and the UI shows that honestly.

## 7. Canonical test cases (must stay green, table-driven in both languages)

| # | wind mph | rain in/hr | snow in/hr | weight lb | expected | why |
|---|---|---|---|---|---|---|
| 1 | 24.99 | 0 | 0 | 10,000 | LOW | below 25 |
| 2 | 25.0 | 0 | 0 | 10,000 | MODERATE | lower bound inclusive |
| 3 | 34.6 | 0 | 0 | 10,000 | MODERATE | no rounding |
| 4 | 35.0 | 0 | 0 | 40,000 | HIGH | 40,000 is not > 40,000 |
| 5 | 35.0 | 0 | 0 | 40,001 | SEVERE | load rule 3 |
| 6 | 44.99 | 0 | 0 | 80,000 | SEVERE | load rule 3 |
| 7 | 45.0 | 0 | 0 | 30,000 | SEVERE | 30,000 is not > 30,000 |
| 8 | 45.0 | 0 | 0 | 30,001 | NO_TRAVEL | load rule 2 |
| 9 | 54.99 | 0 | 0 | 5,000 | SEVERE | light load |
| 10 | 55.0 | 0 | 0 | 1 | NO_TRAVEL | rule 1 |
| 11 | 0 | 0.0999 | 0 | — | LOW | |
| 12 | 0 | 0.10 | 0 | — | MODERATE | |
| 13 | 0 | 0.25 | 0 | — | HIGH | overlap resolved upward |
| 14 | 0 | 0.50 | 0 | — | SEVERE | |
| 15 | 0 | 1.00 | 0 | — | SEVERE | spec says `> 1.00` |
| 16 | 0 | 1.0001 | 0 | — | NO_TRAVEL | |
| 17 | 0 | 0 | 0.49 | — | LOW | |
| 18 | 0 | 0 | 0.5 | — | MODERATE | |
| 19 | 0 | 0 | 1.0 | — | HIGH | overlap resolved upward |
| 20 | 0 | 0 | 2.0 | — | SEVERE | |
| 21 | 0 | 0 | 3.0 | — | SEVERE | spec says `> 3.0` |
| 22 | 0 | 0 | 3.01 | — | NO_TRAVEL | |
| 23 | 10 | 0.30 | 0.6 | 20,000 | HIGH | max across conditions |
| 24 | 36 | 0.12 | 0 | 45,000 | SEVERE | load rule beats rain |
| 25 | NaN | 0 | 0 | 20,000 | status NO_DATA | missing data is not LOW |

Comparator cases: one test per step (0–4) where that step alone decides, one full tie that resolves to the lowest route index, and one `all_no_travel` case.

## Where the code lives

- Python, pure, no Django or I/O imports: `backend/trips/domain/{levels,risk,timealign,attribution,recommend}.py`
- TypeScript mirror for display only (colors and labels, never re-classification): `frontend/src/lib/risk/`
- Tests: `backend/trips/tests/unit/test_risk.py`, `test_recommend.py`, `test_attribution.py`, `test_timealign.py`

The frontend never re-computes levels. The backend is authoritative, and the client only maps level to color and label.
