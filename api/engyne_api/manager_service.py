from __future__ import annotations

import threading
import time
from typing import Optional

from core.slot_manager import SlotManager, SCAN_INTERVAL_SECONDS
from engyne_api.settings import get_settings

_manager_lock = threading.Lock()
_manager: Optional[SlotManager] = None
_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()


def get_manager() -> SlotManager:
    global _manager
    if _manager is None:
        settings = get_settings()
        _manager = SlotManager(slots_root=settings.slots_root_path)
    return _manager


def _run_loop() -> None:
    mgr = get_manager()
    while not _stop_event.is_set():
        mgr.tick()
        _stop_event.wait(SCAN_INTERVAL_SECONDS)


def start_background_manager() -> None:
    global _thread
    with _manager_lock:
        if _thread and _thread.is_alive():
            return
        _stop_event.clear()
        _thread = threading.Thread(target=_run_loop, daemon=True, name="slot-manager")
        _thread.start()


def stop_background_manager() -> None:
    with _manager_lock:
        _stop_event.set()
        mgr = _manager
        if mgr:
            mgr.stop_all()
        if _thread and _thread.is_alive():
            _thread.join(timeout=5)

