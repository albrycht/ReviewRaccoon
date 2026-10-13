# ReviewRaccoon Privacy Policy

Effective date: 2026-10-13

ReviewRaccoon is a browser extension that detects moved blocks of code in GitHub pull requests and commits and highlights them in the GitHub diff view.

## What data is processed

When you open a GitHub pull request or commit diff page and detection is enabled, the extension:

1. Downloads the page's diff (`.diff`) from github.com using your existing GitHub session.
2. Sends to the ReviewRaccoon server (`https://reviewraccoon.com`):
   - the diff text (the changed lines of code),
   - the URL of the pull request or commit page,
   - the "minimum lines" detection setting.

The server uses the diff only to compute which blocks were moved and returns the result to the extension. The diff text is processed in memory and is not stored.

The extension does not collect or send your name, GitHub username, email address, passwords, cookies or browsing history outside GitHub diff pages. It contains no analytics or tracking.

## What is stored

- **In your browser:** extension settings (on/off, minimum lines, expand large diffs, custom server address) are saved in the browser's extension storage on your device.
- **On the server:** the server log records the time of each request and the pull request or commit URL, plus summary numbers such as how many moved blocks were found. The web server's standard access log records the requesting IP address and browser user agent. These logs are used only to operate, debug and improve the service.

## Sharing

Data is not sold, shared with third parties, or used for advertising, creditworthiness or any purpose unrelated to detecting moved code blocks.

## Custom server

If you enable "Custom server" in the extension settings, the diff and page URL are sent to the server address you entered instead of reviewraccoon.com. That server is not operated by ReviewRaccoon and this policy does not cover it.

## Private repositories

For private repositories the diff contains code from that repository. If you or your organization do not allow sending code to an external service, disable detection in the extension popup or use a self-hosted custom server.

## Contact

Questions or requests: open an issue at https://github.com/albrycht/ReviewRaccoon/issues.

## Changes

Changes to this policy will be published at this address with a new effective date.
