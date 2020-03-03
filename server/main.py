import json
from textwrap import dedent

import falcon

from detector import MovedBlocksDetector


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
        if diff_text:
            detector = MovedBlocksDetector.from_diff(diff_text)
        else:
            added_lines = req.media.get('added_lines')
            removed_lines = req.media.get('removed_lines')
            detector = MovedBlocksDetector(removed_lines, added_lines)
        detected_blocks = detector.detect_moved_blocks()
        resp.body = json.dumps(detected_blocks, cls=CustomJsonEncoder)


def create_api():
    api = falcon.API()
    api.add_route('/', MainPageResource())
    api.add_route('/moved-blocks', MovedBlocksResource())
    return api


app = create_api()
