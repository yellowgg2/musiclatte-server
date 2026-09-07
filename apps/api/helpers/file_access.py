"""Descriptor-relative metadata access. No descriptor numbers cross process boundaries."""

import contextlib
import hashlib
import json
import os
import stat
import sys


class FileAccessError(Exception):
    """Only closed error codes are emitted by the command boundary."""


def segments(key):
    if not isinstance(key, str) or not key or len(key.encode()) > 4096:
        raise FileAccessError("file_unavailable")
    parts = key.split("/")
    if any(not part or part in (".", "..") or part != part.strip()
           or part.endswith((".", " ")) or len(part.encode()) > 255 for part in parts):
        raise FileAccessError("file_unavailable")
    if any(ord(char) < 32 or ord(char) == 127 or char in "\\:" for char in key):
        raise FileAccessError("file_unavailable")
    return parts


def fingerprint(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
            value.st_ctime_ns, value.st_mode, value.st_nlink, value.st_uid, value.st_gid)


@contextlib.contextmanager
def open_media(root, key, expected_root):
    if not os.path.isabs(root) or root == "/" or os.path.realpath(root) != root:
        raise FileAccessError("file_unavailable")
    parts = segments(key)
    opened = []
    chain = []
    try:
        root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        opened.append(root_fd)
        root_stat = os.fstat(root_fd)
        if (str(root_stat.st_dev), str(root_stat.st_ino)) != (expected_root["device"], expected_root["inode"]):
            raise FileAccessError("file_unavailable")
        parent = root_fd
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            opened.append(child)
            chain.append((parent, part, child))
            parent = child
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        opened.append(fd)
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise FileAccessError("file_unavailable")

        def verify_location():
            current_root = os.stat(root, follow_symlinks=False)
            if (current_root.st_dev, current_root.st_ino) != (root_stat.st_dev, root_stat.st_ino):
                raise FileAccessError("file_unavailable")
            for directory, name, descriptor in chain + [(parent, parts[-1], fd)]:
                linked = os.stat(name, dir_fd=directory, follow_symlinks=False)
                actual = os.fstat(descriptor)
                if (linked.st_dev, linked.st_ino) != (actual.st_dev, actual.st_ino) or stat.S_ISLNK(linked.st_mode):
                    raise FileAccessError("file_unavailable")

        verify_location()
        yield fd, parent, parts[-1], verify_location
    finally:
        for descriptor in reversed(opened):
            os.close(descriptor)


def digest_fd(fd, max_bytes):
    before = os.fstat(fd)
    if before.st_size > max_bytes:
        raise FileAccessError("file_too_large")
    os.lseek(fd, 0, os.SEEK_SET)
    digest = hashlib.sha256()
    size = 0
    while True:
        chunk = os.read(fd, 1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > max_bytes:
            raise FileAccessError("file_too_large")
        digest.update(chunk)
    after = os.fstat(fd)
    if fingerprint(before) != fingerprint(after) or size != after.st_size:
        raise FileAccessError("read_unstable")
    return digest.hexdigest(), after


def inspect(request):
    for attempt in range(2):
        try:
            with open_media(request["root"], request["key"], request["rootIdentity"]) as (fd, parent, name, verify):
                digest, info = digest_fd(fd, request["maxFileBytes"])
                verify()
                return {"schemaVersion": 1, "digest": digest, "size": info.st_size,
                        "device": str(info.st_dev), "inode": str(info.st_ino),
                        "mtimeNs": str(info.st_mtime_ns), "ctimeNs": str(info.st_ctime_ns),
                        "mode": stat.S_IMODE(info.st_mode), "uid": info.st_uid, "gid": info.st_gid,
                        "nlink": info.st_nlink,
                        "writable": info.st_nlink == 1 and bool(info.st_mode & 0o222)}
        except FileAccessError as error:
            if str(error) != "read_unstable" or attempt == 1:
                raise


def main():
    try:
        if sys.version_info < (3, 10):
            raise FileAccessError("helper_unavailable")
        payload = sys.stdin.buffer.read(16385)
        if len(payload) > 16384:
            raise FileAccessError("file_unavailable")
        request = json.loads(payload)
        if set(request) != {"root", "key", "rootIdentity", "maxFileBytes"}:
            raise FileAccessError("file_unavailable")
        result = inspect(request)
    except FileAccessError as error:
        result = {"error": str(error)}
    except Exception:
        result = {"error": "file_unavailable"}
    sys.stdout.write(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
