# Brief Template - Field-by-Field

One brief per concept, 1-2 pages including references. Open every brief with the definitions header (concept / angle / hook / format / iteration, as fixed in SKILL.md) so no reader argues vocabulary mid-production.

## Contents

1. Core fields (all formats)
2. Variant: static image
3. Variant: search / responsive text ads
4. Variant: short-form video / UGC

Variants run in the efficiency order set by SKILL.md § Format Variants, not alphabetically or by popularity.

## 1. Core fields (all formats)

### 1 - Context

| Field                      | Guidance                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Concept name               | The name the naming convention builds on; pick it here, not at upload time                            |
| Goal + primary KPI         | One goal, one deciding KPI. "Awareness and conversions" is two briefs                                 |
| Platform(s) + placements   | Per placement, not per platform - crops and overlays differ within one platform                       |
| Dates                      | Launch date and production dates (shoot / draft / final) locked, not "ASAP"                           |
| Budget + deliverable count | Sets the test's statistical ceiling; a 3-file test at low spend cannot support a 5-variant hypothesis |

### 2 - Audience

| Field                  | Guidance                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Persona + life context | The context in which this person feels the pain - not demographics alone                                             |
| Awareness level        | One of Schwartz's five: unaware / problem-aware / solution-aware / product-aware / most aware. Never "all audiences" |
| Belief before the ad   | What they currently think is true about the problem/category                                                         |
| Core objection         | The top recurring objection from 1-2 star reviews or lost-deal notes; the creative must address at least one         |
| B2B: committee role    | Which of the parallel personas (economic buyer / technical evaluator / end user) this brief targets                  |

### 3 - Message

| Field              | Guidance                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| Messaging angle    | One conversational human sentence. Test: could a customer plausibly say it out loud? A tagline fails this test |
| Value prop         | What's in it for them, in their words - pull verbatim from review mining where possible                        |
| One proof point    | Exactly one. B2C: review, before/after, demo. B2B: quantifiable outcome + badge or product screenshot          |
| Evidence citations | Which review / call note / past winner each claim traces to. No citation, no claim                             |

Completion test for this section: finish the sentence "After seeing this ad, our target customer should think/feel ___." If you cannot, you have talking points, not a brief.

### 4 - Hypothesis

