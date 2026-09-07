"""One OS-locked process owns backup, candidate, publish and receipt acknowledgement."""
import contextlib
import fcntl
import hashlib
import json
import os
import secrets
import stat
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from file_access import FileAccessError, digest_fd, fingerprint, open_media
from metadata import execute as prepare_metadata, snapshot


def fail(code):
    raise FileAccessError(code)


def emit(value):
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")), flush=True)


def ack(stage, generation):
    line = sys.stdin.buffer.readline(4097)
    if not line or len(line) > 4096:
        fail("worker_interrupted")
    value = json.loads(line)
    if value != {"ack": stage, "generation": generation}:
        fail("worker_interrupted")


def write_all(fd, data):
    while data:
        count = os.write(fd, data)
        if count <= 0:
            fail("write_failed")
        data = data[count:]


def copy_fd(source, target, limit):
    before = os.fstat(source)
    os.lseek(source, 0, os.SEEK_SET)
    total = 0
    while True:
        data = os.read(source, 1024 * 1024)
        if not data:
            break
        total += len(data)
        if total > limit:
            fail("file_too_large")
        write_all(target, data)
    if fingerprint(before) != fingerprint(os.fstat(source)):
        fail("revision_conflict")
    os.fsync(target)


def journal_write(directory, name, value):
    temporary = name + "." + secrets.token_hex(12)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
    try:
        write_all(fd, json.dumps(value, separators=(",", ":")).encode())
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(temporary, name, src_dir_fd=directory, dst_dir_fd=directory)
    os.fsync(directory)


def journal_read(directory, name):
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
    except FileNotFoundError:
        return None
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode) or os.fstat(fd).st_size > 65536:
            fail("recovery_required")
        return json.loads(os.read(fd, 65537))
    finally:
        os.close(fd)


def permissions(fd):
    info = os.fstat(fd)
    if info.st_nlink != 1 or not info.st_mode & 0o222 or info.st_mode & 0o7000 or getattr(info, "st_flags", 0):
        fail("permission_changed")
    # Extended attributes/ACLs are outside the supported simple POSIX ownership profile.
    if sys.platform == "darwin":
        import ctypes
        libc = ctypes.CDLL(None, use_errno=True)
        libc.flistxattr.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int]
        libc.flistxattr.restype = ctypes.c_ssize_t
        if libc.flistxattr(fd, None, 0, 0) != 0:
            fail("permission_changed")
        libc.acl_get_fd_np.argtypes = [ctypes.c_int, ctypes.c_int]
        libc.acl_get_fd_np.restype = ctypes.c_void_p
        libc.acl_get_entry.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_void_p)]
        libc.acl_free.argtypes = [ctypes.c_void_p]
        acl = libc.acl_get_fd_np(fd, 0x100)
        if not acl:
            if ctypes.get_errno() == 2:
                return info
            fail("permission_changed")
        try:
            entry = ctypes.c_void_p()
            if libc.acl_get_entry(acl, 0, ctypes.byref(entry)) == 0:
                fail("permission_changed")
        finally:
            libc.acl_free(acl)
    elif sys.platform != "linux" or os.listxattr(fd):
        fail("permission_changed")
    return info


