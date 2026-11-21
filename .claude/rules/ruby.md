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
