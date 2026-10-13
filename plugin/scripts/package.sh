#!/usr/bin/env bash
# Build store-ready Chrome and Firefox packages from plugin/src/chrome-extension.
#
# The source manifest is Chrome-only (no warnings when loaded unpacked).
# The Firefox build adds background.scripts (Firefox has no MV3 service
# workers) and browser_specific_settings.gecko (id + data_collection_permissions:
# diff text is websiteContent, the PR URL is browsingActivity).
#
# Output: plugin/dist/{chrome,firefox}/ and plugin/dist/reviewraccoon-<browser>-<version>.zip
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$PLUGIN_DIR/src/chrome-extension"
DIST_DIR="$PLUGIN_DIR/dist"
GECKO_ID="reviewraccoon@reviewraccoon.com"

VERSION="$(jq -r .version "$SRC_DIR/manifest.json")"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

for browser in chrome firefox; do
	out="$DIST_DIR/$browser"
	cp -r "$SRC_DIR" "$out"
	find "$out" -name '.DS_Store' -delete
done

jq --arg id "$GECKO_ID" \
	'.background = {scripts: [.background.service_worker]}
	| .browser_specific_settings = {gecko: {
		id: $id,
		data_collection_permissions: {required: ["websiteContent", "browsingActivity"]}
	}}' \
	"$SRC_DIR/manifest.json" > "$DIST_DIR/firefox/manifest.json"

for browser in chrome firefox; do
	zip_path="$DIST_DIR/reviewraccoon-$browser-$VERSION.zip"
	(cd "$DIST_DIR/$browser" && zip -qr "$zip_path" .)
	echo "Built $zip_path"
done
