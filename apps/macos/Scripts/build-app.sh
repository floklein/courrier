#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

cd "$project_dir"
swift build --disable-sandbox -c release -debug-info-format none
binary_dir=$(swift build --disable-sandbox -c release -debug-info-format none --show-bin-path)
app_dir="$project_dir/.build/Courrier.app"

mkdir -p "$app_dir/Contents/MacOS"
mkdir -p "$app_dir/Contents/Resources"
cp "$binary_dir/Courrier" "$app_dir/Contents/MacOS/Courrier"
cp "$project_dir/Resources/Info.plist" "$app_dir/Contents/Info.plist"
cp "$project_dir/Resources/Courrier.icns" "$app_dir/Contents/Resources/Courrier.icns"
codesign --force --sign - "$app_dir"

echo "$app_dir"
