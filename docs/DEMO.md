# Demo: script, voiceover, recording, editing

Three minutes hard. Anything past the mark may not be reviewed.

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

Get the app running and leave it running:

```bash
npm run hydra:up
npm run api            # wait until it prints "cordon ready"
cd web && npm run dev  # leave this running
```

Open these and leave them open, each in its own window:

| Window | What | Why |
|---|---|---|
| A | Firefox/Chrome at `localhost:5173` | the console |
| B | Terminal, in the project folder | for running `npm run demo:leak` |
| C | Firefox/Chrome at `docs/RESULTS.md` on GitHub | the numbers |
| D | Firefox/Chrome, **private/incognito window** | for the 404 |

Window D matters. It must be a **private window** and you must be **logged out
of GitHub in it**. That is what makes the 404 real rather than staged.

Do a dry run of every click before you record anything. You want to be bored by
the time you hit record.

---

## 1. The script

Total: 2 minutes 55 seconds of speech. Timings are where each line *starts*.

Copy each block into ElevenLabs **separately** — one generation per block. That
way if block 4 comes out wrong you regenerate block 4, not the whole thing.

Numbers are spelled out on purpose. Text-to-speech reads "17.4%" as
"seventeen point four percent" only if it feels like it; spelled out, it always
does.

### Block 1 — 0:00 to 0:22 · the hole

> Every enterprise AI assistant filters what it retrieves by document
> permissions. Which is correct... right up until it infers something.
>
> A fact derived from three documents is not a document. It has no access
> control list of its own. So a knowledge graph built over a company's data
> quietly launders restricted material into an unrestricted form — and no
> file-access audit will ever show it, because what leaked was never a file.

### Block 2 — 0:22 to 1:05 · the leak, live

> Same question. Two colleagues, both VPs of Engineering.
>
> The answer is a derived fact: Bob Brown works across four product areas. No
> single document says that. It was assembled from four.
>
> David can read all four spaces, so he gets the answer. Correctly.
>
> Bob can read two of them. Document-level filtering checks the one space the
> fact is filed under, sees that Bob has it, and hands the fact over. That is
> the leak.
>
> Cordon walks the derivation, finds the two spaces underneath that Bob does not
> hold, and withholds — and tells him exactly which two he is missing.

### Block 3 — 1:05 to 1:35 · the numbers

> Fifteen hundred questions from Salesforce's enterprise benchmark. Twelve
> different principals. Eighteen thousand trials per system. Same retrieval,
> same answer assembly — the only difference is what each one is willing to
> disclose.
>
> Document-level filtering leaks on seventeen point four percent of trials.
> Cordon: zero. At identical answer quality, and zero false denials.
>
> And this row is the whole argument. At depth zero — facts read straight out of
> one document — document filtering is perfectly correct. It fails only on
> derived facts. That is not a bug in someone's implementation. That is the
> ceiling of the idea.

### Block 4 — 1:35 to 2:05 · the baseline is arbitrary

> There is a worse problem underneath. A derived fact carries one space,
> assigned when the node was written — whichever source the writer reached
> first. That assignment is what a document-level gate reads.
>
> So we asked: for every fact that must be withheld from someone, would the gate
> have answered differently if the node had been filed under a different one of
> its own sources?
>
> It flips. Same graph, same permissions, same person asking — opposite answer.
> A security decision settled by ingest order is not a security decision.
> Cordon's answer never changes, because Cordon never reads the attribution. It
> reads the derivation.

### Block 5 — 2:05 to 2:35 · real permissions

> None of that depends on us modelling the access control, because for the
> second run we did not.
>
> Three real GitHub repositories. Two private, one public. Same connector
> interface, and then the exact same extraction, resolution, derivation and
> admissibility code — byte for byte.
>
> A fact about a person who appears in the public handbook and in both private
> repositories gets disclosed by document-level filtering. Here is the source it
> rests on, requested without credentials.
>
> Four oh four. GitHub refuses to show the document. The fact derived from it
> was handed over anyway.

### Block 6 — 2:35 to 2:55 · why a graph, and the bug

> Admissibility is a reachability question with a per-principal predicate. With
> n principals there are two-to-the-n visibility subsets, so it cannot be
> precomputed. It has to be traversed, per asker, at query time. And a vector
> index cannot express it even in principle: an embedding records what a fact
> resembles, not what it was derived from. Similarity is not provenance.
>
> One last thing. Our own first invariant check compared a value against itself.
> It could not have failed. Once it compared the graph against a requirement
> recomputed independently, forty-seven facts disagreed. A security property
> only ever checked against the field that produced it is not being checked at
> all.

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

You are recording **pictures only**. No microphone. The voice comes from
ElevenLabs and gets laid on top in editing. This is much easier than trying to
talk and click at the same time, and it sounds better.

