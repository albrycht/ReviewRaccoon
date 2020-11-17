import json
import logging
from textwrap import dedent

import falcon

from detector import MovedBlocksDetector
from setup_logging import setup_logging

setup_logging()

logger = logging.getLogger(__name__)


class CustomJsonEncoder(json.JSONEncoder):
    def default(self, obj):
        if hasattr(obj, "to_dict"):
            return obj.to_dict()
        return super().default(obj)


class MainPageResource(object):
    def on_get(self, req, resp):
        resp.content_type = 'text/html'
        resp.body = dedent("""
            <html>
                <head>
                </head>
                <body>
                    <h1>ReviewRaccoon</h1>
                    <br/>
                    <br/>
                    <br/>
                    <h3>WORK IN PROGRESS</h3>
                </body>
            </html>
            """)


class MovedBlocksResource(object):
    def on_get(self, req, resp):
        resp.body = json.dumps({"message": "Hello world!"})

    def on_post(self, req, resp):
        diff_text = req.media.get('diff_text')
        pull_url = req.media.get('pull_request_url')
        user_name = req.media.get('user_name')
        min_lines_count = req.media.get('min_lines_count')
        logger.info(f"Received request for PR: {pull_url} for user: {user_name} with min_lines_count: {min_lines_count}")
        detector = MovedBlocksDetector.from_diff(diff_text)
        detected_blocks = detector.detect_moved_blocks(min_lines_count)
        resp.body = json.dumps(detected_blocks, cls=CustomJsonEncoder)


def create_api():
    api = falcon.API()
    api.add_route('/', MainPageResource())
    api.add_route('/moved-blocks', MovedBlocksResource())
    return api


app = create_api()
