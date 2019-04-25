# things.py

# Let's get this party started!
import json

import falcon
import requests
import pprint
from github import Github


# Falcon follows the REST architectural style, meaning (among
# other things) that you think in terms of resources and state
# transitions, which map to HTTP verbs.
from detector import Line


class MovedBlocksResource(object):
    def on_get(self, req, resp):
        """Handles GET requests"""
        resp.status = falcon.HTTP_200  # This is the default status

        github_token = 'cac1d50e1208d152aa550ef92ec6317ca0bcbab6'
        g = Github(github_token)
        # header = f"Authorization: token {github_token}"
        #
        # url = 'https://api.github.com/repos/albrycht/MoveBlockDetector/pulls/1/files'
        # url = 'https://github.com/albrycht/MoveBlockDetector/pull/1/files'
        # r = requests.get(url, headers={'Authorization': f'token {github_token}',
        #                                'Accept': 'application/vnd.github.v3.sha'}
        #                  )
        # response = r.text
        # response = json.loads(response)
        repo = g.get_repo("albrycht/MoveBlockDetector")
        pull = repo.get_pull(1)
        print(pull)
        for file in pull.get_files():
            print(file.patch)
        # resp.body = (f'Github response headers: {r.headers}\n\nGitub response: {response}')
        resp.body = "logs"

    def on_post(self, req, resp):
        print(f"REQUEST DATA: {req.media}")
        added_lines = req.media.get('added_lines')
        for line_dict in added_lines:
            line = Line.from_dict(line_dict)
            print(f"Line: {line.file}: {line.line_no}")

        resp.body = json.dumps({"THEOLOL": "THEOLOL_VALUE"})




# falcon.API instances are callable WSGI apps
app = falcon.API()

# Resources are represented by long-lived class instances
moved_blocks = MovedBlocksResource()

# things will handle all requests to the '/things' URL path
app.add_route('/moved-blocks', moved_blocks)