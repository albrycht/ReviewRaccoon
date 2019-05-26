import json
import time
from contextlib import contextmanager

import falcon

from detector import MovedBlocksDetector


class CustomJsonEncoder(json.JSONEncoder):
    def default(self, obj):
        if hasattr(obj, "to_dict"):
            return obj.to_dict()
        return super().default(obj)


class MovedBlocksResource(object):
    def on_get(self, req, resp):
        """Handles GET requests"""
        resp.body = json.dumps({"message": "Hello world!"})

    def on_post(self, req, resp):
        diff_text = req.media.get('diff_text')

        # added_lines = req.media.get('added_lines')
        # removed_lines = req.media.get('removed_lines')
        detector = MovedBlocksDetector.from_diff(diff_text)
        detected_blocks = detector.detect_moved_blocks()
        resp.body = json.dumps(detected_blocks, cls=CustomJsonEncoder)


def create_api():
    api = falcon.API()
    moved_blocks = MovedBlocksResource()
    # api.add_route('/moved-blocks', moved_blocks)
    api.add_route('/from-diff', moved_blocks)
    return api


app = create_api()
