# Beat Pad

A drum pad for making beats with your fingers, built for phones first and playable from a computer keyboard or a MIDI pad controller too.

**Play it:** https://brotatotes.github.io/beatpad/

- 16 pads with real recorded kits: Acoustic, 808 / Trap, Lo-fi and House, with velocity layers and round-robin takes
- Loop recording with count-in, overdub, undo and clear, plus snap-to-beat and swing
- Step grid that shares the same pattern as the looper
- Bass and Keys modes locked to a key and scale
- Record your own sound from the mic, trim it and put it on a pad (stays on your device)
- Save beats in the browser, share a link, export a WAV
- Works offline after the first visit. No ads, accounts or tracking.

## Keyboard

`1 2 3 4` / `Q W E R` / `A S D F` / `Z X C V` play the 4x4 pads, top row to bottom row. Hold Shift for a soft hit. Space plays or stops, Enter records, Backspace undoes the last layer, G toggles the grid, M the metronome, `[` and `]` change tempo, K switches kit. MIDI notes 36 to 51 play the pads from the bottom left.

## Sample credits

All sounds are released under CC0 1.0 (public domain dedication). They were trimmed, balanced and re-encoded for Beat Pad.

- Virtuosity Drums by Versilian Studios and Karoryfer, drummer Austin McMahon. https://github.com/sfzinstruments/virtuosity_drums
- Versilian Community Sample Library by Sam Gossner / Versilian Studios. https://github.com/sgossner/VCSL
- MckSamplePacks by Christian Mädler / MckAudio. https://github.com/MckAudio/MckSamplePacks
- Black and Blue Basses by Karoryfer Samples. https://github.com/sfzinstruments/karoryfer.black-and-blue-basses

Type is EB Garamond by Georg Duffner, under the SIL Open Font License (see `fonts/OFL.txt`). Scales and keys come from the music theory module of [Chord Explorer](https://github.com/brotatotes/chord-explorer).

## Running locally

It is a static site. Serve the folder with any static server, for example `python3 -m http.server`, and open it in a browser. Tests: `node --test tests/*.test.js`, plus the Playwright checks in `tests/`.
