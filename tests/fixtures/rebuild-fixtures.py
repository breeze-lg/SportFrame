#!/usr/bin/env python3
"""Authoring tool for tests/fixtures/*.jpg. Run by hand; never by the build.

Why this file exists
--------------------
The fixtures' *pixel* content came from a third-party image library, so
redistributing those files was a licensing problem even though their metadata
is exactly what the parser needs. This script separates the two. It keeps every
metadata segment byte for byte — JFIF APP0, Exif APP1, Photoshop APP13 — and
writes new, self-generated pixels underneath them.

So the EXIF bytes stay real (Nikon D810 firmware, an Adobe Photoshop CC 2019
IFD, a Paint.NET 4.2.16 export), which is what exercises the parser, while the
image content is a procedural pattern authored in this file. The repository
redistributes nothing it does not own.

Two details that matter:

  * The embedded thumbnails (APP1's IFD1 and APP13's 0x040C resource) are
    vendor photography too, so they are regenerated in place: same slot length,
    same dimensions, pattern pixels. Keeping the length means every TIFF offset
    around them, and the APP1 segment's own length field, stay untouched.
  * The scan (DQT/SOF/DHT/SOS) is re-encoded at the original dimensions, with
    the original quantization tables and chroma subsampling, so only the
    subject changes, not the compression settings.

It is deterministic and idempotent: the pixels are a pure function of the slot
size and the per-file seed below, and Pillow's JPEG encoder is deterministic for
a fixed input, so re-running it on an already-rebuilt fixture reproduces the
same bytes. The one file it *creates* rather than rebuilds — long-exposure.jpg —
is written from the same generator plus a Pillow-authored Exif block.

Requires Pillow (built and run against 10.3.0). The app itself never runs this:
nothing imports it, it is not in package.json, and it is not needed to build,
test or ship the project.
"""

import io
import os
import sys

from PIL import Image
from PIL.TiffImagePlugin import IFDRational

HERE = os.path.dirname(os.path.abspath(__file__))

# Per-file seed. Different seeds give each fixture a visibly different pattern,
# so a glance at two of them never suggests they came from one photograph.
SEEDS = {
    "with-exif.jpg": 1,
    "with-exif-le.jpg": 2,
    "no-exif.jpg": 3,
    "exif-no-tags.jpg": 4,
    "partial-exif.jpg": 5,
    "partial-date-only.jpg": 6,
    "long-exposure.jpg": 7,
}

APP0, APP1, APP13, SOS, EOI, SOI = 0xE0, 0xE1, 0xED, 0xDA, 0xD9, 0xD8
# Markers whose payload is metadata worth keeping. Everything else before SOS is
# image structure (DQT, SOF, DHT, DRI) and is replaced wholesale.
KEEP = (APP0, APP1, APP13)

# A DQT segment stores its 64 values in zigzag order; Pillow's `qtables`
# parameter takes them in natural order and zigzags them itself. The tables are
# translated on the way through, so the DQT the encoder writes is byte for byte
# the one the vendor file carried.
ZIGZAG = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]
INV_ZIGZAG = [ZIGZAG.index(i) for i in range(64)]


def segments(data):
    """Return (marker, start, end) for every segment up to and including SOS.

    `end` is exclusive and includes the SOS/scan/EOI tail for marker 0xDA.
    """
    out = []
    off = 2  # past SOI
    while off + 4 <= len(data):
        if data[off] != 0xFF:
            raise ValueError("lost segment sync at %d" % off)
        marker = data[off + 1]
        if marker == SOI or 0xD0 <= marker <= 0xD7:
            off += 2
            continue
        if marker == SOS:
            out.append((marker, off, len(data)))
            break
        if marker == EOI:
            out.append((marker, off, off + 2))
            break
        size = int.from_bytes(data[off + 2 : off + 4], "big")
        if size < 2:
            raise ValueError("bad segment length at %d" % off)
        out.append((marker, off, off + 2 + size))
        off += 2 + size
    return out


def image_params(data):
    """Dimensions, quantization tables and subsampling of the scan."""
    w = h = None
    qtables = []
    subsampling = 2
    for marker, start, end in segments(data):
        body = data[start + 4 : end]
        if marker == 0xC0:  # SOF0, baseline
            h = int.from_bytes(body[1:3], "big")
            w = int.from_bytes(body[3:5], "big")
            comps = body[5]
            sampling = {}
            for i in range(comps):
                cid = body[6 + i * 3]
                hv = body[7 + i * 3]
                sampling[cid] = (hv >> 4, hv & 0x0F)
            # Y is component 1 in every fixture; its H/V decide the chroma mode.
            hy, vy = sampling[1]
            subsampling = 0 if (hy, vy) == (1, 1) else (1 if vy == 1 else 2)
        elif marker == 0xDB:  # DQT
            i = 0
            while i < len(body):
                pq, tq = body[i] >> 4, body[i] & 0x0F
                n = 128 if pq else 64
                stored = list(body[i + 1 : i + 1 + n])  # zigzag order, as on disk
                qtables.append([stored[INV_ZIGZAG[k]] for k in range(64)])
                i += 1 + n
    if w is None or not qtables:
        raise ValueError("no SOF0/DQT found")
    return w, h, qtables, subsampling


