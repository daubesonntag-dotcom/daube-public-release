#!/bin/sh
set -eu

api_level="${1:?Android API level is required}"
revision="${ANDROID_EVIDENCE_REVISION:-unknown}"
evidence="artifacts/device-api-${api_level}"
package="com.daubesonntag.nexus"
activity=".LocalMainActivity"

mkdir -p "$evidence"
adb install -r release/DAUBE-Nexus-Automatic.apk | tee "$evidence/install.txt"
adb logcat -c
adb shell am force-stop "$package"
adb shell am start -W -n "$package/$activity" | tee "$evidence/startup.txt"
sleep 4

focus="$(adb shell dumpsys window windows | grep -m1 'mCurrentFocus' || true)"
printf '%s\n' "$focus" | tee "$evidence/current-focus.txt"
printf '%s\n' "$focus" | grep -q "$package"

pid="$(adb shell pidof "$package" | tr -d '\r')"
test -n "$pid"
printf '%s\n' "$pid" > "$evidence/pid.txt"

adb exec-out screencap -p > "$evidence/screenshot.png"
adb shell uiautomator dump /sdcard/daube-window.xml >/dev/null 2>&1 || true
adb pull /sdcard/daube-window.xml "$evidence/accessibility-window.xml" >/dev/null 2>&1 || true
adb logcat --pid="$pid" -d > "$evidence/logcat.txt" || adb logcat -d > "$evidence/logcat.txt"

if grep -E 'FATAL EXCEPTION|AndroidRuntime: FATAL|am_crash' "$evidence/logcat.txt"; then
  echo 'Native crash evidence detected.' >&2
  exit 1
fi

adb shell dumpsys meminfo "$package" > "$evidence/memory.txt"
adb shell dumpsys gfxinfo "$package" > "$evidence/gfxinfo.txt"

python3 - "$api_level" "$revision" <<'PY'
import json
import sys

api = int(sys.argv[1])
revision = sys.argv[2]
evidence = f'artifacts/device-api-{api}'
report = {
    'schema_version': 1,
    'observed_revision': revision,
    'api_level': api,
    'package': 'com.daubesonntag.nexus',
    'activity': '.LocalMainActivity',
    'foreground_verified': True,
    'crash_scan': 'PASS',
    'artifacts': [
        'install.txt', 'startup.txt', 'current-focus.txt', 'pid.txt',
        'screenshot.png', 'accessibility-window.xml', 'logcat.txt',
        'memory.txt', 'gfxinfo.txt'
    ],
}
with open(f'{evidence}/device-evidence.json', 'w', encoding='utf-8') as handle:
    json.dump(report, handle, indent=2)
    handle.write('\n')
PY
