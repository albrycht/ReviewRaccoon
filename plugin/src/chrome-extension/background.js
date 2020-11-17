

'use strict';

function get_diff_url(page_url){
  let repo_params = get_repo_params_from_url(page_url);
  if (repo_params.commit_hash === undefined) {
    return `https://github.com/${repo_params.user_name}/${repo_params.repo_name}/pull/${repo_params.pull_number}.diff`
  } else {
    return `https://github.com/${repo_params.user_name}/${repo_params.repo_name}/commit/${repo_params.commit_hash}.diff`
  }
}

function get_repo_params_from_url(url){
    // firefox does not support named groups
    //                                   user     repo              pull_no              commit_hash
    let regex = /https:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/pull\/(\d+))?(?:\/commits?\/(\w+))?/g;
    let match = regex.exec(url);
    if (!match){
        console.log(`Could not extract user_name from url: ${url}`);
  	    return null;
    }
    let user_name = match[1];
    let repo_name = match[2];
    let pull_number = match[3];
    let commit_hash = match[4];

    return {
        'user_name': user_name,
        'repo_name': repo_name,
        'pull_number': pull_number,
        'commit_hash': commit_hash,
    };
}

chrome.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {
    if (request.contentScriptQuery === "diff_text") {
      console.log(`Received message '${request.contentScriptQuery}' with params: ${JSON.stringify(request.pull_request_url)} from user ${JSON.stringify(request.user_name)}`);

      let diff_url = get_diff_url(request.pull_request_url);
      console.log(`Requesting url: ${diff_url}`);
      fetch(diff_url, {
        method: 'GET',
        headers: {
            "Content-Type": "text/plain",
            'mode': 'no-cors',
        }
      })
        .then(response => response.text())
        .then((diff_text) => {
          console.log(`Received diff text. Length: ${diff_text.length}`);
          console.log(`Sending diff to ReviewRaccoon.com to detect moved blocks.`);
          return fetch("https://reviewraccoon.com/moved-blocks", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                'diff_text': diff_text,
                'pull_request_url': request.pull_request_url,
                'user_name': request.user_name,
                'min_lines_count': request.min_lines_count
            })
          })
        })
        .then(response => response.json())
        .then(detected_blocks => sendResponse(detected_blocks))
        .catch(error => console.log(`Received error while getting diff: ${error}`));
      return true;
    }
  }
);
