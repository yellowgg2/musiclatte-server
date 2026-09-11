"""Descriptor-relative, same-filesystem organization rename helper."""

import hashlib
import json
import os
import stat
import sys
import unicodedata


class MoveError(Exception):
    pass


def parts(key):
    if not isinstance(key, str) or not key or len(key.encode()) > 4096:
        raise MoveError("unsafe_target")
    value = key.split("/")
    if any(not part or part in (".", "..") or part != part.strip()
           or part.endswith((".", " ")) or len(part.encode()) > 255 for part in value):
        raise MoveError("unsafe_target")
    if any(ord(char) < 32 or ord(char) == 127 or char in "\\:" for char in key):
        raise MoveError("unsafe_target")
    return value


def equivalent(left, right):
    return unicodedata.normalize("NFC", left).casefold() == unicodedata.normalize("NFC", right).casefold()


def named(parent, name):
    matches = [entry for entry in os.listdir(parent) if equivalent(entry, name)]
    if len(matches) > 1 or (matches and matches[0] != name):
        raise MoveError("destination_conflict")
    return bool(matches)


def directory_chain(root_fd, names, create, target):
    opened = []
    current = root_fd
    try:
        for name in names:
            exists = named(current, name)
            if not exists:
                if not create:
                    return None, opened
                os.mkdir(name, 0o750, dir_fd=current)
            try:
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
            except OSError as error:
                raise MoveError("unsafe_target" if target else "file_unavailable") from error
            opened.append(child)
            current = child
        return current, opened
    except Exception:
        for descriptor in reversed(opened):
            os.close(descriptor)
        raise


def digest_fd(fd, maximum):
    before = os.fstat(fd)
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > maximum:
        raise MoveError("file_unavailable")
    os.lseek(fd, 0, os.SEEK_SET)
    output = hashlib.sha256()
    size = 0
    while True:
        chunk = os.read(fd, 1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > maximum:
            raise MoveError("file_unavailable")
        output.update(chunk)
    after = os.fstat(fd)
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != \
       (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise MoveError("file_unavailable")
    return output.hexdigest(), after


def open_file(parent, name, maximum):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    try:
        digest, info = digest_fd(fd, maximum)
        return fd, digest, info
    except Exception:
        os.close(fd)
        raise


def identity(digest, info):
    return {"digest": digest, "device": str(info.st_dev), "inode": str(info.st_ino),
            "mode": stat.S_IMODE(info.st_mode), "uid": info.st_uid, "gid": info.st_gid,
            "size": info.st_size}


def root_descriptor(request):
    root = request["root"]
    if not os.path.isabs(root) or root == "/" or os.path.realpath(root) != root:
        raise MoveError("file_unavailable")
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    info = os.fstat(fd)
    expected = request["rootIdentity"]
    if (str(info.st_dev), str(info.st_ino)) != (expected["device"], expected["inode"]):
        os.close(fd)
        raise MoveError("file_unavailable")
    return fd


def source(request, root_fd):
    values = parts(request["sourceKey"])
    parent, opened = directory_chain(root_fd, values[:-1], False, False)
    if parent is None:
        raise MoveError("file_unavailable")
    try:
        fd, digest, info = open_file(parent, values[-1], request["maxFileBytes"])
        return values[-1], parent, opened, fd, digest, info
    except Exception:
        for descriptor in reversed(opened):
            os.close(descriptor)
        raise


def target_parent(request, root_fd, create):
    values = parts(request["targetKey"])
    parent, opened = directory_chain(root_fd, values[:-1], create, True)
    return values[-1], parent, opened


def close_all(*groups):
    seen = set()
    for group in groups:
        for descriptor in reversed(group):
            if descriptor not in seen:
                seen.add(descriptor)
                os.close(descriptor)


def prepare(request, root_fd):
    name, parent, source_dirs, fd, digest, info = source(request, root_fd)
    del name, parent
    target_dirs = []
    try:
        target_name, target, target_dirs = target_parent(request, root_fd, True)
        if target is None or named(target, target_name):
            raise MoveError("destination_conflict")
        target_info = os.fstat(target)
        return {"state": "ready", **identity(digest, info),
                "targetParentDevice": str(target_info.st_dev),
                "targetParentInode": str(target_info.st_ino)}
    finally:
        os.close(fd)
        close_all(source_dirs, target_dirs)


def matches(expected, digest, info):
    actual = identity(digest, info)
    return all(actual[key] == expected[key] for key in ("digest", "device", "inode", "mode", "uid", "gid"))


def move(request, root_fd):
    source_name, source_parent, source_dirs, fd, digest, info = source(request, root_fd)
    target_dirs = []
    try:
        if not matches(request["expected"], digest, info):
            raise MoveError("identity_mismatch")
        target_name, target, target_dirs = target_parent(request, root_fd, True)
        if target is None or named(target, target_name):
            raise MoveError("destination_conflict")
        target_info = os.fstat(target)
        if (str(target_info.st_dev), str(target_info.st_ino)) != \
           (request["expected"]["targetParentDevice"], request["expected"]["targetParentInode"]):
            raise MoveError("unsafe_target")
        if os.fstat(source_parent).st_dev != os.fstat(target).st_dev:
            raise MoveError("cross_device")
        if request.get("crashAt") == "before_rename":
            os._exit(70)
        os.rename(source_name, target_name, src_dir_fd=source_parent, dst_dir_fd=target)
        if request.get("crashAt") == "after_rename":
            os._exit(71)
        os.fsync(source_parent)
        if target != source_parent:
            os.fsync(target)
        if request.get("crashAt") == "after_fsync":
            os._exit(72)
        target_fd, after_digest, after = open_file(target, target_name, request["maxFileBytes"])
        try:
            if not matches(request["expected"], after_digest, after):
                raise MoveError("identity_mismatch")
            try:
                os.stat(source_name, dir_fd=source_parent, follow_symlinks=False)
                raise MoveError("move_uncertain")
            except FileNotFoundError:
                pass
            return {"state": "moved", **identity(after_digest, after)}
        finally:
            os.close(target_fd)
    finally:
        os.close(fd)
        close_all(source_dirs, target_dirs)


def inspect_optional(request, root_fd, key):
    values = parts(key)
    parent, opened = directory_chain(root_fd, values[:-1], False, True)
    if parent is None:
        return None
    try:
        if not named(parent, values[-1]):
            return None
        fd, digest, info = open_file(parent, values[-1], request["maxFileBytes"])
        try:
            return digest, info
        finally:
            os.close(fd)
    finally:
        close_all(opened)


def classify(request, root_fd):
    try:
        source_value = inspect_optional(request, root_fd, request["sourceKey"])
        target_value = inspect_optional(request, root_fd, request["targetKey"])
        if bool(source_value) == bool(target_value):
            return {"state": "ambiguous"}
        value = source_value or target_value
        if value is None or not matches(request["expected"], value[0], value[1]):
            return {"state": "ambiguous"}
        return {"state": "source_only" if source_value else "target_only"}
    except Exception:
        return {"state": "ambiguous"}


def main():
    root_fd = None
    try:
        raw = sys.stdin.buffer.read(16385)
        if len(raw) > 16384:
            raise MoveError("file_unavailable")
        request = json.loads(raw)
        root_fd = root_descriptor(request)
        action = request["action"]
        result = prepare(request, root_fd) if action == "prepare" else \
            move(request, root_fd) if action == "move" else classify(request, root_fd)
    except MoveError as error:
        result = {"error": str(error)}
    except Exception:
        result = {"error": "file_unavailable"}
    finally:
        if root_fd is not None:
            os.close(root_fd)
    sys.stdout.write(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