def transaction(request):
    if request.get("schemaVersion") != 1 or request.get("action") not in ("execute", "recover"):
        fail("invalid_metadata")
    private = request["privateRoot"]
    if os.path.realpath(private) != private or not os.path.isabs(private) or private == "/":
        fail("file_unavailable")
    if os.path.commonpath([private, request["root"]]) in (private, request["root"]):
        fail("file_unavailable")
    directory = os.open(private, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    lock_fd = None
    try:
        info = os.fstat(directory)
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077:
            fail("permission_changed")
        if (str(info.st_dev), str(info.st_ino)) != (request["privateRootIdentity"]["device"], request["privateRootIdentity"]["inode"]):
            fail("file_unavailable")
        def verify_private():
            linked = os.stat(private, follow_symlinks=False)
            if (linked.st_dev, linked.st_ino) != (info.st_dev, info.st_ino) or stat.S_ISLNK(linked.st_mode):
                fail("recovery_required")
        identity = request["fileIdentity"]
        if len(identity) != 64 or any(c not in "0123456789abcdef" for c in identity):
            fail("invalid_metadata")
        lock_fd = os.open(identity + ".lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        if not stat.S_ISREG(os.fstat(lock_fd).st_mode) or os.fstat(lock_fd).st_nlink != 1:
            fail("file_unavailable")
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail("file_busy")
        opaque = hashlib.sha256(request["itemId"].encode()).hexdigest()
        name = opaque + ".json"
        previous = journal_read(directory, name)
        with open_media(request["root"], request["key"], request["rootIdentity"]) as (source, parent, leaf, verify):
            current, original_stat = digest_fd(source, request["maxFileBytes"])
            verify()
            if request["action"] == "recover":
                if previous is None:
                    state = "preimage" if current == request["expectedDigest"] else "recovery_required"
                elif previous["fileIdentity"] != identity or previous["key"] != request["key"] or previous["preimageDigest"] != request["expectedDigest"]:
                    fail("recovery_required")
                else:
                    with open_media(private, previous["backup"]["relativeKey"], request["privateRootIdentity"]) as (saved_backup, _, __, check_backup):
                        if digest_fd(saved_backup, request["maxFileBytes"])[0] != previous["preimageDigest"]:
                            fail("recovery_required")
                        check_backup()
                    if current == previous.get("candidateDigest"):
                        state = "file_saved"
                        os.fsync(parent)
                    elif current == previous["preimageDigest"]:
                        state = "preimage"
                    else:
                        state = "recovery_required"
                verify_private()
                emit({"stage": "recovered", "state": state, "digest": current, "intent": previous})
                return
            if previous is not None:
                fail("recovery_required")
            if current != request["expectedDigest"]:
                fail("revision_conflict")
            original_stat = permissions(source)
            before_snapshot, _ = snapshot(source, request)
            backup_name = opaque + ".backup"
            backup_fd = os.open(backup_name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            try:
                copy_fd(source, backup_fd, request["maxFileBytes"])
                if digest_fd(backup_fd, request["maxFileBytes"])[0] != current:
                    fail("backup_failed")
            finally:
                os.close(backup_fd)
            os.fsync(directory)
            backup = {"id": opaque, "relativeKey": backup_name, "preimageDigest": current,
                      "size": original_stat.st_size, "mode": stat.S_IMODE(original_stat.st_mode),
                      "ownerProfile": {"uid": original_stat.st_uid, "gid": original_stat.st_gid}}
            candidate_name = ".musiclatte-" + secrets.token_hex(24) + ".metadata-pending"
            candidate_key = "/".join(request["key"].split("/")[:-1] + [candidate_name])
            intent = {"fileIdentity": identity, "key": request["key"], "preimageDigest": current,
                      "backup": backup, "candidateKey": candidate_key, "candidateDigest": None}
            journal_write(directory, name, intent)
            verify_private()
            emit({"stage": "backup_verified", "backup": backup})
            ack("backup_verified", request["generation"])
            candidate = os.open(candidate_name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
            try:
                restore = request.get("restore")
                if restore:
                    with open_media(private, restore["relativeKey"], request["privateRootIdentity"]) as (restored, _, __, check):
                        if digest_fd(restored, request["maxFileBytes"])[0] != restore["digest"]:
                            fail("restore_unavailable")
                        copy_fd(restored, candidate, request["maxFileBytes"])
                        check()
                    candidate_snapshot, _ = snapshot(candidate, request)
                    if candidate_snapshot["fullDigest"] != restore["digest"] or candidate_snapshot["audio"] != before_snapshot["audio"]:
                        fail("audio_mismatch")
                else:
                    copy_fd(source, candidate, request["maxFileBytes"])
                    prepared = prepare_metadata({**request, "action": "prepare", "key": candidate_key})
                    candidate_snapshot = prepared["snapshot"]
                if request["preserveOwnership"]:
                    candidate_stat = os.fstat(candidate)
                    if (candidate_stat.st_uid, candidate_stat.st_gid) != (original_stat.st_uid, original_stat.st_gid):
                        os.fchown(candidate, original_stat.st_uid, original_stat.st_gid)
                os.fchmod(candidate, stat.S_IMODE(original_stat.st_mode))
                candidate_stat = permissions(candidate)
                if request["preserveOwnership"] and (candidate_stat.st_uid, candidate_stat.st_gid) != (original_stat.st_uid, original_stat.st_gid):
                    fail("permission_changed")
                os.utime(candidate, ns=(time.time_ns(), max(time.time_ns(), original_stat.st_mtime_ns + 2000000000)))
                os.fsync(candidate)
                intent["candidateDigest"] = candidate_snapshot["fullDigest"]
                journal_write(directory, name, intent)
                emit({"stage": "candidate_verified", "digest": intent["candidateDigest"], "candidateKey": candidate_key})
                ack("candidate_verified", request["generation"])
                verify_private()
                verify()
                if digest_fd(source, request["maxFileBytes"])[0] != current or fingerprint(os.fstat(source)) != fingerprint(original_stat):
                    fail("revision_conflict")
                linked = os.stat(candidate_name, dir_fd=parent, follow_symlinks=False)
                if (linked.st_dev, linked.st_ino) != (candidate_stat.st_dev, candidate_stat.st_ino):
                    fail("recovery_required")
                if digest_fd(candidate, request["maxFileBytes"])[0] != intent["candidateDigest"]:
                    fail("recovery_required")
                os.replace(candidate_name, leaf, src_dir_fd=parent, dst_dir_fd=parent)
                os.fsync(parent)
                with open_media(request["root"], request["key"], request["rootIdentity"]) as (final, _, __, check):
                    after, _ = snapshot(final, request)
                    check()
                    if after["fullDigest"] != intent["candidateDigest"]:
                        fail("recovery_required")
                emit({"stage": "file_saved", "digest": intent["candidateDigest"], "backup": backup, "candidateKey": candidate_key})
                ack("file_saved", request["generation"])
                intent["receiptAcknowledged"] = True
                journal_write(directory, name, intent)
            finally:
                os.close(candidate)
    finally:
        if lock_fd is not None:
            os.close(lock_fd)
        os.close(directory)


if __name__ == "__main__":
    try:
        line = sys.stdin.buffer.readline(1024 * 1024 + 1)
        if len(line) > 1024 * 1024:
            fail("invalid_metadata")
        transaction(json.loads(line))
    except FileAccessError as error:
        emit({"error": str(error)})
    except PermissionError:
        emit({"error": "permission_changed"})
    except OSError:
        emit({"error": "write_failed"})
    except Exception:
        emit({"error": "invalid_metadata"})
