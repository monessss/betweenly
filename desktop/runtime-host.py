"""Keep local services in a kill-on-close Windows Job, tied to Electron's stdin."""
import ctypes
from ctypes import wintypes
import json
import os
import subprocess
import sys
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor


def create_job():
    class Basic(ctypes.Structure):
        _fields_ = [("processTime", ctypes.c_int64), ("jobTime", ctypes.c_int64), ("flags", wintypes.DWORD), ("minWorkingSet", ctypes.c_size_t), ("maxWorkingSet", ctypes.c_size_t), ("activeProcessLimit", wintypes.DWORD), ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]
    class Io(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ("readOps", "writeOps", "otherOps", "readBytes", "writeBytes", "otherBytes")]
    class Extended(ctypes.Structure):
        _fields_ = [("basic", Basic), ("io", Io), ("processMemory", ctypes.c_size_t), ("jobMemory", ctypes.c_size_t), ("peakProcessMemory", ctypes.c_size_t), ("peakJobMemory", ctypes.c_size_t)]
    api = ctypes.WinDLL("kernel32", use_last_error=True)
    api.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    api.CreateJobObjectW.restype = wintypes.HANDLE
    api.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    api.SetInformationJobObject.restype = wintypes.BOOL
    api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    api.OpenProcess.restype = wintypes.HANDLE
    api.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    api.AssignProcessToJobObject.restype = wintypes.BOOL
    api.CloseHandle.argtypes = [wintypes.HANDLE]
    api.CloseHandle.restype = wintypes.BOOL
    handle = api.CreateJobObjectW(None, None)
    limits = Extended()
    limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not handle or not api.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
        if handle:
            api.CloseHandle(handle)
        raise RuntimeError("job setup")
    return api, handle


def main():
    job_api, job = create_job()
    processes = []
    shutdown = threading.Event()
    close_lock = threading.Lock()
    status_lock = threading.Lock()
    closed = False
    def close_job():
        nonlocal closed
        with close_lock:
            if not closed:
                closed = True
                job_api.CloseHandle(job)
    def emit(value):
        with status_lock:
            print(json.dumps(value), flush=True)
    try:
        # Put the supervisor in the Job before CreateProcess: even a child that
        # is still being inspected at first launch inherits cleanup immediately.
        own_handle = job_api.OpenProcess(0x0101, False, os.getpid())
        try:
            if not own_handle or not job_api.AssignProcessToJobObject(job, own_handle):
                raise RuntimeError('supervisor job assignment')
        finally:
            if own_handle:
                job_api.CloseHandle(own_handle)
        configuration = json.loads(sys.stdin.buffer.readline().decode('utf-8'))
        def watch_parent():
            sys.stdin.buffer.read()
            shutdown.set()
            close_job()
        threading.Thread(target=watch_parent, daemon=True).start()
        def start_service(service):
            if shutdown.is_set():
                return
            log_path = Path(configuration["logDirectory"]) / (service["name"] + ".log")
            emit({"state": "starting", "service": service["name"]})
            with log_path.open("ab", buffering=0) as log:
                process = subprocess.Popen([service["executable"], *service["arguments"]], cwd=service["cwd"], env=service["environment"], stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
            processes.append(process)
            emit({"state": "spawned", "service": service["name"], "pid": process.pid})
        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = [pool.submit(start_service, service) for service in configuration["services"]]
            for future in futures:
                future.result()
        emit({"state": "started", "pids": [process.pid for process in processes]})
        while not shutdown.wait(.2):
            if any(process.poll() is not None for process in processes):
                emit({"state": "service-exited"})
                return
    finally:
        # Closing the Job also terminates helper/OCR grandchildren and works if
        # this supervisor is killed; no global process names or ports are used.
        close_job()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"state": "host-failed", "kind": type(error).__name__, "systemCode": getattr(error, "winerror", None)}), flush=True)
        sys.exit(1)
