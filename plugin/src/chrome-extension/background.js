// Copyright 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';

function get_diff_url(repo_params){
  if (repo_params.commit_hash === undefined) {
    return `https://patch-diff.githubusercontent.com/raw/${repo_params.user_name}/${repo_params.repo_name}/pull/${repo_params.pull_number}.diff`
  } else {
    return `https://github.com/${repo_params.user_name}/${repo_params.repo_name}/commit/${repo_params.commit_hash}.diff`
  }
}

chrome.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {
    if (request.contentScriptQuery === "diff_text") {
      console.log(`Received message '${request.contentScriptQuery}' with params: ${JSON.stringify(request.github_params)}`);

      let diff_url = get_diff_url(request.github_params);
      console.log(`Requesting url: ${diff_url}`);
      fetch(diff_url, {
        method: 'GET',
        headers: {
            "Content-Type": "text/plain",
            'mode': 'no-cors',
        }
      })
          .then(response => response.text())
          .then(diff_text => sendResponse(diff_text))
          .catch(error => console.log(`Received error: ${error}`));
      return true;
    }
  }
);