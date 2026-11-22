---
name: book-ideas
description: Summarize a book as its top 25 ideas, ranked so that uncommon and practical ideas come first, and save the note to my TIL repo. Use when I ask to summarize a book or extract its ideas.
compatible-with: [claude-code]
tags: [books, til, writing]
argument-hint: "<title> [by <author>] [path to my highlights or notes]"
disable-model-invocation: true
---

# Book ideas

Write the 25 best ideas of a book as one note in my TIL repo
(`~/Code/til`). The note is for me to reread later, and it is public.

## 1. Find the source

The input is a book title, an optional author and an optional file.

- If I give a file (highlights, notes, an excerpt), it is the main source.
  Use what you know about the book only to fill gaps.
- Without a file, use what you know about the book. If you can't name its
  author, its year and at least five of its specific arguments, stop and
  tell me. Ask for my highlights instead of guessing.
- If two books share the title, ask which one.
- Never invent a claim, a study, a number or a quote. If you are not sure
  the book says something, leave it out.

## 2. Collect candidates

List 40 to 60 candidate ideas before you choose. An idea is a claim, a
technique, a rule of thumb, a surprising fact or a distinction the book
makes. Chapter titles and themes are not ideas.

## 3. Rank and keep 25

Score each candidate on two questions:

- **Uncommon.** Would a well-read engineer already know it? Drop ideas
  that a blog post headline already states ("habits compound", "focus
  matters", "sleep is important").
- **Practical.** Can I act on it, or does it change a decision I make?

Put ideas that score high on both first, then ideas that score high on
either one. Drop the rest. Keep exactly 25, or fewer if the book has fewer
good ones. Don't pad.

Merge ideas that say the same thing. Two bullets must not make the same
point in different words.

## 4. Write the note

Write in my own voice and words, not the book's:

- Write each idea from your understanding. Don't paraphrase the text
  sentence by sentence.
- Use at most three direct quotes in the whole note. Keep each one under
  25 words, in quotation marks, with no page numbers unless I gave them.
- Don't follow the book's chapter order. Don't copy its figures, tables or
  examples. Describe an example in one sentence if the idea needs it.

Each idea is one bullet. It starts with a bold sentence that states the
idea, then one or two plain sentences: why it holds, or what to do. Stay
under 40 words per bullet.

Follow the writing rules in my global CLAUDE.md.

## 5. Save it

Save the note as `books/<title-slug>.md`, for example
`books/the-mythical-man-month.md`, using this template:

```markdown
# <Title>

<Author>, <year>. <One sentence on what the book is about and who it is for.>

## Ideas

- **<Idea stated as a sentence.>** <Why, or what to do.>
- ...

## My take

<Two or three sentences: what I'd keep, what I disagree with, who should
read it. Leave this as a TODO for me unless I told you my opinion.>
```

Add the note to `README.md` under a `## Books` heading, as
`- [<Title>](books/<title-slug>.md), <Author>`. Keep that list sorted by
title. Create the heading if it doesn't exist.

## 6. Show, then stop

Show me the note and the README change. Don't commit or push until I say
so. When I do, commit with a message like `Add ideas from <Title>`.