`If we lead with [pain] and [proof], then [audience] will [action].` (Directive Consulting's template.) Tag the type - hook / proof / format / angle / persona, in the efficiency order SKILL.md § Testing Intent sets - because the type dictates what must stay constant, and how much the test costs to run. A brief without a hypothesis is a production order, not a test.

### 5 - Hooks

3-5 options. Each option carries:

- Trigger-type tag (one of the eight listed in efficiency order in SKILL.md § Hook Direction - default to the highest-ranked one the brief's awareness level endorses)
- For video, the three layers labelled separately: SPOKEN / VISUAL / TEXT OVERLAY
- For static: primary-text hook / headline / caption hook
- One line on the evidence behind it (long-running competitor pattern, review verbatim, past winner)

Then: recommended first test + rationale. Keep options as _directions_ ("open on the result, then explain how"), not scripted lines.

### 6 - Art direction

| Field                     | Guidance                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reference ads             | 2-3, in-category, each with one line: "take the pacing", "take the caption treatment". Never more than 3 - excess references confuse rather than align |
| Do / Don't                | Max 2 each                                                                                                                                             |
| Specs                     | Aspect ratio + length per placement; "preview in-placement before export" instead of hardcoded safe-zone pixels                                        |
| Sound-off + accessibility | Key claims legible as on-screen text; captions; 4.5:1 contrast; alt text; ≤3 flashes/sec                                                               |
| Enhancements              | On/off per auto-enhancement type, recorded, owner-approved                                                                                             |
| AI disclosure             | Whether any asset uses externally generated AI content, and that it will be declared                                                                   |
| Compliance mandatories    | Substantiation-required claims, forbidden phrasings ("helps relieve", never "cures"), regulated-category notes                                         |

### 7 - Deliverables

| Field                | Guidance                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| Arithmetic           | Formula form: `2 hooks × 1 main edit = 3 files`, `1 concept × 3 ratios = 3 exports`                |
| Iteration vs net-new | Flag each file `NEW` or `IT`. A resize is not a new design; hook cuts of one video are one concept |
| Naming               | Concept → iteration (V1, V2) → format (1x1, 4x5, 9x16) → test variable; ASCII, underscores         |
| Revision cap         | A number, agreed here, not discovered in round four                                                |

### 8 - Test block

| Field                    | Guidance                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------- |
| Variable / constants     | The one thing that changes; list what is frozen (targeting included)                |
| Minimum evidence         | Impressions/spend/conversions floor before any kill or scale call                   |
| Deciding KPI + benchmark | The number and where it comes from (account history preferred over published bands) |
| On win / on loss         | Next action for each outcome, decided now                                           |
| Learning destination     | The named log/bank where the result gets written, win or lose                       |

## 2. Variant: static image

Add to the core:

- **Visual hierarchy order**: what the eye lands on first, second, third (focal point → headline → CTA → brand mark). If product, headline, badge and logo all compete, the viewer picks none.
- **Copy blocks**: headline + supporting line + CTA, each with its character budget for the placement.
- **Mobile-size check**: require reviewing the asset at feed size - a message that fails small fails everywhere.
- Typical test variables, ranked rather than listed:
  - effort: visual style > headline == offer framing
  - efficiency: offer framing > headline > visual style
  - Headline and offer framing tie on effort because both are a text swap into the same layout - the designer touches nothing. A new visual style is a new design, and offer framing moves the decision itself rather than its wording, which is what separates the three on efficiency. Default first variable: offer framing.
  - What the ratio starves is **visual style**: it is the variable a scroll actually registers first and the only one that costs a design pass, so it never wins a ratio and never gets tested. Promote it when two offer and headline tests in a row have both come back flat, or when the designer owns a live template file and can restyle in minutes - the effort axis collapses and it moves up on cost alone. Where the offer is fixed by the business, delete offer framing from this brief's variable list and say so, rather than leaving it top-ranked and untestable.

## 3. Variant: search / responsive text ads

No hook, no visual; the system assembles the ad, so the brief specifies an asset pool.

- **Ad-group theme**: the real briefing unit. Every asset must work with every keyword in the group; loose theming is the format's main failure.
- **Headline pool**: up to 15 headlines, 30 characters each, mapped across three themes - **pain / product / proof** (Directive's pattern; this mapping is search's messaging-pillar equivalent). Each headline must stand alone _and_ in any combination.
- **Description pool**: 4 descriptions, 90 characters each. A keyword too long for a headline goes here.
- **Pinning map**: pin at most 1-2 essential headlines; note in the brief that pinning restricts combination testing sharply, so every pin needs a stated reason (compliance line, mandated brand phrase).
- **Ad Strength note**, verbatim into the brief: Ad Strength is a content-quality signal with no direct effect on Ad Rank; do not add loosely relevant headlines to chase "Excellent".
- Typical test variables - all three are writing, so effort is flat (`offer == headline theme balance == CTA phrasing`) and the ordering is pure value:
  - value: offer > headline theme balance > CTA phrasing
  - CTA rephrasing is the smallest swing in a system that already rotates combinations for you. Test as two ads per group differing by _angle_, not by rephrasing. Re-rank if the offer is fixed by the business - then theme balance is the top rung available, not a fallback.

## 4. Variant: short-form video / UGC

Add to the core:

- **Talking points, not a script**: the beats the creator must hit, in their own words. Beat structure to adapt: cold open (0-2s visual hook) → problem (2-5s) → demo/result → proof overlay → CTA.
- **B-roll list**: the shots needed for edits and future hook swaps.
- **Hook direction per option**: all three layers (SPOKEN / VISUAL / TEXT OVERLAY), still as direction - let the creator pick the option they can deliver naturally.
- **Usage rights**: where the content runs, for how long, in which geographies. An unlimited-perpetual default is a negotiation failure, not a template default.
- **Creator-level disclosure**: the creator's own disclosure ("[Ad]" / "[Paid Partnership]" at caption start) - platform ad labels do not satisfy creator-level FTC disclosure obligations. Note that automated placement resizing can drop a disclosure tag in some formats: verify per placement.
- Round design: brief 3-5 creators on the same objective with _different_ hook directions; treat round one as a learning round, rebrief round two toward the winning direction.
