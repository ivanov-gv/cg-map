# Decision records

- A PR that makes or implements an important decision adds one new record from [the template](TEMPLATE.md), numbered
  next after the last on main. Important means someone later would ask why it is this way: architecture, process,
  ownership, or a trade-off with a lasting cost.
- A PR with no such decision adds no record and says so in its description, under Decisions.
- `make check-docs` fails on a gap, a repeated number, or a title that disagrees with the file name. If another PR took
  your number first, take the next one.
- Preserve accepted ADRs as historical records; do not rewrite their original decision to match later architecture.
- Add a new record when a decision changes materially and link it to current guidance.
- Keep the implemented state in [system architecture](../system-architecture/README.md), not in an ADR alone.

## When a rule seems to block a design

1. Restate the rule's intent and the failure it prevents, not only its wording.
2. Distrust workarounds that satisfy the letter but break the intent.
3. Verify the constraint with an experiment before designing around it; an inference from docs is not enough.
4. Find the platform mechanism that serves the intent.
5. Make the exception as narrow as possible, and enforce it in code and tests.
6. Record the rule, the constraint, the reasoning, and the exact scope in a dated ADR outcome note. Change neither the
   rule nor accepted ADR text.
7. Bring the reasoning to the rule's owner, who approves the exception.

Example ([ADR 0017](0017-ci-cd-model.md), [#168](https://github.com/ivanov-gv/cg-map/issues/168),
[#237](https://github.com/ivanov-gv/cg-map/issues/237)):

- CD polling for CI's build obeyed the rule in wording but coupled the two pipelines and wasted runner time.
- The `page_build` webhook probe proved the hoped-for event never fires.
- `workflow_run` became CD's acknowledgement, limited to successful push builds on main only.
- The owner called it "an exception that follows the rule".
