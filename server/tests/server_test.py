from textwrap import dedent

import requests
from falcon import testing
from unidiff import PatchSet
import json

from detector import split_to_leading_whitespace_and_trim_text
from main import create_api
from tests.detector_tests import ChangedLines
from tests.github_token import GITHUB_TOKEN


class MyTestCase(testing.TestCase):
    def setUp(self):
        super(MyTestCase, self).setUp()
        self.app = create_api()


class TestMyApp(MyTestCase):
    def test_get_message(self):
        expected_response = {u'message': u'Hello world!'}

        result = self.simulate_get('/moved-blocks')
        self.assertEqual(result.json, expected_response)

    def test_post_message_with_diff_text(self):
        diff_text = dedent("""
        --- file1       2019-05-29 19:23:25.228980900 +0200
        +++ file2       2019-05-29 19:23:38.127013700 +0200
        @@ -1,5 +1,5 @@
        -1 1 1 1 1 1 1 1 1 1 1 1 1 1 1
        -2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
        -3 3 3 3 3 3 3 3 3 3 3 3 3 3 3
        +4 1 1 1 1 1 1 1 1 1 1 1 1 1 1
        +5 2 2 2 2 2 2 2 2 2 2 2 2 2 2
        +6 3 3 3 3 3 3 3 3 3 3 3 3 3 3
         ala ma kota
         
        """)
        post_data = {
            'diff_text': diff_text,
        }
        print(f"JSON:\n{json.dumps(post_data)}")

        result = self.simulate_post('/moved-blocks', json=post_data)
        self.assertEqual(len(result.json), 1)
        self.assertEqual(len(result.json[0]['lines']), 3)

    def test_post_message_with_added_and_removed_lines(self):
        removed_lines = ChangedLines("file_with_removed_lines", {
            1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            4: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
            5: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5"
        })

        added_lines = ChangedLines("file_with_added_lines", {
            10: "-------------------------------------------",
            11: "-------------------------------------------",
            12: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            13: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            14: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            15: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
            16: "-------------------------------------------",
        })

        post_data = {
            'added_lines': added_lines.to_lines_dicts(),
            'removed_lines': removed_lines.to_lines_dicts(),
        }

        result = self.simulate_post('/moved-blocks', json=post_data)
        self.assertEqual(len(result.json), 1)
        self.assertEqual(len(result.json[0]['lines']), 4)
        self.assertDictEqual(result.json[0]['lines'][0],
            {
                'added_line': {
                    'file': 'file_with_added_lines',
                    'line_no': 12,
                    'leading_whitespaces': '',
                    'trim_text': '1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1'
                },
                'removed_line': {
                    'file': 'file_with_removed_lines',
                    'line_no': 1,
                    'leading_whitespaces': '',
                    'trim_text': '1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1'
                },
                'match_probability': 1
            }
        )

    def diff_to_added_and_removed_lines(self, diff_text):
        patch = PatchSet(diff_text)
        added_lines = []
        removed_lines = []
        for patched_file in patch:
            for hunk in patched_file:
                for line in hunk:
                    leading_whitespace, trim_text = split_to_leading_whitespace_and_trim_text(line.value.rstrip('\n'))
                    file = patched_file.path
                    if line.is_added:
                        line_no = line.target_line_no
                        lines_list = added_lines
                    elif line.is_removed:
                        line_no = line.source_line_no
                        lines_list = removed_lines
                    else:
                        continue
                    lines_list.append({
                        'file': file,
                        'line_no': line_no,
                        'trim_text': trim_text,
                        'leading_whitespaces': leading_whitespace,
                    })
        return {
            'added_lines': added_lines,
            'removed_lines': removed_lines,
        }

    def test_compare_diff_with_javascript_plugin(self):
        url = 'https://github.com/albrycht/MoveBlockDetector/pull/1.diff'
        r = requests.get(url, headers={'Authorization': f'token {GITHUB_TOKEN}',
                                       'Accept': 'application/vnd.github.v3.sha'})

        parsed_diff = self.diff_to_added_and_removed_lines(r.text)

        from_js = {
            "added_lines": [
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 1,
                    "trim_text": "In quis pharetra neque. Vestibulum in enim lacus. In vitae est dolor. Donec a dolor diam. Morbi aliquam et leo ut viverra. Curabitur at mauris purus.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 2,
                    "trim_text": "Curabitur urna eros, ullamcorper ut tellus sed, lobortis tempus leo. Nulla semper purus ut finibus porttitor. Ut ac est sit amet lacus ornare rutrum.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 3,
                    "trim_text": "Duis turpis risus, aliquet quis quam ut, faucibus faucibus tortor. Ut eu porttitor dolor.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 11,
                    "trim_text": "Aliquam non justo nisl. Aliquam luctus condimentum libero, ut dapibus tortor lacinia quis. Donec lobortis libero at tellus tristique tempor.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 12,
                    "trim_text": "Aliquam et ipsum at dolor sagittis egestas eu id tellus. Cras id dictum augue, id volutpat nisi. Duis vestibulum tortor in nibh tempor faucibus.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 13,
                    "trim_text": "Vestibulum suscipit ex ac laoreet vehicula. Cras porttitor bibendum sem sed elementum. Morbi non ex at lectus maximus dictum et ultricies massa.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 14,
                    "trim_text": "In aliquet lorem quis risus congue, non dictum urna pulvinar. In eu enim a lacus suscipit pellentesque. Donec molestie, tellus id ultricies tincidunt,",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 15,
                    "trim_text": "risus magna congue velit, quis euismod ligula nisl eu quam. Sed vel consequat justo, non aliquam leo.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 16,
                    "trim_text": "Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 24,
                    "trim_text": "Maecenas fermentum, quam varius feugiat accumsan, risus ligula maximus justo, et interdum lacus lacus et nunc.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 25,
                    "trim_text": "Vivamus imperdiet enim non risus aliquam rutrum. Nunc erat eros, lobortis ut vehicula at, sollicitudin tempor nibh.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 26,
                    "trim_text": "Nam et magna at urna molestie malesuada. Nunc et sem egestas, dapibus lorem eu, efficitur augue. Morbi volutpat ante quis pellentesque euismod.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 27,
                    "trim_text": "Curabitur scelerisque tempus enim, sit amet imperdiet felis facilisis ac. Curabitur luctus ornare orci. Duis ultrices ex risus,",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 28,
                    "trim_text": "vitae imperdiet neque mattis ullamcorper. Proin vel egestas leo. Etiam lectus risus, congue ac blandit vitae, lobortis et felis.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 29,
                    "trim_text": "",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 30,
                    "trim_text": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. In semper, nunc sit amet blandit semper, lacus eros congue neque,",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 31,
                    "trim_text": "vitae rhoncus sapien nisi et velit. Fusce arcu ipsum, tempus ut ullamcorper eget, pretium eu libero. Suspendisse potenti.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 32,
                    "trim_text": "Fusce ac ullamcorper nulla, quis facilisis urna. Proin congue ex pulvinar, congue lacus sit amet, mollis odio.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 33,
                    "trim_text": "Pellentesque cursus ultrices enim ut varius. Cras pellentesque felis a faucibus vestibulum. Vestibulum commodo, ipsum sagittis pretium porta,",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 34,
                    "trim_text": "massa orci condimentum orci, non porta velit nunc id ipsum. Sed turpis dolor, molestie vitae leo vitae, imperdiet fringilla diam.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 35,
                    "trim_text": "Nullam dolor elit, finibus id massa at, placerat mollis enim. Nullam condimentum egestas leo efficitur porttitor. Integer et eros nunc.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 36,
                    "trim_text": "Maecenas fringilla sem et ante accumsan, vitae hendrerit tellus malesuada. In non sodales ligula. Vivamus at mollis tortor.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 37,
                    "trim_text": "",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 38,
                    "trim_text": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. In semper, nunc sit amet blandit semper, lacus eros congue neque,",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 39,
                    "trim_text": "vitae rhoncus sapien nisi et velit. Fusce arcu ipsum, tempus ut ullamcorper eget, pretium eu libero. Suspendisse potenti.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 40,
                    "trim_text": "Fusce ac ullamcorper nulla, quis facilisis urna. Proin congue ex pulvinar, congue lacus sit amet, mollis odio.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 41,
                    "trim_text": "Pellentesque cursus ultrices enim ut varius. Cras pellentesque felis a faucibus vestibulum. Vestibulum commodo, ipsum sagittis pretium porta,",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 42,
                    "trim_text": "massa orci condimentum orci, non porta velit nunc id ipsum. Sed turpis dolor, molestie vitae leo vitae, imperdiet fringilla diam.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 43,
                    "trim_text": "Nullam dolor elit, finibus id massa at, placerat mollis enim. Nullam condimentum egestas leo efficitur porttitor. Integer et eros nunc.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 44,
                    "trim_text": "Maecenas fringilla sem et ante accumsan, vitae hendrerit tellus malesuada. In non sodales ligula. Vivamus at mollis tortor.",
                    "leading_whitespaces": "",
                }
            ],
            "removed_lines": [
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 1,
                    "trim_text": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. In semper, nunc sit amet blandit semper, lacus eros congue neque,",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 2,
                    "trim_text": "vitae rhoncus sapien nisi et velit. Fusce arcu ipsum, tempus ut ullamcorper eget, pretium eu libero. Suspendisse potenti.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 3,
                    "trim_text": "Fusce ac ullamcorper nulla, quis facilisis urna. Proin congue ex pulvinar, congue lacus sit amet, mollis odio.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 4,
                    "trim_text": "Pellentesque cursus ultrices enim ut varius. Cras pellentesque felis a faucibus vestibulum. Vestibulum commodo, ipsum sagittis pretium porta,",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 5,
                    "trim_text": "massa orci condimentum orci, non porta velit nunc id ipsum. Sed turpis dolor, molestie vitae leo vitae, imperdiet fringilla diam.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 6,
                    "trim_text": "Nullam dolor elit, finibus id massa at, placerat mollis enim. Nullam condimentum egestas leo efficitur porttitor. Integer et eros nunc.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 7,
                    "trim_text": "Maecenas fringilla sem et ante accumsan, vitae hendrerit tellus malesuada. In non sodales ligula. Vivamus at mollis tortor.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 15,
                    "trim_text": "In quis pharetra neque. Vestibulum in enim lacus. In vitae est dolor. Donec a dolor diam. Morbi aliquam et leo ut viverra. Curabitur at mauris purus.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 16,
                    "trim_text": "Curabitur urna eros, ullamcorper ut tellus sed, lobortis tempus leo. Nulla semper purus ut finibus porttitor. Ut ac est sit amet lacus ornare rutrum.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 17,
                    "trim_text": "Duis turpis risus, aliquet quis quam ut, faucibus faucibus tortor. Ut eu porttitor dolor.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 25,
                    "trim_text": "Aliquam non justo nisl. Aliquam luctus condimentum libero, ut dapibus tortor lacinia quis. Donec lobortis libero at tellus tristique tempor.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 26,
                    "trim_text": "Aliquam et ipsum at dolor sagittis egestas eu id tellus. Cras id dictum augue, id volutpat nisi. Duis vestibulum tortor in nibh tempor faucibus.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 27,
                    "trim_text": "Vestibulum suscipit ex ac laoreet vehicula. Cras porttitor bibendum sem sed elementum. Morbi non ex at lectus maximus dictum et ultricies massa.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 28,
                    "trim_text": "In aliquet lorem quis risus congue, non dictum urna pulvinar. In eu enim a lacus suscipit pellentesque. Donec molestie, tellus id ultricies tincidunt,",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 29,
                    "trim_text": "risus magna congue velit, quis euismod ligula nisl eu quam. Sed vel consequat justo, non aliquam leo.",
                    "leading_whitespaces": "",
                },
                {
                    "file": "tests/some_text_file.txt",
                    "line_no": 30,
                    "trim_text": "Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas.",
                    "leading_whitespaces": "",
                }
            ]
        }

        for key in ['added_lines', 'removed_lines']:
            for from_js_line_dict, parsed_diff_line_dict in zip(from_js[key], parsed_diff[key]):
                self.assertDictEqual(from_js_line_dict, parsed_diff_line_dict)
