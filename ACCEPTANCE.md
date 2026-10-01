# Beat Pad acceptance criteria

Each item names how it is checked. A stage is not done until its checks have actually run and been inspected.

## Sound

- A1. Four drum kits (Acoustic, 808/Trap, Lo-fi, House), 16 pads each, every pad a real recorded sample. Checked by the sound manifest listing 64 pad assignments with sources.
- A2. At least one pad per kit has round-robin takes, and velocity layers are used wherever the source provides them. Checked in the manifest.
- A3. A sampled bass and a sampled keys instrument for melodic mode. Checked in the manifest.
- A4. Every shipped sample has a recorded source URL and license, and the license allows free redistribution. CC-BY sources are credited in About and CREDITS.md. Checked by a script that compares shipped files against the license report.
- A5. Hits start within 3 ms of the file start (leading silence trimmed), no clicks at the start or end, true peak at or below -0.5 dBFS per file. Checked by an analysis script over every file.
- A6. Kit demo renders show no clipping (peak below 0 dBFS after the bus) and integrated loudness between -16 and -9 LUFS. Checked with ffmpeg ebur128 and astats, plus spectrogram and waveform images reviewed with vision.
- A7. Total shipped sample payload under 8 MB for the primary format. Only the default kit loads before first play.

## Engine and timing

- B1. Pads trigger on `pointerdown` with decoded buffers. Checked in a browser test that hooks the engine trigger.
- B2. Round-robin never repeats the previous take when more than one exists. Unit tested.
- B3. Choke groups cut open hi-hat when closed hi-hat plays. Checked in an offline render.
- B4. Scheduler: events fire at the right audio-clock times within 1 ms, across loop wraps, at tempo changes. Unit tested with a fake clock.
- B5. Quantize for 1/8, 1/16 and 1/16T, swing from 0 to 60%. Unit tested.
- B6. Share-link encode and decode round-trips a pattern exactly (to stored resolution) and rejects malformed input safely. Unit tested.
- B7. An OfflineAudioContext render in Chromium of a known pattern places onsets within 2 ms of expected times and peaks below 0 dBFS.
- B8. Latency hint, `baseLatency` and `outputLatency` are measured in Chromium and recorded honestly.

## Instrument

- C1. 4x4 pads fill a 390x844 phone screen without page scroll and stay at least 72 px square. Multiple simultaneous touches each sound. Checked with Playwright touch emulation and screenshots.
- C2. Visual hit feedback on every hit. Screenshot during a hit.
- C3. Kit picker swaps kits and keeps the pattern. Browser test.
- C4. Looper: count-in, record, overdub layers per pass, undo last layer, clear. Browser test drives a record and checks the pattern.
- C5. Step grid reflects recorded hits and edits feed back into playback. Browser test.
- C6. Per-pad edit changes volume, pitch, filter and reverb and persists. Browser test.
- C7. Melodic mode maps all 16 pads to in-scale notes for the chosen key and scale. Unit and browser test.
- C8. Mic recording to a pad with trim works with a fake media stream in Chromium.
- C9. Save, reload, load, share link and WAV export all work. Browser test, with the exported WAV validated by ffprobe and audible content checked.
- C10. Keyboard mapping plays all 16 pads and transport shortcuts work. Web MIDI connects when available and is skipped gracefully when not.
- C11. Phone and desktop screenshots reviewed with vision. The app should look calm, inviting and easy to play, with readable serif labels.

## Verification and release

- D1. Fresh build: no page errors and no console errors on phone and desktop.
- D2. No network requests except same-origin. Works offline after first load (service worker), checked by reloading with the network blocked.
- D3. Portrait and landscape phone layouts both usable.
- D4. Accessibility basics: buttons have names, pads have labels, focus is visible, text contrast at least 4.5:1.
- D5. No private paths, tokens or secrets in the published files. Every shipped sample is in the license report.
- D6. Live site at https://brotatotes.github.io/beatpad/ serves the same files as the build and pads produce sound in an instrumented live check on desktop and phone.
- D7. Card at the top of Games & Experiments on the home page, verified live.
- D8. One message in #dev with the link, the home page link, things to try, one feedback question and a phone screenshot, read back from Discord.
