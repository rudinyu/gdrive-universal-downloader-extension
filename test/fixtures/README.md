`hls-smoke.ts` is copied from the `test/segments/test-segment.ts` fixture in
[`videojs/mux.js` 6.3.0](https://github.com/videojs/mux.js/tree/v6.3.0/test/segments)
for a real MPEG-TS-to-MP4 smoke test. The upstream project is licensed under
Apache-2.0; its license is included at `lib/MUX_JS_LICENSE.txt`.

`separate-av/` contains synthetic HLS VOD fixtures generated locally with FFmpeg: one AVC fMP4 video playlist (three fragments) and one AAC fMP4 audio playlist (four fragments). The fixtures exercise independent fragment counts, track-ID remapping, and fragment interleaving. They are test data only; the extension does not invoke FFmpeg at runtime.