def synth_pixels(w, h, seed):
    """A procedural test pattern: a two-axis colour ramp, wide diagonal bands,
    concentric rings and a thick border. Authored here, from nothing but the
    pixel coordinates and the seed — no third-party imagery is involved.

    The values are quantised to multiples of eight and every edge is at least
    eight pixels from the next, so the pattern stays cheap to encode: a fixture
    set that is mostly high-frequency noise would be several times the size of
    the vendor photography it replaced for no gain.
    """
    img = Image.new("RGB", (w, h))
    px = img.load()
    cx, cy = w * (0.3 + 0.4 * ((seed % 3) / 2.0)), h * (0.3 + 0.4 * ((seed % 5) / 4.0))
    phase = seed * 0.7
    for y in range(h):
        v = y / max(1, h - 1)
        g = int(255 * v) & 0xF8
        for x in range(w):
            u = x / max(1, w - 1)
            r = int(255 * u) & 0xF8
            t = (u + v + phase) % 1.0
            b = int(255 * (2 * t if t < 0.5 else 2 * (1 - t))) & 0xF0
            if ((x + y + seed * 13) // 48) % 2 == 0:
                r, g, b = r * 3 // 4, g * 3 // 4, b * 3 // 4
            d = int((((x - cx) ** 2 + (y - cy) ** 2) ** 0.5) // 64)
            if d % 2:
                r, g = min(255, r + 24), min(255, g + 24)
            elif d % 4 == 2:
                b = min(255, b + 32)
            if 8 <= x < w - 8 and 8 <= y < h - 8 and (x < 16 or y < 16 or x >= w - 16 or y >= h - 16):
                r, g, b = 24, 24, 24
            px[x, y] = (r, g, b)
    return img


def encode(img, qtables, subsampling, quality=None):
    """Encode to baseline JPEG. With `qtables` given the original tables are
    reused verbatim, which is what "same JPEG quality" means here."""
    buf = io.BytesIO()
    kwargs = {"format": "JPEG", "optimize": False, "progressive": False, "subsampling": subsampling}
    if quality is None:
        kwargs["qtables"] = qtables
    else:
        kwargs["quality"] = quality
    img.save(buf, **kwargs)
    return buf.getvalue()


def synth_thumbnail(w, h, seed, limit):
    """A self-generated thumbnail that fits `limit` bytes exactly: the highest
    quality that fits, then zero padding after EOI.

    The padding is inert — every decoder stops at EOI — and it keeps the slot
    length identical, so the IFD1 offset behind it, the APP13 resource length
    and the APP1 segment length are all untouched.
    """
    img = synth_pixels(w, h, seed)
    for quality in (95, 92, 90, 85, 80, 70, 60, 50, 40, 30):
        data = encode(img, None, 2, quality=quality)
        if len(data) <= limit:
            return data + b"\x00" * (limit - len(data))
    raise ValueError("thumbnail does not fit in %d bytes" % limit)


def jpeg_dims(data):
    """Dimensions of a standalone JPEG (used for the embedded thumbnails)."""
    for marker, start, end in segments(data):
        if marker == 0xC0:
            body = data[start + 4 : end]
            return (
                int.from_bytes(body[3:5], "big"),
                int.from_bytes(body[1:3], "big"),
            )
    raise ValueError("no SOF0 in thumbnail")


def _u16(b, i, le):
    return int.from_bytes(b[i : i + 2], "little" if le else "big")


def _u32(b, i, le):
    return int.from_bytes(b[i : i + 4], "little" if le else "big")


def ifd1_thumbnail_span(seg, thumb_data):
    """Replace the IFD1 thumbnail inside an APP1 segment, in place.

    Walks IFD0 for the 0x8769 pointer and the next-IFD link, reads IFD1's
    0x0201/0x0202, and overwrites exactly that span. Offsets are TIFF-relative.
    """
    t = 10  # 2 marker + 2 length + "Exif\0\0"
    le = seg[t : t + 2] == b"II"
    ifd0 = _u32(seg, t + 4, le)
    n = _u16(seg, t + ifd0, le)
    next_ifd = _u32(seg, t + ifd0 + 2 + n * 12, le)
    if not next_ifd:
        return seg, None
    n1 = _u16(seg, t + next_ifd, le)
    off = length = None
    for i in range(n1):
        e = t + next_ifd + 2 + i * 12
        tag = _u16(seg, e, le)
        if tag == 0x0201:
            off = _u32(seg, e + 8, le)
        elif tag == 0x0202:
            length = _u32(seg, e + 8, le)
    if off is None or length is None:
        return seg, None
    w, h = jpeg_dims(seg[t + off : t + off + length])
    seg[t + off : t + off + length] = thumb_data(w, h, length)
    return seg, (t + off, length)


def app13_thumbnail_span(seg, thumb_data):
    """Replace the Photoshop thumbnail resource (0x040C) inside APP13.

    An 8BIM resource is: '8BIM', 2-byte id, Pascal name padded to even, 4-byte
    length, then the data. The 0x040C data is a 28-byte header followed by a
    JPEG — the same thumbnail as IFD1, byte for byte, in the vendor originals.
    """
    i = 4 + 14  # 2 marker + 2 length, then past "Photoshop 3.0\0"
    spans = []
    while i + 12 <= len(seg):
        if seg[i : i + 4] != b"8BIM":
            break
        rid = _u16(seg, i + 4, False)
        name_len = seg[i + 6]
        name_pad = 1 + name_len
        if name_pad % 2:
            name_pad += 1
        data_len = _u32(seg, i + 6 + name_pad, False)
        data_at = i + 6 + name_pad + 4
        if rid == 0x040C and seg[data_at + 28 : data_at + 30] == b"\xff\xd8":
            jpeg = seg[data_at + 28 : data_at + data_len]
            w, h = jpeg_dims(jpeg)
            seg[data_at + 28 : data_at + data_len] = thumb_data(w, h, data_len - 28)
            spans.append((data_at + 28, data_len - 28))
        i = data_at + data_len
        if i % 2:
            i += 1
    return seg, spans


def rebuild(name):
    seed = SEEDS[name]
    path = os.path.join(HERE, name)
    with open(path, "rb") as fh:
        data = bytearray(fh.read())

    w, h, qtables, subsampling = image_params(data)
    img = synth_pixels(w, h, seed)
    encoded = encode(img, qtables, subsampling)

    thumb_cache = {}

    def thumb_data(tw, th, length):
        key = (tw, th, length)
        if key not in thumb_cache:
            thumb_cache[key] = synth_thumbnail(tw, th, seed, length)
        return thumb_cache[key]

    kept = []
    for marker, start, end in segments(data):
        if marker not in KEEP:
            continue
        seg = bytearray(data[start:end])
        if marker == APP1 and seg[4:10] == b"Exif\x00\x00":
            seg, span = ifd1_thumbnail_span(seg, thumb_data)
            print("    APP1 %d bytes, IFD1 thumbnail %s" % (len(seg), span))
        elif marker == APP13:
            seg, spans = app13_thumbnail_span(seg, thumb_data)
            print("    APP13 %d bytes, thumbnail resources %s" % (len(seg), spans))
        kept.append(bytes(seg))

    tail = b"".join(
        bytes(encoded[start:end])
        for marker, start, end in segments(encoded)
        if marker not in KEEP
    )
    out = b"\xff\xd8" + b"".join(kept) + tail
    with open(path, "wb") as fh:
        fh.write(out)
    check = Image.open(path)
    check.load()
    print(
        "  %-24s %dx%d q=%d %s -> %d bytes"
        % (name, w, h, subsampling, "app" * len(kept), len(out))
    )


def write_long_exposure():
    """The one fixture written from scratch, because no rights-clean real file
    has the shape it pins: a 2-second exposure recorded only as ShutterSpeedValue.

    Tv = -1 is stored as an SRATIONAL numerator of -1 — the sign is the whole
    point, and Pillow's TIFF writer picks type 10 for a negative IFDRational on
    its own. A camera that writes ExposureTime would never reach this branch, so
    the file carries no ExposureTime, exactly like partial-exif.jpg carries no
    FNumber.
    """
    name = "long-exposure.jpg"
    w, h = 384, 256
    img = synth_pixels(w, h, SEEDS[name])
    encoded = encode(img, None, 1, quality=88)

    exif = Image.Exif()
    exif[0x010F] = "FixtureCam"
    exif[0x0110] = "FixtureCam Night"
    # IFD0 DateTime is when an editor last wrote the file; the Exif IFD's
    # DateTimeOriginal is when the frame was exposed. They differ here on
    # purpose — read the wrong one and the caption shows a different day.
    exif[0x0132] = "2024:05:06 07:08:09"
    sub = {}
    exif[0x8769] = sub
    sub[0x9003] = "2024:05:05 22:33:44"
    sub[0x9201] = IFDRational(-1, 1)  # APEX Tv = -1 -> 2 s

    tail = b"".join(
        bytes(encoded[start:end])
        for marker, start, end in segments(encoded)
        if marker not in KEEP
    )
    payload = exif.tobytes()  # "Exif\0\0" + TIFF block, without the JPEG framing
    app1 = b"\xff\xe1" + (len(payload) + 2).to_bytes(2, "big") + payload
    out = b"\xff\xd8" + app1 + tail
    path = os.path.join(HERE, name)
    with open(path, "wb") as fh:
        fh.write(out)
    check = Image.open(path)
    check.load()
    print("  %-24s %dx%d fresh -> %d bytes" % (name, w, h, len(out)))


def main():
    print("rebuilding fixture pixels (metadata segments preserved byte for byte)")
    for name in SEEDS:
        if name == "long-exposure.jpg":
            continue
        rebuild(name)
    write_long_exposure()
    return 0


if __name__ == "__main__":
    sys.exit(main())
