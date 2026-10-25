"""Per-user local provider credentials, protected by the Windows account's DPAPI."""
import ctypes
import hashlib
import json
import os
import re
import tempfile
import threading
from pathlib import Path
from ctypes import wintypes


class CredentialError(Exception):
    pass


def validate_update(value):
    fields = {"deepseekApiKey", "jevApiKey"}
    if not isinstance(value, dict) or not value or set(value) - fields:
        raise ValueError("invalid credential fields")
    for key in value.values():
        if key is not None and (not isinstance(key, str) or not re.fullmatch(r"[!-~]{8,512}", key)):
            raise ValueError("invalid API key")
    return value


def protect(data, identity, decrypt=False):
    if os.name != "nt":
        raise CredentialError("当前系统暂不支持本地密钥加密保存")

    class Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]

    def blob(raw):
        buffer = ctypes.create_string_buffer(raw)
        return Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))), buffer

    source, source_buffer = blob(data)
    entropy, entropy_buffer = blob(hashlib.sha256(("Betweenly/provider-keys/" + identity).encode()).digest())
    output = Blob()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    operation = crypt32.CryptUnprotectData if decrypt else crypt32.CryptProtectData
    operation.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    operation.restype = wintypes.BOOL
    if not operation(ctypes.byref(source), None, ctypes.byref(entropy), None, None, 1, ctypes.byref(output)):
        raise CredentialError("无法读取或加密本地模型密钥，请使用保存时的 Windows 账户")
    try:
        return ctypes.string_at(output.data, output.size)
    finally:
        kernel32.LocalFree(ctypes.cast(output.data, ctypes.c_void_p))


class CredentialStore:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.lock = threading.RLock()

    def path(self, user):
        return self.directory / (hashlib.sha256(user.encode()).hexdigest() + ".bin")

    def read(self, user):
        with self.lock:
            path = self.path(user)
            if not path.exists():
                return {}
            try:
                if path.stat().st_size > 16_384:
                    raise ValueError("size")
                value = json.loads(protect(path.read_bytes(), user, decrypt=True))
                if value:
                    validate_update(value)
                if not isinstance(value, dict) or any(item is None for item in value.values()):
                    raise ValueError("stored keys")
                return value
            except (OSError, ValueError, TypeError):
                raise CredentialError("本地模型密钥不可用，请重新保存") from None

    def update(self, user, value):
        validate_update(value)
        with self.lock:
            current = self.read(user)
            for field, key in value.items():
                if key is None:
                    current.pop(field, None)
                else:
                    current[field] = key
            encrypted = protect(json.dumps(current).encode(), user)
            temporary = None
            try:
                self.directory.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(dir=self.directory, delete=False) as stream:
                    temporary = stream.name
                    stream.write(encrypted)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, self.path(user))
            except OSError:
                raise CredentialError("无法保存本地模型密钥，请检查数据目录权限") from None
            finally:
                if temporary and os.path.exists(temporary):
                    os.unlink(temporary)
            return current
