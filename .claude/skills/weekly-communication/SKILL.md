---
name: weekly-communication
description: >-
  The weekly communication run for SilenceWatch: find the week's new questions
  from people whose Java scheduled jobs stop (Spring @Scheduled, Quartz), draft a
  short reply for each that the maintainer rewrites and posts, then write
  one blog post in English and French, have it reviewed by the
  communication-reviewer agent, and publish it. Use it when the Sunday scheduled
  task fires, or whenever the user asks for the weekly watch, the questions
  digest, or the week's blog post.
---

# The weekly communication run

Two deliverables, in this order: a **digest of questions** for the maintainer, and
**one published blog post**. Report both at the end, in French, to the user.

## Part 1: the questions digest

### Find them

Stack Overflow is read through its public API (the site itself cannot be fetched
from here; Reddit cannot either). Last seven days, by tag, newest first:

```bash
since=$(( $(date +%s) - 7*86400 ))
for tag in spring-scheduled quartz-scheduler spring-boot spring; do
  curl -s --compressed "https://api.stackexchange.com/2.3/questions?order=desc&sort=creation&tagged=$tag&fromdate=$since&site=stackoverflow&pagesize=50&filter=withbody"
done
```

Keep only questions about a scheduled job or a scheduler that **stops, never runs,
runs late, runs twice, or must be monitored or alerted on** (`@Scheduled`,
`TaskScheduler`, Quartz triggers and misfires, ShedLock, a cron in a Spring app).
Drop the rest, and drop questions that are closed or already have an accepted answer
that covers detection. Read each kept question's body before drafting.

Also look for open GitHub Discussions on the same subject if the GitHub tools allow a
search; skip it silently if not.

### Draft the replies

For each question, at most ten, a reply of **two or three sentences**:

1. the probable cause, specific to what the asker wrote;
2. the fix, or how to confirm (`jstack <pid>`, a timeout, `spring.task.scheduling.pool.size`);
3. one line of disclosure with a link, only when SilenceWatch is relevant:
   `Disclosure: I build SilenceWatch, which alerts when jobs stop: <link>`.

Links: a blog post under `https://silencewatch.com/blog/…/` that matches the problem,
otherwise `https://silencewatch.com/spring-boot/`. Check that the link answers 200.

Stack Overflow forbids answers written by AI. The drafts are a base the maintainer
**rewrites in their own words** before posting, and the digest says so at the top.
**Never post a reply anywhere yourself**, on any site.

## Part 2: the blog post

### Choose the subject

List `site/src/content/docs/blog/`: never repeat a post. Prefer a problem that came
up in this week's questions; otherwise a real, searchable failure of scheduled jobs
(Spring, Quartz, cron, systemd timers, Kubernetes CronJobs, backups, a job running
twice across instances…). It must be something the repository and the documentation
let you write about truthfully.

### Write it

Two files with the same slug and the same `date` (today, YYYY-MM-DD):

- `site/src/content/docs/blog/<slug>.mdx`
- `site/src/content/docs/fr/blog/<slug>.mdx`

Copy the shape of an existing post such as `blog/spring-scheduled-job-stops.mdx`:
front matter (`title` of 50 characters at most, `description` of 70 to 165,
`template: splash`, `date`), the imports, an opening `<p class="splash-lede">`, `##`
sections, the `sw-cta` buttons, a `<Faq … />` and a "See also" list. Around 900 to
1,500 words. The reader can solve the problem without SilenceWatch; SilenceWatch
comes in once or twice where it helps. No invented figures.

### Review it

Run the **communication-reviewer** agent with both paths. Agents are loaded when a
session starts: if that type is not offered, run a general-purpose agent and tell it
to follow `.claude/agents/communication-reviewer.md` to the letter. Apply every required
change, then run it again. Publish only on a `PASS`. After three rounds without a
pass, do not publish: report the remaining required changes to the user instead.

### Publish it

1. Fetch, and branch from the current `origin/dev`.
2. From `site/`: `pnpm run build && node scripts/check-seo.mjs`, both passing.
3. Commit with `git commit -s` and the repository's attribution lines, push, and open
   a pull request against `dev` that follows `.github/pull_request_template.md`.
4. When every check is green, squash-merge it.
5. Promote to `main` with a pull request `dev → main`, merged with a **merge commit**,
   but **only if** `origin/main..origin/dev` contains nothing but this post. If `dev`
   holds other unreleased work, stop after step 4 and tell the user: promoting would
   ship that work too, and that is their decision.
6. Once the site has deployed, check that `https://silencewatch.com/blog/<slug>/`
   answers 200.

## The report

In French, short:

- the digest: for each question, its title, its link and the draft reply, in a plain
  text file the user can copy from (send it with the file tool);
- the post: its title, its address, and the reviewer's verdict;
- anything that did not go as planned.
