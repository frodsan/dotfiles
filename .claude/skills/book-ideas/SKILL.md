---
name: book-ideas
description: Summarize a book as its top 25 ideas, ranked so that uncommon and practical ideas come first, and show them in the chat. Use when I ask to summarize a book or extract its ideas.
compatible-with: [claude-code]
tags: [books, reading]
argument-hint: "<title> [by <author>] [path to my highlights or notes]"
disable-model-invocation: true
---

# Book ideas

Show the 25 best ideas of a book in the chat, for me to read. Don't save
anything. I may ask afterwards to save some of them elsewhere.

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

Merge ideas that say the same thing. Two ideas must not make the same
point in different words.

## 4. Write the ideas

Write in plain words, not the book's:

- Write each idea from your understanding. Don't paraphrase the text
  sentence by sentence.
- Use at most three direct quotes. Keep each one under 25 words, in
  quotation marks.
- Don't follow the book's chapter order. Describe an example in one
  sentence if the idea needs it.

Each idea is one numbered item. It starts with a bold sentence that states
the idea, then one or two plain sentences: why it holds, or what to do.
Stay under 40 words per idea.

Follow the writing rules in my global CLAUDE.md.

## 5. Show it

Show the result in the chat with this template. Don't write any file.

```markdown
# <Title>

<Author>, <year>. <One sentence on what the book is about and who it is for.>

## Ideas

1. **<Idea stated as a sentence.>** <Why, or what to do.>
2. ...
```

Number the ideas so that I can pick some by number afterwards.
