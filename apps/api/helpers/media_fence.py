"""Shared cooperative OS fence. This helper never edits media or tags."""
import contextlib
import fcntl
import json
import os
import stat
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from file_access import FileAccessError


def fail(code):
    raise FileAccessError(code)


@contextlib.contextmanager
def media_fence(root, root_identity, identity):
    if not isinstance(identity, str) or len(identity) != 64 or any(c not in "0123456789abcdef" for c in identity):
        fail("invalid_fence")
    if not os.path.isabs(root) or root == "/" or os.path.realpath(root) != root:
        fail("invalid_fence")
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    lock = None
    try:
        info = os.fstat(directory)
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077:
            fail("permission_changed")
        if (str(info.st_dev), str(info.st_ino)) != (root_identity["device"], root_identity["inode"]):
            fail("fence_lost")
        name = identity + ".lock"
        lock = os.open(name, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=directory)
        locked = os.fstat(lock)
        if not stat.S_ISREG(locked.st_mode) or locked.st_nlink != 1 or locked.st_uid != os.geteuid() or stat.S_IMODE(locked.st_mode) & 0o077:
            fail("permission_changed")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail("file_busy")
        def verify():
            current = os.stat(root, follow_symlinks=False)
            linked = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino) or current.st_uid != os.geteuid() or stat.S_IMODE(current.st_mode) & 0o077 or stat.S_ISLNK(current.st_mode):
                fail("fence_lost")
            if (linked.st_dev, linked.st_ino) != (locked.st_dev, locked.st_ino) or linked.st_nlink != 1 or not stat.S_ISREG(linked.st_mode) or stat.S_IMODE(linked.st_mode) & 0o077:
                fail("fence_lost")
        verify()
        yield verify
    finally:
        if lock is not None:
            os.close(lock)
        os.close(directory)


def emit(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)


def read():
    line = sys.stdin.buffer.readline(4097)
    if not line or len(line) > 4096:
        fail("fence_lost")
    return json.loads(line)


def main():
    request = read()
    if set(request) != {"root", "rootIdentity", "fileIdentity", "nonce", "purpose"} or request["purpose"] not in ("verify", "publish", "recover"):
        fail("invalid_fence")
    nonce = request["nonce"]
    if not isinstance(nonce, str) or len(nonce) != 36:
        fail("invalid_fence")
    with media_fence(request["root"], request["rootIdentity"], request["fileIdentity"]) as verify:
        emit({"stage": "held", "nonce": nonce})
        for _ in range(1000):
            command = read()
            if command == {"ack": "release", "nonce": nonce}:
                verify()
                emit({"stage": "released", "nonce": nonce})
                return
            if command != {"ack": "validate", "nonce": nonce}:
                fail("invalid_fence")
            verify()
            emit({"stage": "validated", "nonce": nonce})
        fail("invalid_fence")


if __name__ == "__main__":
    try:
        main()
    except FileAccessError as error:
        emit({"error": str(error)})
    except Exception:
        emit({"error": "fence_lost"})
