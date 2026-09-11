"""Private MP3 read/prepare helper. Only agent-owned candidates may be edited."""

import base64
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from file_access import FileAccessError, digest_fd, fingerprint, open_media
from mutagen import version_string
from mutagen.id3 import ID3, ID3NoHeaderError, TIT2, TPE1, TALB, TPE2, TRCK, TYER, TDRC, TCON, USLT, APIC

FIELDS = {"title": TIT2, "artist": TPE1, "album": TALB, "albumArtist": TPE2,
          "trackNumber": TRCK, "genre": TCON}
ERRORS = {"file_unavailable", "read_unstable", "file_too_large", "invalid_metadata",
          "unsupported_tag_layout", "unsupported_format", "invalid_cover", "ambiguous_selector",
          "revision_conflict", "audio_mismatch", "helper_unavailable"}


def fail(code="invalid_metadata"):
    raise FileAccessError(code)


def closed(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        fail()
    return value


def text(value, limit=4096, empty=False):
    if not isinstance(value, str) or len(value) > limit or "\0" in value or (not empty and not value.strip()):
        fail()
    return value


def run_small(executable, args, fd, limit=65536):
    os.lseek(fd, 0, os.SEEK_SET)
    process = subprocess.Popen([executable, *args], stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, pass_fds=(fd,))
    try:
        data = process.stdout.read(limit + 1)
        if len(data) > limit:
            fail("unsupported_tag_layout")
        if process.wait() != 0:
            fail("invalid_metadata")
        return data
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        process.stdout.close()


def audio_probe(fd, request):
    path = "/dev/fd/" + str(fd)
    raw = run_small(request["ffprobe"], ["-v", "error", "-select_streams", "a", "-show_entries",
                    "stream=codec_name,sample_rate,channels,duration", "-of", "json", path], fd)
    streams = json.loads(raw).get("streams", [])
    if len(streams) != 1 or streams[0].get("codec_name") != "mp3":
        fail("unsupported_format")
    stream = streams[0]
    os.lseek(fd, 0, os.SEEK_SET)
    process = subprocess.Popen([request["ffprobe"], "-v", "error", "-select_streams", "a:0",
                                "-show_packets", "-show_entries", "packet=size,data_hash",
                                "-show_data_hash", "sha256", "-of", "compact=p=0:nk=0", path],
                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, pass_fds=(fd,))
    digest = hashlib.sha256()
    count = 0
    try:
        while True:
            line = process.stdout.readline(4097)
            if not line:
                break
            if len(line) > 4096:
                fail("invalid_metadata")
            parts = dict(part.split("=", 1) for part in line.decode().strip().split("|") if "=" in part)
            if "size" not in parts or "data_hash" not in parts:
                continue
            if not parts["size"].isdigit() or not re.fullmatch(r"SHA256:[a-fA-F0-9]{64}", parts["data_hash"]):
                fail("invalid_metadata")
            digest.update((parts["size"] + ":" + parts["data_hash"] + "\n").encode())
            count += 1
        if process.wait() != 0 or count == 0:
            fail("invalid_metadata")
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        process.stdout.close()
    run_small(request["ffmpeg"], ["-v", "error", "-xerror", "-nostdin", "-i", path,
              "-map", "0:a:0", "-f", "null", "-"], fd)
    return {"codec": "mp3", "sampleRate": str(stream["sample_rate"]), "channels": stream["channels"],
            "duration": stream.get("duration"), "packetHash": digest.hexdigest(), "packetCount": count}


def load_tags(fd):
    os.lseek(fd, 0, os.SEEK_SET)
    header = os.read(fd, 10)
    major = header[3] if header[:3] == b"ID3" and len(header) == 10 else 0
    if major:
        if any(byte & 128 for byte in header[6:10]):
            fail("unsupported_tag_layout")
        size = sum(byte << shift for byte, shift in zip(header[6:10], [21, 14, 7, 0]))
        if size > 16 * 1024 * 1024 or size + 10 > os.fstat(fd).st_size:
            fail("unsupported_tag_layout")
    with os.fdopen(os.dup(fd), "rb") as source:
        source.seek(0)
        try:
            tags = ID3(source, translate=False, load_v1=False)
        except ID3NoHeaderError:
            if major:
                fail("unsupported_tag_layout")
            tags = ID3()
    return tags, major


def normalize(value):
    if isinstance(value, bytes):
        return {"sha256": hashlib.sha256(value).hexdigest(), "size": len(value)}
    if isinstance(value, (list, tuple)):
        return [normalize(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize(item) for key, item in sorted(value.items()) if key != "encoding"}
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def frame_values(tags):
    return {key: normalize(vars(frame)) for key, frame in tags.items()}


def snapshot(fd, request):
    full_digest, before = digest_fd(fd, request["maxFileBytes"])
    tags, major = load_tags(fd)
    values = {}
    for field, klass in FIELDS.items():
        frames = tags.getall(klass.__name__)
        entries = [str(item) for frame in frames for item in frame.text]
        values[field] = entries if field in ("artist", "albumArtist", "genre") else (entries[0] if entries else None)
    years = tags.getall("TYER" if major == 3 else "TDRC")
    values["year"] = str(years[0].text[0]) if years and years[0].text else None
    covers = [{"frameId": hashlib.sha256(frame.HashKey.encode()).hexdigest(), "description": frame.desc,
               "pictureType": int(frame.type), "mimeType": frame.mime,
               "digest": hashlib.sha256(frame.data).hexdigest()} for frame in tags.getall("APIC")]
    lyrics = [{"selector": {"language": frame.lang, "description": frame.desc}, "text": frame.text}
              for frame in tags.getall("USLT")]
    result = {"id3Version": major, "editable": major in (0, 3, 4),
              "reason": None if major in (0, 3, 4) else "unsupported_tag_layout",
              "values": values, "coverFrames": sorted(covers, key=lambda frame: frame["description"]),
              "lyricsFrames": sorted(lyrics, key=lambda frame: (frame["selector"]["language"], frame["selector"]["description"])),
              "fullDigest": full_digest, "audio": audio_probe(fd, request)}
    if fingerprint(before) != fingerprint(os.fstat(fd)):
        fail("read_unstable")
    return result, tags


def image_data(request):
    target = request.get("cover")
    if not target:
        fail("invalid_cover")
    try:
        with open_media(target["root"], target["key"], target["rootIdentity"]) as (fd, parent, name, verify):
            digest, before = digest_fd(fd, 8 * 1024 * 1024)
            if "expectedDigest" in target and digest != target["expectedDigest"]:
                fail("invalid_cover")
            os.lseek(fd, 0, os.SEEK_SET)
            data = os.read(fd, before.st_size)
            mime = "image/png" if data.startswith(b"\x89PNG\r\n\x1a\n") else "image/jpeg" if data.startswith(b"\xff\xd8\xff") else None
            if not mime:
                fail("invalid_cover")
            path = "/dev/fd/" + str(fd)
            output = run_small(request["ffprobe"], ["-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "json", path], fd)
            streams = json.loads(output).get("streams", [])
            if len(streams) != 1 or streams[0].get("codec_name") not in ("png", "mjpeg"):
                fail("invalid_cover")
            width, height = streams[0].get("width", 0), streams[0].get("height", 0)
            if width < 1 or height < 1 or width * height > 16000000:
                fail("invalid_cover")
            run_small(request["ffmpeg"], ["-v", "error", "-xerror", "-nostdin", "-i", path, "-frames:v", "1", "-f", "null", "-"], fd)
            verify()
            if fingerprint(before) != fingerprint(os.fstat(fd)):
                fail("invalid_cover")
            return data, mime
    except Exception:
        fail("invalid_cover")


def apply_patch(tags, major, patch, request):
    if not isinstance(patch, dict) or not patch or set(patch) - (set(FIELDS) | {"year", "cover", "lyrics"}):
        fail()
    touched = set()
    encoding = 1 if major == 3 else 3
    for field, operation in patch.items():
        if not isinstance(operation, dict):
            fail()
        allowed = ("set", "clear", "replaceAll", "clearAll") if field == "cover" else ("set", "clear")
        if operation.get("op") not in allowed:
            fail()
        setting = operation["op"] in ("set", "replaceAll")
        if field in FIELDS or field == "year":
            closed(operation, ["op", "value"] if setting else ["op"])
            klass = (TYER if major == 3 else TDRC) if field == "year" else FIELDS[field]
            value = operation.get("value")
            if setting:
                if field in ("artist", "albumArtist", "genre"):
                    if not isinstance(value, list) or not 1 <= len(value) <= 32:
                        fail()
                    entries = [text(item) for item in value]
                else:
                    entries = [text(value)]
                if field == "trackNumber":
                    if not re.fullmatch(r"[1-9][0-9]*(/[1-9][0-9]*)?", value):
                        fail()
                    numbers = [int(part) for part in value.split("/")]
                    if len(numbers) == 2 and numbers[0] > numbers[1]:
                        fail()
                if field == "year":
                    if not re.fullmatch(r"[0-9]{4}", value) or int(value) == 0:
                        fail()
                    old = tags.getall(klass.__name__)
                    previous = str(old[0].text[0]) if old and old[0].text else ""
                    if major == 4 and len(previous) > 4:
                        candidate = value + previous[4:]
                        try:
                            if len(candidate) == 7:
                                datetime.date(int(candidate[:4]), int(candidate[5:7]), 1)
                            else:
                                datetime.datetime.fromisoformat(candidate)
                        except ValueError:
                            fail()
                        entries = [candidate]
            touched.update(frame.HashKey for frame in tags.getall(klass.__name__))
            tags.delall(klass.__name__)
            if setting:
                frame = klass(encoding=encoding, text=entries)
                tags.add(frame)
                touched.add(frame.HashKey)
        elif field == "lyrics":
            closed(operation, ["op", "selector", "text"] if setting else ["op", "selector"])
            selector = closed(operation["selector"], ["language", "description"])
            language, description = text(selector["language"]), text(selector["description"], 256, True)
            if not re.fullmatch(r"[a-z]{3}", language):
                fail()
            key = USLT(lang=language, desc=description).HashKey
            touched.add(key)
            tags.pop(key, None)
            if setting:
                words = text(operation["text"], 100000)
                if len(words.encode()) > 256 * 1024:
                    fail()
                tags.add(USLT(encoding=encoding, lang=language, desc=description, text=words))
        else:
            if operation["op"] in ("replaceAll", "clearAll"):
                closed(operation, ["op", "uploadId"] if setting else ["op"])
                data, mime = image_data(request) if setting else (None, None)
                if setting and mime != "image/jpeg":
                    fail("invalid_cover")
                existing = list(tags.getall("APIC"))
                touched.update(frame.HashKey for frame in existing)
                tags.delall("APIC")
                if setting:
                    frame = APIC(encoding=encoding, mime="image/jpeg", type=3,
                                 desc="Musiclatte official front cover", data=data)
                    tags.add(frame)
                    touched.add(frame.HashKey)
                continue
            closed(operation, ["op", "selector", "uploadId"] if setting else ["op", "selector"])
            selector = operation["selector"]
            if not isinstance(selector, dict) or selector.get("kind") not in ("front", "new"):
                fail()
            if selector["kind"] == "front":
                closed(selector, ["kind", "description"])
                description = text(selector["description"], 256, True)
                matches = [frame for frame in tags.getall("APIC") if frame.type == 3 and frame.desc == description]
                if len(matches) != 1:
                    fail("ambiguous_selector")
                key = matches[0].HashKey
            else:
                closed(selector, ["kind"])
                if not setting:
                    fail()
                description = "Musiclatte front cover"
                while APIC(desc=description).HashKey in tags:
                    description += "-new"
                key = APIC(desc=description).HashKey
            data, mime = image_data(request) if setting else (None, None)
            touched.add(key)
            tags.pop(key, None)
            if setting:
                tags.add(APIC(encoding=encoding, mime=mime, type=3, desc=description, data=data))
    return touched


def preview_values(tags, major, field, patch):
    if field == "cover":
        frames = sorted(tags.getall("APIC"), key=lambda f: (f.desc, f.HashKey))
        return ([f.desc for f in frames], [(f.HashKey, hashlib.sha256(f.data).hexdigest()) for f in frames])
    if field == "lyrics":
        frames = sorted(tags.getall("USLT"), key=lambda f: f.HashKey)
        return ([f.text for f in frames], [(f.HashKey, f.text) for f in frames])
    name = ("TYER" if major == 3 else "TDRC") if field == "year" else FIELDS[field].__name__
    values = [str(v) for f in tags.getall(name) for v in f.text]
    return (values, values)


def execute(request):
    if version_string != "1.48.1" or request.get("schemaVersion") != 1 or request.get("action") not in ("read", "prepare", "preview", "cover", "validate-cover"):
        fail("helper_unavailable")
    if request["action"] == "validate-cover":
        request["cover"] = {"root": request["root"], "rootIdentity": request["rootIdentity"], "key": request["key"]}
        data, mime = image_data(request)
        return {"digest": hashlib.sha256(data).hexdigest(), "mimeType": mime, "size": len(data)}
    preparing = request["action"] == "prepare"
    key = request["key"]
    if preparing and (not key.endswith(".metadata-pending") or not re.fullmatch(r"[a-f0-9]{64}", request.get("expectedDigest", ""))):
        fail()
    with open_media(request["root"], key, request["rootIdentity"], writable=preparing) as (fd, parent, name, verify):
        before, tags = snapshot(fd, request)
        verify()
        if request["action"] == "read":
            return before
        if before["fullDigest"] != request.get("expectedDigest"):
            fail("revision_conflict")
        if request["action"] == "cover":
            frames = [frame for frame in tags.getall("APIC") if hashlib.sha256(frame.HashKey.encode()).hexdigest() == request.get("frameId")]
            if len(frames) != 1:
                fail("ambiguous_selector")
            frame = frames[0]
            mime = "image/png" if frame.data.startswith(b"\x89PNG\r\n\x1a\n") else "image/jpeg" if frame.data.startswith(b"\xff\xd8\xff") else None
            if not mime or mime != frame.mime or len(frame.data) > 8 * 1024 * 1024:
                fail("invalid_cover")
            if digest_fd(fd, request["maxFileBytes"])[0] != before["fullDigest"]:
                fail("read_unstable")
            verify()
            return {"mimeType": mime, "data": base64.b64encode(frame.data).decode()}
        if not before["editable"]:
            fail("unsupported_tag_layout")
        if before["fullDigest"] != request["expectedDigest"]:
            fail("revision_conflict")
        if os.fstat(fd).st_nlink != 1:
            fail("file_unavailable")
        major = before["id3Version"] or 4
        untouched = frame_values(tags)
        unknown = list(tags.unknown_frames)
        preview_before = {field: preview_values(tags, major, field, patch) for field, patch in request["patch"].items()}
        touched = apply_patch(tags, major, request["patch"], request)
        if request["action"] == "preview":
            if digest_fd(fd, request["maxFileBytes"])[0] != before["fullDigest"]:
                fail("read_unstable")
            verify()
            diff = []
            for field, patch in request["patch"].items():
                previous, previous_identity = preview_before[field]
                following, following_identity = preview_values(tags, major, field, patch)
                diff.append({"field": field, "op": patch["op"], "before": previous, "after": following,
                             "status": "no_change" if previous_identity == following_identity else "changed"})
            return {"valid": True, "changedFields": list(request["patch"]), "diff": diff}
        expected = frame_values(tags)
        size = os.fstat(fd).st_size
        os.lseek(fd, max(0, size - 128), os.SEEK_SET)
        trailing = os.read(fd, 128)
        trailing = trailing if len(trailing) == 128 and trailing[:3] == b"TAG" else b""
        with os.fdopen(os.dup(fd), "r+b") as candidate:
            candidate.seek(0)
            tags.save(candidate, v2_version=major, v23_sep=None, v1=0)
            if trailing:
                candidate.seek(0, os.SEEK_END)
                candidate.write(trailing)
            candidate.flush()
        after, readback = snapshot(fd, request)
        verify()
        if before["audio"] != after["audio"]:
            fail("audio_mismatch")
        actual = frame_values(readback)
        if any(actual.get(key) != value for key, value in untouched.items() if key not in touched) or list(readback.unknown_frames) != unknown:
            fail("unsupported_tag_layout")
        if any(actual.get(key) != expected.get(key) for key in touched):
            fail("unsupported_tag_layout")
        return {"audioPreserved": True, "untouchedFramesPreserved": True, "snapshot": after}


def main():
    try:
        payload = sys.stdin.buffer.read(1024 * 1024 + 1)
        if len(payload) > 1024 * 1024:
            fail()
        result = execute(json.loads(payload))
        output = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
        if len(output.encode()) > (12 * 1024 * 1024 if result.get("data") else 1024 * 1024):
            fail("unsupported_tag_layout")
    except FileAccessError as error:
        output = json.dumps({"error": str(error) if str(error) in ERRORS else "invalid_metadata"})
    except Exception:
        output = json.dumps({"error": "invalid_metadata"})
    sys.stdout.write(output)


if __name__ == "__main__":
    main()
