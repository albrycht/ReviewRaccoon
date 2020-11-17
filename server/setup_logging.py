import os

import logging

LOG_DIR = 'LOG_DIR'
LOG_LEVEL = 'LOG_LEVEL'
LOG_FORMAT = "%(levelname).3s %(asctime)s.%(msecs)d pid=%(process)d: %(message)s [%(filename)s:%(lineno)d]"
LOG_DATE_FORMAT = '%Y-%m-%d %H:%M:%S'


def setup_logging():
    log_dir = os.getenv(LOG_DIR, os.path.dirname(os.path.abspath(__file__)))
    log_level = os.getenv(LOG_LEVEL, logging.INFO)

    log_path = os.path.join(log_dir, 'reviewraccoon.log')
    log_formatter = logging.Formatter(fmt=LOG_FORMAT, datefmt=LOG_DATE_FORMAT)
    file_handler = logging.FileHandler(log_path)
    file_handler.setFormatter(log_formatter)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(log_formatter)
    logging.basicConfig(level=log_level, handlers=[file_handler, console_handler])
