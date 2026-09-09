# Import worker Python runtime regression

The reported sources `s3_uirvnSdI` and `RMhQOpDUj3U` were not failing in yt-dlp. The deployed
management ledger recorded both attempts through `downloading`, `postprocessing` and `publishing`,
then stored the generic `download_failed` result. Running the same active engine and fixed
Musiclatte downloader arguments in isolated containers produced valid MP3 files for both sources.

The failure occurred when publishing acquired the shared media fence. The deployed worker's
minimal Python package did not contain the `json` standard-library module imported by
`media_fence.py`. A product `createMediaFence` probe reproduced `fence_lost`; direct helper
diagnostics identified `ModuleNotFoundError: No module named 'json'`. `youngs-ytdl` does not run
this shared publication fence, which explains why the same sources succeeded there.

RED added a deployment contract requiring a final-image isolated `json` import and excluding the
insufficient `python3-minimal` package. GREEN installs Debian's complete `python3` runtime and runs
that import during the image build. The focused deployment contract passes 8 tests.

On devserver, an isolated image built from the fix completed the build-time import probe. Its
production `createDownloader` then downloaded, converted and validated both reported sources,
and `createMediaFence` held the publication lock while each MP3 was copied into an isolated music
tmpfs. Both publications were nonempty. Existing p5 services, databases and music volumes were
not replaced or mutated; only the existing engine volume was mounted read-only for the probe.
