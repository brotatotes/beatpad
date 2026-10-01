# Beat Pad design

Beat Pad is a phone-first drum pad for making beats with your fingers. Sixteen big pads, real recorded kits, a looper that layers each pass, and a step grid for precise edits. It is a small static site with no build step, no server and no tracking.

## Principles

1. Sound first. Real recorded samples, decoded before play, round-robin takes and velocity layers, and a gentle mix bus so a simple beat already sounds finished.
2. Instant to play. The pads are the first thing on screen. A tap makes a sound on `pointerdown` with no menus in the way.
3. Hard to get wrong. Melodic pads stay in key, quantize is on by default for loop recording, and every destructive action has undo.
4. Calm, warm and playful. A dark warm background, soft coloured pads that glow on hit, serif type.

## File layout (public repo)

```
index.html            app shell
app.css               styles
src/theory.js         copied from Chord Explorer with attribution header
src/core.js           pure logic: pattern model, quantize, swing, scheduler math, share codec (node + browser)
src/engine.js         Web Audio engine: buffers, voices, chokes, bus, metronome, offline render, WAV encode
src/kits.js           kit and instrument definitions (generated from the sound manifest)
src/ui.js             pads, transport, grid, editors, storage, keyboard, MIDI
sw.js                 service worker, cache-first for same-origin files
samples/<kit>/*.opus  primary encoding (Ogg Opus, mono or stereo, 96 kbps)
samples/<kit>/*.m4a   fallback for browsers that cannot decode Opus (old iOS Safari), AAC 96 kbps
CREDITS.md            every sample source, author, license and URL
README.md
.nojekyll
```

Format choice at runtime: `new Audio().canPlayType('audio/ogg; codecs=opus')` picks `.opus`, otherwise `.m4a`. The default kit loads on first open. Other kits load the first time they are chosen and are then cached by the service worker.

## Screens and layout

### Phone, 390x844 portrait

Top to bottom, no page scroll on the play screen. `touch-action: none` on pads and grid, `user-scalable=no`, `overscroll-behavior: none`, no text selection, no long-press menus.

1. **Top bar (48 px).** App name "Beat Pad" on the left. Kit chip in the centre ("Acoustic ▾") opens the kit sheet. Menu button on the right opens Save, Share, Export, Mic sampler, Settings and About.
2. **Transport (56 px).** Play/stop, Record (with count-in), tempo readout (tap to edit, drag to change, tap-tempo inside the editor), metronome toggle, Undo layer, Clear. Bar position dots show the current beat of the loop.
3. **View switch (36 px).** Segmented control: Pads · Grid. Plus a Drums · Bass · Keys mode switch on the right.
4. **Main area (rest, about 600 px).** Pads view: a 4x4 grid of square pads, each about 86 px with 8 px gaps, filling the width with 12 px margins. Grid view: 16 rows (one per pad, short label and colour swatch) by 16 steps, horizontally fitting at about 20 px per step, scrolling vertically within the panel only.
5. **Bottom strip (44 px).** Quantize (Off, 1/8, 1/16, 1/16T), Swing slider (0–60%), loop length (1, 2 or 4 bars). Sits within thumb reach.

Landscape phone: pads on the left as a square, transport and grid stacked on the right.

### Desktop, 1440x900

Centred column up to 1100 px. Pads on the left (square, about 520 px), grid on the right. Each pad shows its keyboard key in the corner. Kit and mode controls sit in the top bar.

### Sheets and dialogs

- **Kit sheet.** Four cards: Acoustic, 808, Lo-fi, House. Each card has a one-line description and a preview button. Selecting a kit swaps sounds and keeps the pattern.
- **Pad edit sheet.** Opened by long-press (450 ms without movement) on a pad on touch, or right-click/Shift+click on desktop. Controls: Volume, Pitch (±12 semitones), Filter (one knob: left = low-pass, centre = open, right = high-pass), Reverb send, Choke group (none, A, B), Sample source (kit default or a recorded mic sample). Changes are audible live and saved with the beat.
- **Melodic mode.** Bass or Keys. Key picker (12 tonics) and scale picker (major, minor, dorian, mixolydian, major pentatonic, minor pentatonic, blues, harmonic minor) from Chord Explorer's theory module. The 16 pads map to consecutive scale degrees from bottom-left upward across two-plus octaves, with tonics highlighted. Notes are recorded into the pattern as their own melodic track, so drums and bass live together.
- **Mic sampler.** Record up to 4 seconds with a live level meter. Waveform view with draggable start and end handles, auto-trim of leading silence, Preview, then Assign to pad. Recordings are stored in IndexedDB on the device only, never in share links.
- **Save / Share / Export.** Save names the beat into the browser's list of saved beats (load, rename, delete). Share copies a link containing the pattern for built-in sounds. Export renders the loop offline (1, 2 or 4 repeats) to a 44.1 kHz 16-bit stereo WAV download.
- **About.** What it is, how to play, keyboard map, latency note, Chord Explorer credit, and the full sample credits list.