### Install OBS Studio

```bash
sudo apt install obs-studio      # Ubuntu/Debian
```

Or download from <https://obsproject.com>. It is free.

### Set OBS up once

1. Open OBS. If a setup wizard appears, choose **Optimise just for recording**.
2. **Settings** (bottom right) → **Video**:
   - Base resolution: `1920x1080`
   - Output resolution: `1920x1080`
   - FPS: `30`
3. **Settings** → **Output**:
   - Output mode: `Simple`
   - Recording quality: `High Quality, Medium File Size`
   - Recording format: `MP4`
   - Encoder: `Software (x264)` — pick hardware only if software stutters
4. **Settings** → **Audio**: set **Mic/Auxiliary Audio** to `Disabled`. You do
   not want your room in this video.
5. Click **OK**.

### Add what you are filming

In the **Sources** box at the bottom, click **+**:

- Choose **Screen Capture (XSHM)** on Linux (or **Display Capture**).
- Pick your monitor. Click **OK**.

You should now see your screen inside OBS. (You will see infinite mirrors if OBS
is on the screen you are capturing — that is normal, just move OBS to a second
monitor or minimise it before recording.)

### Make your screen look good

Before you record anything:

1. **Close everything you are not filming.** Slack, email, file manager,
   everything. One stray notification ruins a take.
2. Turn off notifications: **Settings → Notifications → Do Not Disturb**.
3. In the browser: hide bookmarks (`Ctrl+Shift+B`), and use a clean profile with
   no extra tabs.
4. In the terminal: make the font big. `Ctrl+Shift++` five or six times. If a
   judge has to squint, the shot failed. Use a dark theme.
5. Set your desktop wallpaper to something plain and dark.

### Take the six shots

Record each one **separately**. Six short clips are far easier to edit than one
long one, and if you fumble shot 4 you only redo shot 4.

For each shot: press **Start Recording** in OBS, wait two seconds doing nothing,
do the actions, wait two seconds doing nothing, press **Stop Recording**. Those
two seconds of stillness at each end give you room to cut.

OBS saves to `~/Videos` by default. Rename each file as soon as you record it.

---

**Shot 1 — `shot1-console.mp4`** (needs ~25 seconds)

Window A, the console, sitting still. Slowly scroll down the page once and back
up. That is all. This is wallpaper under Block 1.

**Shot 2 — `shot2-leak.mp4`** (needs ~50 seconds)

Window B, the terminal, cleared (`clear`). Type:

```bash
npm run demo:leak
```

Press Enter. Let it print completely. Do not scroll while it prints. When it
finishes, wait three seconds, then slowly scroll up to the top of the output and
back down.

**Shot 3 — `shot3-console-toggle.mp4`** (needs ~25 seconds)

Window A, the console. Pick the hero question. Click the first principal —
pause three seconds so the answer is readable. Click the second principal —
pause three seconds. Then move the mouse to the withheld panel and hover over
the missing spaces. Move the mouse slowly and deliberately; fast mouse movement
looks panicked.

**Shot 4 — `shot4-results.mp4`** (needs ~55 seconds)

Window C, `docs/RESULTS.md`. Scroll slowly to the leakage table and stop. Sit on
it for five seconds. Then scroll to the **Leaks by derivation depth** table and
sit on the depth-zero row for five seconds. Then scroll to **Is the baseline
even well-defined?** and sit on the flip table for five seconds.

**Shot 5 — `shot5-github.mp4`** (needs ~35 seconds)

Window B, the terminal, cleared. Type:

```bash
npm run audit:github
```

Let it run to the end. It prints the three repositories, the pipeline, the
disclosure table, and finally the live 404. When it stops, wait three seconds.

Then — still recording — switch to **window D, the private window**, and paste
the private repository URL:

```
https://github.com/iamdflame/cordon-demo-borealis
```

Press Enter. GitHub shows its 404 page. Sit on it for four seconds.

That switch, in one unbroken take, is the single most convincing four seconds in
the video. Do not cut between the terminal and the browser here — the fact that
it is one continuous shot is the proof.

**Shot 6 — `shot6-cypher.mp4`** (needs ~25 seconds)

Window A, the console, on the panel that shows the traversal / Cypher. Let it
sit. Scroll once if there is more than a screen of it.

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

1. Drag `shot1-console.mp4` onto `V1` at time zero.
2. It is probably longer than block 1's audio. Hover over its **right edge**
   until the cursor becomes an arrow, then drag left until the clip ends where
   the audio block ends.
3. Drag `shot2-leak.mp4` onto `V1` immediately after. Trim its right edge to end
   where block 2's audio ends.
4. Keep going: `shot3` under block 2's tail if there is room, `shot4` under
   block 3 **and** block 4, `shot5` under block 5, `shot6` under block 6.

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
