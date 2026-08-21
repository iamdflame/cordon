# Demo: script, voiceover, recording, editing

Three minutes hard. Anything past the mark may not be reviewed.

**Published video:** [Watch the pitch and demo](https://youtu.be/RuAPOABnMBY?si=K37HDNN60VXvVm9n)

The whole video is one idea: **a fact derived from three documents is not a
document, so document-level access control has no answer for it.** Everything
else is setup or proof.

There are four parts to this document:

1. [The script](#1-the-script) — exact words, section by section, with timings
2. [ElevenLabs](#2-elevenlabs-voice-and-settings) — which voice, which settings, how to generate
3. [Recording](#3-recording) — what to capture, step by step
4. [Editing](#4-editing) — putting it together, step by step

---

## 0. Before you start

Three minutes hard. The whole video is one arc, and it is not the arc most
security demos run:

> We found a hole. We closed it and proved it. **Then we attacked our own
> proof, found it did not cover what it looked like it covered, and published
> the price of fixing that.**

Almost nobody does the third beat. It is the reason to watch.

Open these, each in its own window:

| Window | What | Why |
|---|---|---|
| A | Terminal, project folder, **big font** | the audits. This is most of the video. |
| B | [cordon-graph.vercel.app/console](https://cordon-graph.vercel.app/console) | the console — wait for the green **Live** badge |
| C | [docs/INFERENCE.md](https://github.com/iamdflame/cordon/blob/main/docs/INFERENCE.md) | for the phantom-denial table |
| D | Browser, **private/incognito**, logged out of GitHub | for the 404 |

Get the machine ready first — **one command, then leave it alone for about
fifteen minutes**:

```bash
npm run demo:prep
```

It starts HydraDB, runs every audit once so they are warm, starts the API, and
prints a checklist. Cold, `npm run audit:inference` spends two minutes drawing a
progress bar before it prints anything; warm, it answers in seconds. Recording
cold is the single most common way this goes wrong.

Then, in a second terminal, start the console and leave it running:

```bash
cd web && npm run dev        # http://localhost:5173
```

Full step-by-step recording instructions — OBS setup, screen prep, and exactly
what to type and click for each of the eight shots — are in
[section 3](#3-recording).

---

## 1. The script

Total: about 2 minutes 50 of speech. Timings are where each block *starts*.

**The turn must land by 0:40.** Everything before it is setup, and setup is not
what wins.

Copy each block into ElevenLabs **separately** — one generation per block, so a
bad take costs you one block and not three minutes.

### Block 1 — 0:00 to 0:18 · the hole

*Film: the console, one derived fact expanded showing its derivation.*

> A fact inferred from three documents is not a document. It has no access
> control of its own.
>
> So document-level filtering — which is what every enterprise AI assistant
> ships today — has no answer for it. Move a company onto a knowledge graph and
> you create an access-control problem that did not exist before. The graph gets
> unsafe exactly when it gets useful.

### Block 2 — 0:18 to 0:38 · we closed it, and it was free

*Film: the console — ask as one person, switch to another, watch facts redact.*

> Cordon's rule: a derived fact requires every space it was built from. Union on
> the requirement side is intersection on the audience side.
>
> Zero leaks across eighteen thousand trials. Proved by induction, checked over
> three hundred and thirty thousand pairs. And identical answer quality to the
> baseline — zero point zero nine nine on both.
>
> Eliminating every leak cost us nothing.

### Block 3 — 0:38 to 1:20 · **the turn. This is the video.**

*Film: `npm run audit:inference`. Let the phantom table land before you speak.*

> And then we asked the question a security reviewer asks next. When Cordon
> refuses — does the asker end up not knowing?
>
> Those are different questions. Our proof is about **provenance**: what the
> system hands over. A reviewer cares about **content**: what you end up
> knowing.
>
> Our derivation rules ship in this repository under Apache 2.0. An attacker
> doesn't reverse-engineer them — they clone them. So we ran *our own rules*
> over the facts we had disclosed.
>
> Twelve hundred and eight refusals were rebuilt in one step. They satisfy our
> theorem perfectly and protect nothing.
>
> **A refusal the asker can undo is not a refusal.** It costs them an answer,
> costs the operator a ticket, and shows up on a dashboard as protection. It is
> a lie the system tells its owner.

### Block 4 — 1:20 to 1:50 · the price, and why it is a cut

*Film: scroll the depth table — depth 1 tight, depths 2 and 3 phantom.*

> Depth one is tight — zero phantoms in ninety-six thousand. Depths two and
> three are not, and the cause is a fix we were *right* to make: we raised a
> requirement after traversal caught it understated. Correct for provenance.
> Worth nothing for content.
>
> You cannot fix that by demanding more. The asker isn't at the front door —
> they're rebuilding the claim from evidence they're entitled to. The only
> defence is a **minimum cut**: withhold things they have every right to read.
>
> Thirty-seven point seven percent of an asker's legitimate evidence. That is
> unshippable, and we published it anyway.

### Block 5 — 1:50 to 2:25 · the number that makes it shippable

*Film: `npm run audit:planner`, hold on the sweep table.*

> Unless you stop deciding one fact at a time.
>
> That thirty-seven percent prices safety against an adversary who has
> aggregated everything they're entitled to. Someone reading one answer is not
> that adversary.
>
> So we decide over the **set**: the largest subset of your candidates whose
> closure cannot rebuild anything the asker was refused.
>
> At production retrieval depth — top twenty — the constraint never fired once
> across twelve hundred queries. It is free. It first bites at fifty. That is a
> measured phase transition, not a claim.
>
> And because ten safe answers can jointly leak, there's a **ledger**. Safety
> stops being yes-or-no and becomes a budget: a hundred percent at query one,
> eighty at query thirty. You keep getting answers until your own history starts
> to determine something you were refused.

### Block 6 — 2:25 to 2:45 · the credibility beat

*Film: `npm run audit:llm` output, then the HydraDB notes page.*

> Every leak number we publish says "this is a lower bound, because our
> adversary runs our rules." That's unfalsifiable as written, so we tested it —
> we pointed a language model at the denials we'd called protected.
>
> It recovered nothing. And we can say *why*, with a number: zero of sixteen
> thousand documents mention a product area other than their own. The channel
> isn't there. That measures the corpus, not our defence — so the caveat stands
> as untested, not disproved.
>
> This runs on HydraDB, over the open-source engine. Probing it, we found
> queries silently truncating at one thousand and twenty-four rows with no
> error — a quarter of an authorisation table disappearing quietly. Our client
> fails closed. We filed it upstream.

### Block 7 — 2:45 to 3:00 · the close

*Film: the README's two-property table.*

> Document filtering doesn't have a bug. It has a ceiling, and the ceiling is
> the first inference.
>
> Provenance confidentiality is free. Content confidentiality is not — and
> anyone telling you otherwise has not measured it.
>
> Every number here regenerates from one command. Including the ones that make
> us look bad.

---

### Why this arc wins

Most submissions show a thing working. The three beats almost nobody has:

| beat | what it signals |
|---|---|
| **We attacked our own proof** | you understand the difference between a theorem and a guarantee |
| **We published a number that says our fix is unshippable** | you are not selling |
| **We tested our own hedge, and reported a null** | you know what evidence is |

If you have to cut for time, cut Block 6 first and Block 2 second. **Never cut
Block 3** — it is the reason the video exists.

---

## 2. ElevenLabs: voice and settings

### The voice

Use **George**.

Find him: ElevenLabs → **Voices** → **Voice Library** → search `George`. Click
**Add to my voices**. He is one of the ElevenLabs default library voices, so he
is available on the free tier.

- Voice ID: `JBFqnCBsd6RMkjVDRZzb`
- British, mid-to-low register, warm, unhurried

Why George: this script is a finding, not a pitch. George reads measured and
slightly documentary, which makes a claim sound examined. The bright American
"startup demo" voices (Adam, Josh, Antoni) make the same sentences sound like
marketing, and marketing is exactly the wrong register for a security result.

**Backups**, in order, if you dislike George:

| Voice | ID | Sounds like |
|---|---|---|
| Daniel | `onwK4e9ZLuTAKqWW03F9` | British news presenter, more formal |
| Brian | `nPczCjzI2devNBz1zQrb` | American, deep, calm narration |
| Rachel | `21m00Tcm4TlvDq8ikWAM` | American, neutral, very safe |

Do **not** use a whispery or "conversational" voice. Do not use two voices.

### The model

Choose **Eleven Multilingual v2** in the model dropdown.

It is slower to generate than the Turbo and Flash models and it is noticeably
steadier across a long paragraph, which is what you want. You are generating
three minutes of audio once, not streaming it live — spend the seconds.

(If you see **Eleven v3** and want to try it, it is fine, but it responds to
emotion tags like `[serious]` and will occasionally do something surprising. For
a submission you cannot re-record, take the predictable one.)

### The settings

In the sliders panel on the right:

| Setting | Value | Why |
|---|---|---|
| **Stability** | **50%** | Below about forty it starts acting; above about sixty it goes flat and robotic. Fifty is a person reading carefully. |
| **Similarity** | **80%** | High enough to stay recognisably George line to line. |
| **Style exaggeration** | **0%** | Leave this at zero. Anything above zero invents emotion the script did not ask for and makes the voice drift between takes. This is the setting people get wrong. |
| **Speaker boost** | **ON** | Slight clarity gain, no downside. |
| **Speed** | **1.0** | Do not speed up here. If you need to save time, cut words, not tempo. |

### Generating

1. Paste **Block 1 only** into the text box. Generate.
2. Listen to it once, all the way through.
3. If a word is mispronounced or a pause is wrong, fix the **text**, not the
   sliders — see the tricks below — and generate again.
4. Download it. Name it `01-hole.mp3`.
5. Repeat for blocks 2 through 6: `02-leak.mp3`, `03-numbers.mp3`,
   `04-arbitrary.mp3`, `05-github.mp3`, `06-graph.mp3`.

Put all six in one folder called `voiceover/`.

### Text tricks, if a line comes out wrong

| Problem | Fix |
|---|---|
| Rushes through a number | Write it as words: `seventeen point four percent` |
| No pause where you want one | Add `...` (three dots) — it is the most reliable pause |
| Pause too long | Replace `...` with a comma, or start a new paragraph |
| Says "N-P-M" oddly | Write it how it sounds: `en pee em` |
| Says "ACL" as a word | Write `A C L` with spaces |
| "404" read as "four hundred and four" | Write `four oh four` |
| Emphasis on the wrong word | Put the word you want stressed in *italics* — v3 only — or reword so it lands at the end of the clause |

Do not add sound effects, music, or an intro sting. Silence between sections
reads as confidence.

---

## 3. Recording

**Read this once before you touch anything.** The whole section is written to be
followed top to bottom without deciding anything.

You are recording **pictures only** — no microphone, no talking. The voice comes
from ElevenLabs (section 2) and gets laid on top in editing. Trying to talk and
click at the same time is much harder and sounds worse.

---

### Step 1 — Get the machine ready (do this once, ~15 minutes, unattended)

Open a terminal in the project folder and run:

```bash
npm run demo:prep
```

This installs nothing and changes nothing in the repo. It:

- checks Docker and Node are present
- fetches the corpus if it is missing
- starts HydraDB if it is not running
- **runs all four audits once** so they are warm
- starts the API on `localhost:8787`
- prints a checklist when it is done

**Why this matters more than anything else in this document.** Each audit builds
the graph before it prints anything. Cold, `npm run audit:inference` spends about
two minutes showing you a progress bar and *then* prints the numbers. Warm, it
prints in seconds. If you record cold, every shot is mostly progress bar.

Wait for it to say **"Everything is warm."** If it says anything failed, fix that
before continuing — it will tell you which command to run by hand.

Then start the console in a **second terminal** and leave it running:

```bash
cd web && npm run dev
```

That serves the console at <http://localhost:5173>.

---

### Step 2 — Install and configure OBS (once, ~10 minutes)

```bash
sudo apt install obs-studio      # Ubuntu/Debian
```

Or download from <https://obsproject.com>. It is free.

**Open OBS.** If a setup wizard appears, choose **Optimise just for recording**.

Then click **Settings** (bottom right) and set exactly these:

| Tab | Setting | Value |
|---|---|---|
| **Video** | Base resolution | `1920x1080` |
| **Video** | Output resolution | `1920x1080` |
| **Video** | FPS | `30` |
| **Output** | Output mode | `Simple` |
| **Output** | Recording quality | `High Quality, Medium File Size` |
| **Output** | Recording format | `MP4` |
| **Output** | Encoder | `Software (x264)` |
| **Audio** | Mic/Auxiliary Audio | **`Disabled`** |

Click **OK**.

> Setting the mic to Disabled is not optional. If you leave it on you will
> record your room, and you will not notice until editing.

**Now tell OBS what to film.** In the **Sources** box at the bottom, click the
**+** button:

1. Choose **Screen Capture (XSHM)** on Linux, or **Display Capture** on
   Mac/Windows.
2. Give it any name, click **OK**.
3. Pick your monitor from the dropdown, click **OK**.

You should now see your own screen inside the OBS preview. If you see infinite
nested screens, that is normal — it happens because OBS is on the screen it is
filming. Move OBS to a second monitor, or just minimise it before each take.

---

### Step 3 — Make the screen look good (5 minutes, do it properly)

This is the difference between "a student project" and "a product". Judges
notice.

1. **Close everything you are not filming.** Slack, email, file manager, music,
   every browser tab except the console. One notification popup ruins a take.
2. **Turn on Do Not Disturb.** Settings → Notifications → Do Not Disturb.
3. **In the browser:** hide the bookmarks bar with `Ctrl+Shift+B`. Close every
   tab except the console.
4. **In the terminal — this one matters most.** Press `Ctrl+Shift++` (plus)
   **six times**. The text should look uncomfortably large to you. It will look
   correct in a 1080p video played in a small window.
5. **Make the terminal window tall** — drag it to fill the screen vertically.
   The audits print 30–40 lines and you want them on one screen without
   scrolling.
6. **Use a dark terminal theme** and a plain dark desktop wallpaper.

Quick check: stand up, take two steps back from your monitor, and look at the
terminal. If you cannot comfortably read it, go bigger.

---

### Step 4 — Learn the recording rhythm (2 minutes)

Every single shot follows the same five beats. Do not vary it.

1. Click **Start Recording** in OBS.
2. **Wait 2 seconds doing absolutely nothing.** Hands off the keyboard.
3. Do the actions for that shot.
4. **Wait 2 seconds doing absolutely nothing** after the last thing happens.
5. Click **Stop Recording**.

Those two seconds of stillness at each end are what let you cut cleanly in
editing. Without them every cut lands mid-motion and looks like a glitch.

**Record each shot as its own file.** Eight short clips are far easier to edit
than one long take, and if you fumble shot 5 you only redo shot 5.

OBS saves to `~/Videos` by default. **Rename each file the moment you stop
recording** — you will not remember which was which ten minutes later.

**Do a full dry run of every shot before you record anything.** Type the
commands, click the clicks, with OBS closed. You want to be bored by the time
you press record.

---

### Step 5 — Take the eight shots

Each shot below gives you: which window, what to type, what you should see on
screen, and how long it needs to be.

---

#### Shot 1 → `shot1-console-derivation.mp4` · ~25 seconds · covers Block 1

**Window:** the console at <http://localhost:5173>, **Ask** tab.

**Do exactly this:**

1. In the **left panel**, click **`@cordon-demo/billing`**.
2. Click the question box and type exactly:

   ```
   priya raman
   ```

3. Press **Ask**. Wait for the answer to render.
4. You will get **7 readable facts and 10 struck-out ones.** Scroll the results
   until you find the struck-out fact that begins:

   > *Priya Raman (mentioned) is active across 5 product areas…*

5. **Click that fact.** The permission trace opens on the right.
6. **Hold still for five seconds.** Do not scroll, do not move the mouse.

**You should see** in the right panel:

| | |
|---|---|
| required (by traversal) | **5** spaces |
| the asker holds | 5 spaces, 3 of which are the wrong ones |
| missing | `cordon-demo-fornax`, `cordon-demo-borealis`, `cordon-demo-cygnus` |
| rests on | **5 supports, all of them other facts** — no source at all |

**Why this shot is first.** That fact is not in any document. No file contains
the sentence "Priya Raman is active across 5 product areas" — it was derived,
and it needs all five of those areas to read. "Rests on 5 facts, zero sources"
is the entire argument in one panel.

---

#### Shot 2 → `shot2-console-switch.mp4` · ~25 seconds · covers Block 2

**Window:** the console, same **Ask** tab. Same question throughout — **do not
retype it between askers.**

**Do exactly this:**

1. In the left panel, click **`@cordon-demo/leadership`**.
2. Type exactly:

   ```
   priya raman
   ```

3. Press **Ask**. You get **8 readable facts, nothing struck out.**
4. **Pause for three seconds** so the clean result registers on camera.
5. Now, in the left panel, click **`Anonymous (the internet)`**.
6. Press **Ask** again — the same question is still in the box.
7. **Hold for five seconds** on the result.

**You should see:**

| asker | readable | withheld |
|---|---|---|
| `@cordon-demo/leadership` | **8** | **0** |
| `Anonymous (the internet)` | **4** | **10** |

Half the answer disappears, and the derived fact from shot 1 is among what goes.

**Do this slowly.** It is the "watch the boundary move" shot, and it is worth
nothing if it happens faster than a viewer can follow. Leave a real beat between
the two asks.

> **If you want a second take with a different pair:** `@cordon-demo/billing`
> (7 readable / 10 withheld) against `@cordon-demo/sdk` (4 / 10) works on the
> same question. The leadership → anonymous version is more dramatic, because
> "Anonymous (the internet)" needs no explaining.

---

#### Shot 3 → `shot3-inference.mp4` · ~40 seconds · covers Block 3 · **THE MONEY SHOT**

**Window:** terminal A, big font.

**Type:**
```bash
npm run audit:inference
```

**Do this:** press Enter and then **do not touch anything**. Let it run all the
way to the end. Hold for a full three seconds after it stops printing.

**You should see** this land on screen:

```
denied (claim, principal) pairs          120,206
phantom - rebuilt from permitted           1,208   1.0%
effective - genuinely withheld           118,998  99.0%
```

**Do not scroll away.** This is the single frame the entire video is built
around. If any shot is going to be re-recorded until it is perfect, it is this
one.

---

#### Shot 4 → `shot4-depth.mp4` · ~20 seconds · covers Block 4

**Window:** terminal A, immediately after shot 3 — **do not clear the screen.**

**Do this:**
1. Scroll up slightly until all three depth rows are visible at once.
2. Hold for four seconds.
3. Scroll down slowly to the line showing `37.7%`.
4. Hold for three seconds.

**You should see:**

```
depth 1   96,206      0    0.0%   tight
depth 2   12,000    804    6.7%   phantom
depth 3   12,000    404    3.4%   phantom
```

**Why this shot:** one green `tight` row against two red `phantom` rows. The
colour contrast does the explaining for you.

---

#### Shot 5 → `shot5-planner.mp4` · ~40 seconds · covers Block 5

**Window:** terminal A. Clear it first with `clear`.

**Type:**
```bash
npm run audit:planner
```

**Do this:** let it run to the end untouched. Then scroll to the sweep table and
hold for five seconds. Then scroll to the session curve and hold three seconds.

**You should see** the sweep:

```
top-k  queries   bit   prevented  retained
   10      240     0           0    100.0%
   20      240     0           0    100.0%
   50      240    12          60     97.6%
  200      240   192         504     88.8%
```

**If you only have time to hold one thing, hold the sweep.** The jump from `0`
to `12` at k=50 is the phase transition the voiceover describes.

---

#### Shot 6 → `shot6-llm.mp4` · ~20 seconds · covers Block 6

**Window:** terminal A. Clear it first.

**Type:**
```bash
npm run audit:llm
```

**Do this:** it replays from a cache so it is quick. Hold on the end for four
seconds.

**You should see** two things — the corpus measurement:

```
whose text names a FOREIGN area              0
```

and below it the amber **Inconclusive** verdict.

**Why this shot:** you are filming a null result you refused to spin. That is
the point of it.

---

#### Shot 7 → `shot7-policy.mp4` · ~25 seconds · covers Block 4 or 7 · **strong closer**

**Window:** terminal A. Clear it first. The API must be running — `demo:prep`
started it; check with `curl -s localhost:8787/api/health`.

**Type** (one line, paste it):
```bash
curl -s localhost:8787/v1/policy/preview -H 'content-type: application/json' \
  -d '{"grants":[{"subject":"team:billing","space":"cordon-demo-cygnus"}],
       "includeInference":true}' | jq .impact
```

**Do this:** press Enter, let the JSON print, hold for five seconds.

**You should see:**

```json
{
  "documentsGained": 6,
  "derivedGained": 4,
  "unlockedByCombination": 4,
  "newlyInferable": 8
}
```

**Why this shot:** it takes 8.7 milliseconds and it is the one that makes this
look like something an enterprise would buy rather than a benchmark. One grant
approved 6 documents — and 4 derived facts nobody was shown.

> If `jq` is not installed: `sudo apt install jq`. Without it the JSON prints on
> one unreadable line.

---

#### Shot 8 → `shot8-budget.mp4` · ~25 seconds · covers Block 5 or 7

**Window:** the console.

**Do exactly this:**

1. Make sure **`@cordon-demo/billing`** is still the selected asker and that you
   have asked at least three questions as them — the budget is empty otherwise
   and the shot shows zeroes. If in doubt, ask `priya raman`, then `billing`,
   then `handbook` before you start recording.
2. Click the **Disclosure budget** tab in the top nav.
3. **Hold five seconds.**
4. Click the **Risk surface** tab.
5. **Hold five seconds.**
6. Scroll the "Most tightly held" table down slowly by about one screen, then
   stop.

**You should see** on Disclosure budget: questions asked, facts disclosed, and
**claims their history determines** — the number no document-level audit log can
produce.

And on Risk surface: `derived facts`, `visible to nobody`, the audience-by-depth
meters, then a table of derived facts ranked by how few people may read them —
several of them requiring 5+ spaces to read a claim about 2.

**Do not rush either.** These two views are what make the project read as a
product rather than a benchmark harness, and they are the last thing on screen.

---

### Step 6 — Check what you recorded before you move on

Open each of the eight files and confirm:

- [ ] the terminal text is **readable at a glance**, not squinting
- [ ] there are ~2 still seconds at the start and end
- [ ] no notification popped up mid-shot
- [ ] no other windows or personal information are visible
- [ ] shot 3 clearly shows `phantom - rebuilt from permitted   1,208`
- [ ] shot 5 clearly shows the k=20 and k=50 rows
- [ ] every file is renamed to the names above

Re-record anything that fails a check. It is much cheaper now than in editing.

---

## 4. Editing

### Install Kdenlive

```bash
sudo apt install kdenlive
```

Free, on Linux, and simpler than DaVinci Resolve for a job this small.

### Set the project up

1. Open Kdenlive → **Project → Project Settings**.
2. Set profile to **HD 1080p 30 fps**. Click OK.
3. **Project → Add Clip or Folder**. Select all six `shot*.mp4` files **and**
   all six `voiceover/*.mp3` files. They appear in the Project Bin (top left).

You now have three rows at the bottom of the screen — these are **tracks**. `V1`
and `V2` are video, `A1` and `A2` are audio. You will use `V1` for pictures and
`A1` for voice.

### Lay the voice down first

This is the trick that makes the whole thing easy: **the audio is the skeleton.**
Build it first, then hang pictures on it.

1. Drag `01-hole.mp3` from the bin onto track `A1`, right at the very start.
2. Drag `02-leak.mp3` onto `A1` immediately after it. It will snap to the end of
   the first clip. Let it snap.
3. Do the same for `03`, `04`, `05`, `06`, in order.

Play it (`Space`). You should hear the whole narration, about two minutes fifty.
If it is over three minutes, go back and cut words from the script — the longest
blocks are 2 and 6.

**Add a small gap between blocks.** Click block 2 on the timeline and drag it
half a second to the right. Do the same for 3, 4, 5, 6, each shifting slightly
later. Those half-second silences are what make it sound composed instead of
breathless. Watch the total stays under 3:00.

### Hang the pictures on it

Now look at where each audio block starts and ends, and put the matching shot
above it on `V1`.

1. Drag `shot1-console-derivation.mp4` onto `V1` at time zero.
2. It is probably longer than block 1's audio. Hover over its **right edge**
   until the cursor becomes an arrow, then drag left until the clip ends where
   the audio block ends.
3. Drag `shot2-console-switch.mp4` onto `V1` immediately after. Trim its right
   edge to end where block 2's audio ends.
4. Keep going, one shot per block:

| block | shot |
|---|---|
| 1 · the hole | `shot1-console-derivation` |
| 2 · we closed it | `shot2-console-switch` |
| **3 · the turn** | **`shot3-inference`** |
| 4 · the price | `shot4-depth` |
| 5 · shippable | `shot5-planner`, then `shot8-budget` for the ledger line |
| 6 · credibility | `shot6-llm` |
| 7 · the close | `shot7-policy`, then `shot8-budget` (Risk surface half) |

**Block 3 gets the most screen time of any block.** If you are short of footage
anywhere, steal it from blocks 1 and 2, never from 3.

Rules of thumb:

- **Never let video run out before audio.** A black screen mid-sentence looks
  broken. If a shot is too short, trim the *left* edge off a later shot and
  stretch, or re-record.
- **Cut on the sentence, not in the middle of one.** Move a cut a few frames
  either way so it lands in a gap between words.
- If a shot has dead time at the start, cut it: put the playhead where the
  action begins, press `Shift+R` to razor, click the dead piece, press `Delete`,
  then drag the remainder left to close the gap.

### Mute the screen recordings

The shot files may carry silent or hissy audio. Find each video clip's audio on
`A2`, right-click, and choose **Delete** — or click the little speaker icon on
the `A2` track head to mute the whole track.

### The one caption you need

At the very start, over shot 1, put a title card:

1. **Project → Add Title Clip**.
2. Type:

   ```
   Cordon
   permission-propagating enterprise knowledge graph
   ```

3. White text, plain sans-serif, big. Black background.
4. Click OK, drag it onto `V2` at time zero, and trim it to about three seconds.
5. Click the clip, open the **Effects** panel, search `Fade`, and drag **Fade
   from black** and **Fade to black** onto it.

Add **one** more caption, over shot 5, when the 404 appears:

```
GitHub. Not our access control. Theirs.
```

Two captions. That is the budget. Every extra one costs you a second you need.

### Export

1. Click **Render** in the toolbar.
2. Choose **MP4 - H.264/AAC**.
3. Resolution `1920x1080`, and set **Video bitrate** to about `8000 kb/s`.
4. Pick an output filename. Click **Render to File**.
5. Wait. It will take a few minutes.

### Check it before you submit

Watch the exported file all the way through, once, with the sound on.

- [ ] Under 3:00
- [ ] No black frames
- [ ] The voice never talks over a shot that has not appeared yet
- [ ] The 404 is legible at full screen
- [ ] The leakage table is legible at full screen
- [ ] No notification, no personal file name, no other browser tab visible

If a judge cannot read a number, that number does not exist.

---

## Notes for questions afterwards

- **What breaks without HydraDB**: admissibility is a variable-length traversal
  and the requirement is discovered rather than stored. Without path traversal
  there is no product, only a list of documents.
- **On absolute F1**: `0.099` against a `0.065` lexical baseline, on
  deliberately conventional BM25 retrieval. The contribution is the disclosure
  boundary, not the ranker — and both gated systems beat the ungated graph.
- **What is not closed**: the compositional channel. Cordon closes explicit
  derivation, and says nothing about whether several individually-permitted
  answers jointly reconstruct a denied one. We found it and did not measure it.