## Keyboard and MIDI mapping

Keyboard (physical `event.code`, so it works on any layout), pads numbered from the top-left:

```
1 2 3 4      -> pads 1-4    (top row)
Q W E R      -> pads 5-8
A S D F      -> pads 9-12
Z X C V      -> pads 13-16  (bottom row)
```

Space = play/stop, Enter or `.` = record, Backspace = undo layer, `G` = toggle grid, `M` = metronome, `[` and `]` = tempo −/+1, `K` = next kit. Keys ignore auto-repeat. Shift while hitting a key gives a soft (velocity 0.5) hit. Key hints appear in pad corners only when a fine pointer is present (`@media (hover: hover)`).

Web MIDI (where `navigator.requestMIDIAccess` exists, requested only after the user taps "Connect MIDI" in Settings): Note On 36–51 maps to pads 1–16 bottom-left first, matching the common MPC/Launchpad drum layout. Note On velocity is used directly. In melodic mode any note number plays that pitch snapped to the current scale.

## Audio graph

```
voice: AudioBufferSourceNode (playbackRate = 2^(pitch/12))
     -> velocity gain (curve v^1.6 between -36 dB and 0 dB, plus layer choice)
     -> pad gain -> pad filter (BiquadFilter, lowpass or highpass by knob)
     -> pad output -> dry bus
                   -> reverb send gain -> ConvolverNode (generated short room impulse, 1.1 s) -> reverb return (-14 dB)
dry bus + reverb return + metronome -> master gain
     -> DynamicsCompressor (threshold -18 dB, ratio 3, attack 5 ms, release 120 ms, knee 6) "glue"
     -> DynamicsCompressor as brickwall limiter (threshold -3 dB, ratio 20, attack 1 ms, release 50 ms)
     -> final gain (-1 dB) -> destination
```

- The room impulse is generated deterministically from decaying filtered noise at startup, so no extra download.
- Choke groups: starting a voice in group A fades out (8 ms ramp) every live voice in group A. Default: closed hi-hat, pedal hat and open hi-hat share group A.
- Velocity layers: if a pad has several layers, velocity selects the layer, then round-robin rotates among takes in that layer without repeating the previous take.
- Polyphony cap of 32 voices with oldest-voice stealing using a short fade.
- `AudioContext({ latencyHint: 'interactive' })`. The context is created or resumed on the first user gesture. All buffers are decoded before the pads go live, and a small "loading" state is shown until the default kit is ready.
- Touch velocity: pointer pressure when the device reports real pressure, otherwise fixed by pad zone (tap nearer the centre is louder, the edge is softer, from 0.7 to 1.0). Keyboard is 1.0 or 0.5 with Shift.

## Timing model

- One loop is `bars x 16` steps of a sixteenth note. Events are stored in step units as floats, not seconds, so tempo changes keep the groove.
- Lookahead scheduler: a `setInterval` of 25 ms (and a Worker timer when available) schedules every event whose time falls within the next 120 ms on `AudioContext.currentTime`. Time is derived from a loop origin on the audio clock, never from `Date.now()`.
- Swing delays every odd sixteenth by `swing x stepDuration x 0.5`. 0% is straight, 50% is a hard triplet shuffle.
- Quantize at record time snaps a hit to the nearest grid unit (1/8, 1/16 or 1/16 triplet), with the result wrapped into the loop. Off keeps the raw position to 1/96 step precision.
- Live hit time in the loop is `(ctx.currentTime - outputLatencyCompensation - loopOrigin) / stepDur`, where compensation uses `ctx.outputLatency` when reported (else `baseLatency`), so recorded hits land where the player heard them.
- Count-in: one bar of metronome clicks (accent on beat 1) before recording starts.
- Overdub: while recording, each completed pass of the loop closes the current layer and opens a new one. Undo removes the newest non-empty layer. Clear empties the pattern (itself undoable once).
- A hit that duplicates the same pad within 1/32 of an existing event in the same position replaces rather than stacks, which avoids flams from quantize.

