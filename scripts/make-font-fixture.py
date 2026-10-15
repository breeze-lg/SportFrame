"""Builds the font fixture the 文字 tests load: a small TrueType file, so that
"the user brought a face" can be tested without depending on what happens to be
installed on the machine running the suite.

Provenance: DejaVu Sans, subset to the Latin letters and digits the tests type.
DejaVu's licence (Bitstream Vera, plus the DejaVu changes) permits
redistribution and modification; `tests/fixtures/README.md` records that, the
same way it records the camera fixture's.

Run from the repo root:  python3 scripts/make-font-fixture.py
"""

import pathlib
import sys

from fontTools import subset

SOURCES = [
    "/opt/homebrew/anaconda3/lib/python3.12/site-packages/matplotlib/mpl-data/fonts/ttf/DejaVuSans.ttf",
    "/opt/homebrew/lib/python3.12/site-packages/matplotlib/mpl-data/fonts/ttf/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]

TEXT = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .·—"


def main() -> int:
    src = next((pathlib.Path(p) for p in SOURCES if pathlib.Path(p).exists()), None)
    if src is None:
        print("no DejaVu Sans found; nothing written", file=sys.stderr)
        return 1

    out = pathlib.Path("tests/fixtures/dejavu-subset.ttf")
    out.parent.mkdir(parents=True, exist_ok=True)

    args = [
        str(src),
        f"--text={TEXT}",
        f"--output-file={out}",
        # the smallest file that still renders: no hinting, no layout tables, and
        # no glyph names — the tests care about the shape reaching the canvas and
        # nothing else
        "--drop-tables+=GSUB,GPOS,GDEF,kern",
        "--no-hinting",
        "--desubroutinize",
        "--name-IDs=*",
        "--glyph-names",
        "--recalc-bounds",
    ]
    subset.main(args)

    size = out.stat().st_size
    print(f"wrote {out} ({size} bytes) from {src}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
