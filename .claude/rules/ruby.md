---
paths:
  - "**/*.rb"
  - "**/*.rake"
  - "**/*.gemspec"
  - "**/Gemfile"
  - "**/Rakefile"
---

# Ruby

## Blocks

- Use `&:method` when a block only calls one method: `users.map(&:name)`.
- In a one-line block with one parameter, use `_1`, not a name and not `it`: `prices.sum { _1 * rate }`.
- In a block with two or more parameters, or a multi-line `do ... end` block, name the parameters.

## Case expressions

- Use `case/when` to compare a value against plain values like strings, symbols, numbers or classes. Keep `case/in` for pattern matching on the structure of hashes and arrays.
- When an unmatched value is a bug, add an explicit `else` that raises an `ArgumentError` naming the value. Never rely on `case/in` raising `NoMatchingPatternError`. Follow the project's `Style/RaiseArgs` setting for the `raise` form.

## RSpec descriptions

- Start every `context` description with `when`, never `with`, `without` or `if`: `context 'when the databases value is unknown'`.
- Put conditions in the `context`, not in the `it` description.
- Say what the example checks. Name the error an example raises: `it 'raises ArgumentError'`, not `it 'raises'`. Never write "works", "succeeds" or "does something".
- Keep `it` descriptions under 80 characters.