## Pattern model

```js
{
  v: 1,
  bpm: 92, bars: 2, swing: 0.2, quant: 16,
  kit: 'acoustic',
  pads: [{ vol: 0, pitch: 0, filter: 0, rev: 0.15 }, ...16],   // dB, semitones, -1..1, 0..1
  melodic: { inst: 'bass', key: 'A', scale: 'minor' },
  layers: [ { id, events: [ { t: 4.0, pad: 2, vel: 0.9 } | { t: 8, note: 45, vel: 0.8, dur: 2, inst: 'bass' } ] } ]
}
```

The step grid shows the union of all layers for drums. Toggling a cell on adds a full-velocity event in a new "grid" edit layer, toggling off removes the events at that cell from whichever layers hold them. Grid edits are undoable through the same undo stack.

## Storage and share links

- **Saved beats.** `localStorage['beatpad.beats.v1']` holds a list of `{ id, name, savedAt, pattern }`. The working beat autosaves to `beatpad.current.v1` every change (debounced 500 ms).
- **Mic samples.** IndexedDB database `beatpad`, store `samples`, keyed by id, holding mono Float32 PCM plus sample rate. Pad overrides reference the id. Patterns that reference mic samples share with those pads falling back to the kit sound, and the Share dialog says so.
- **Share link.** `https://brotatotes.github.io/beatpad/#b=<code>`. The code is version byte + compact binary (bpm, bars, swing, quantize, kit index, pad settings quantized to bytes, melodic settings, events as step at 1/24 resolution, pad or note, velocity in 4 bits), then base64url. Layers are flattened on share. A 2-bar beat with 60 hits stays under about 300 characters. Decoding validates every field and ignores anything malformed, showing a short notice instead of breaking.

## Sound plan

- Kits: Acoustic, 808/Trap, Lo-fi, House. 16 pads each in a consistent layout so muscle memory carries over:
  - Row 1 (top): crash/ride, open hat, closed hat, pedal hat or shaker
  - Row 2: toms or percussion x3, rimshot or clap
  - Row 3: snare, snare variation, clap, percussion
  - Row 4 (bottom, thumb row): kick, kick variation, 808 or low tom, fx/vox one-shot
- Bass and keys: sampled instruments with a root sample every 3–4 semitones and short pitch shifts between them.
- Sources: CC0 or public domain first, such as the Versilian Community Sample Library (CC0) for acoustic drums, percussion and keys, and CC0 electronic drum machine recordings for 808 and house. Every file is tracked in the manifest and credited in About. Any CC-BY material is credited by name.
- Processing: trim leading silence to the first sample over -50 dBFS minus 2 ms, 2 ms fade-in, 10–40 ms fade-out at the natural tail cut, peak-normalize one-shots per pad to -1 dBFS then loudness-balance pads within a kit by ear and LUFS, mono for drums except cymbals and room hits, 44.1 kHz.
- Budget: under 8 MB total across both encodings' primary set, about 1.2 MB per kit.

## Visual style

- Background warm near-black `#17130f`, panels `#211b16`, text cream `#f3e9d8`, muted text `#b9a994`.
- Pads: rounded 18 px squares with a soft inner gradient. Each row gets its own colour family so the layout is readable at a glance: cymbals amber `#e0a24a`, toms/perc teal `#4fb3a5`, snares coral `#e0705a`, kicks violet `#8f7ae6`. On hit the pad brightens, scales to 0.96 and emits a short glow ring, timed to the audio, under 120 ms.
- Steps that are playing glow in the grid. The playhead is a soft cream column.
- Typography: EB Garamond (self-hosted WOFF2 subset, OFL, credited) for everything including labels. Numbers use tabular figures.
- Contrast: all text at least 4.5:1 on its background. Tap targets at least 44 px.
- Motion respects `prefers-reduced-motion` by dropping scale and glow animation but keeping the colour flash.

## Offline and privacy

- Service worker caches the app shell and the default kit on install, other kits on first use. No third-party requests at all. Fonts are self-hosted.
- No analytics, cookies, accounts or ads. Mic audio never leaves the device.

## Latency honesty

The About screen reports the measured `baseLatency` and `outputLatency` of the current device, and notes that Android phones add output delay that a website cannot remove. Recording compensates for reported output latency.
