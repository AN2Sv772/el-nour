# Component specs — El Nour Business OS

Measured with the `replica-design` workflow: the **roles** and the **scale**
come from the measured Analify demo (system font stack, 12/14/16/18/36 type,
4/8 spacing, 4/8/12/pill radius, 40–56 px chrome); the **values** are El Nour's
own emerald brand. `tokens.json` passes the WCAG checker with **32 pairs, 0
failing AA**.

```
Token file  replica/design/tokens.json
Contrast    python3 replica-design/contrast.py replica/design/tokens.json  → 0 failing
Applied to  src/app/globals.css (@theme), light + dark
```

## Metric card

```
variants  currency, count, percent, ratio
anatomy   label · value · unit · status chip · comparison chip · provenance row
          (formula · source · window · last update) · gap note
states    actual · estimated · incomplete · unavailable · loading · error
tokens    bg surface, text text, border border, radius lg, padding 20px
a11y      value in the accessible name; status chip carries a text label
          (not colour alone); the provenance row is a <details> disclosure
used on    S01 home · S08 analytics · S09 finance
```

## Coverage meter (Brain)

```
variants  ring (hero), bar (inline), steps (9-step guide)
states    0 % · partial · complete · "needs you" · not configured
tokens    accent fill, accent-soft track, radius pill
a11y      role="progressbar" with aria-valuenow/min/max and a text percentage
used on    S01 home · S02 brain
```

## Source chip

```
variants  live · stale · disconnected · error
anatomy   platform name · state · last synced · answers-from-it count
tokens    success / warning / neutral fills, radius pill, type xs
a11y      the state is a word, not a colour
used on    S02 brain · S12 integrations
```

## Question card

```
variants  open · answered · skipped · AI-drafted (needs confirm)
anatomy   area · prompt · why it matters · answer textarea · save · skip
tokens    bg surface, border border, radius lg
a11y      the prompt is a heading; the textarea has a real <label>
used on    S02 brain · S05 questions
```

## Answer card (AI)

```
variants  answered · partly · withheld · failed · stopped
anatomy   status chip · answer body · calculation breakdown (formula lines)
          facts used (source + window + how counted) · what this doesn't cover
          charts · tables · follow-ups · actions (copy · regenerate · stop)
tokens    bg surface, border border, radius lg, type base
a11y      status is text; charts carry a text summary for screen readers
used on    S07 agent
```

## Approval card

```
variants  notification · change · stops-now · hard-to-undo
anatomy   what will change · why · affected records · expected impact
          severity · reversibility note · Allow / Deny · result
states    draft · pending · approved · rejected · executing · completed · failed · expired
tokens    warning border for hard-to-undo, success on completed, danger on failed
a11y      Allow / Deny are real buttons; the result is announced
used on    S07 agent · S10 marketing
```

## Breakdown list

```
variants  formula lines (label + value) · source lines (label + link)
states    collapsed · expanded
tokens    type sm, muted labels, tabular numbers
a11y      a <dl>; each line is dt/dd
used on    S07 agent · S09 finance
```

## Comparison chip

```
variants  up · down · flat · no-previous
tokens    success / danger / muted, radius pill, type xs
a11y      the arrow is decorative; the words "أعلى/أقل/بدون تغيير" carry it
used on    S01 home · S08 analytics · S09 finance
```

## Data-gap banner

```
variants  info · warning · critical
anatomy   title · detail · action link (to the module that fixes it)
tokens    info-soft / warning-soft / danger-soft, radius md, border matching
a11y      role="status" for info, role="alert" for critical
used on    S01 home · S08 analytics · S09 finance · S12 integrations
```

## Connection card

```
variants  connected · disconnected · connecting · error · rate-limited
anatomy   platform · state · last synced · what it unlocks · connect action
tokens    neutral / success / warning fills
a11y      state as text
used on    S12 integrations · S10 marketing · S13 connections
```

## Schedule card

```
variants  daily · weekly · monthly
anatomy   name · next run · last run · status · recipients · channel
tokens    bg surface, radius md
a11y      the next-run time is absolute, not "in 2 hours"
used on    S11 reports
```

## Chat composer

```
variants  empty · typing · sending · stopped · attachments · disabled
anatomy   textarea · attach · tools · dictation · send/stop
tokens    bg surface, border border-input (3:1 measured), radius md
a11y      Enter sends, Shift+Enter new line; the stop button keeps a label
used on    S07 agent · S01 home
```

## The shell (changed from the current app)

```
sidebar        224 px, collapsible to 60 px, RTL (right edge)
header         56 px, breadcrumb + global search + AI button + theme + user
content        max 1440 px, 16 px page padding, 24 px bottom on mobile
mobile dock    60 px fixed bottom, safe-area padded, 5 primary destinations
```

## Tokens that must exist in `globals.css`

`--color-surface-muted`, `--color-accent-soft`, `--color-success-soft`,
`--color-warning-soft`, `--color-info-soft`, `--color-danger-soft`,
`--color-neutral`, plus the corrected AA values for `--color-success`,
`--color-warning`, `--color-info` and `--color-input` found by the checker.
