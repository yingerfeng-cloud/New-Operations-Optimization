"""Pyomo's process-wide output capture must not overlap between solver threads.

The job scheduler and API remain concurrent; only native solver adapter calls
serialize. In particular, no STORE lock is held while waiting for this lock.
"""
from threading import RLock

solver_execution_lock = RLock()
