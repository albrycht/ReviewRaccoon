import functools
import logging
import time

logger = logging.getLogger(__name__)


class MeasureTime:
    def __init__(self, stat_name):
        self._stat_name = stat_name
        self._start_time = None

    def __enter__(self):
        self._start_time = time.time()
        return self

    def __exit__(self, exc_type, _exc_val, _exc_tb):
        if exc_type is not None:  # exception was thrown
            return
        duration = time.time() - self._start_time
        self.report(duration)

    def report(self, duration):
        stat_name = self._stat_name
        logger.debug(f"{stat_name} took {duration:.3f} seconds")


def measure_fun_time():
    def _measure_fun_time(f):
        @functools.wraps(f)
        def measure_fun_time_wrapper(*fun_args, **fun_kwargs):
            stat_name = f.__name__.strip('_')
            with MeasureTime(stat_name):
                return f(*fun_args, **fun_kwargs)

        return measure_fun_time_wrapper

    return _measure_fun_time