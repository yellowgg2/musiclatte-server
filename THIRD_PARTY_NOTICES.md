# Third-party runtime notices

The project license remains undecided. This file records third-party components and does not
grant a license for Musiclatte Server's own code.

## Metadata images

- **Mutagen 1.48.1** — GPL-2.0-or-later. The exact wheel is installed with pip's
  `--require-hashes` using `apps/api/helpers/requirements-metadata.lock`. Upstream:
  https://github.com/quodlibet/mutagen / https://pypi.org/project/mutagen/1.48.1/.
  Both API and worker images include its unmodified corresponding source archive and full
  COPYING file under `/usr/share/musiclatte/third-party/`. Source archive SHA-256:
  `8f95637ab9f6f305cec6bd1294e197debe207998e3e068596563c74f86b0a173`.
- **Python 3.11 (Debian Bookworm package)** — Python Software Foundation license and bundled
  component notices. The installed package's `/usr/share/doc/python3.11/copyright` and the
  upstream Python distribution identify applicable terms. https://www.python.org/psf/license/.
- **FFmpeg/FFprobe 5.1.9, Debian `7:5.1.9-0+deb12u1`** — the distribution's enabled components
  determine applicable LGPL/GPL terms. Keep `/usr/share/doc/ffmpeg/copyright` and the copyright
  files of its installed libraries. Exact package/build configuration is recorded by the image
  probe; corresponding Debian source packages must match those versions. Upstream:
  https://ffmpeg.org/legal.html / https://sources.debian.org/src/ffmpeg/.
- **Go 1.26.0** — BSD-style Go license. Used only to build the worker's static cover projection
  checker; the compiler is not installed in the runtime image. Full license is copied to
  `/usr/share/musiclatte/third-party/Go-LICENSE` in the worker image.
- **github.com/disintegration/imaging 1.6.2** — MIT, copyright 2012 Grigory Dryapak. Full license:
  `/usr/share/musiclatte/third-party/imaging-LICENSE`. https://github.com/disintegration/imaging.
- **golang.org/x/image 0.41.0** — BSD-style Go license. Full license:
  `/usr/share/musiclatte/third-party/x-image-LICENSE`. https://go.googlesource.com/image/.

The cover checker is independently implemented using imaging's public API to reproduce the
observed gonic v0.22.0 resize/encode behavior. It does not modify or link the gonic server.
Go module versions and checksums are pinned in the helper's go.mod/go.sum.

The Node, Debian and existing gonic/web/import images retain their own bundled dependency
notices. npm dependencies remain pinned by package-lock.json; no npm dependency was added for
metadata. Retain each image's package notices when redistributing it.
