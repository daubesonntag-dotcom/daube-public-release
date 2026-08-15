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
adb shell am start -n "$package/$activity" | tee "$evidence/startup.txt"

foreground=false
pid=""
focus=""
attempt=0
while [ "$attempt" -lt 60 ]; do
  attempt=$((attempt + 1))
  pid="$(adb shell pidof "$package" 2>/dev/null | tr -d '\r' || true)"
  focus="$(adb shell dumpsys window windows 2>/dev/null | grep -m1 'mCurrentFocus' || true)"
  printf 'attempt=%s pid=%s focus=%s\n' "$attempt" "$pid" "$focus" >> "$evidence/foreground-poll.txt"
  if [ -n "$pid" ] && printf '%s\n' "$focus" | grep -q "$package"; then
    foreground=true
    break
  fi
  sleep 2
done

printf '%s\n' "$focus" | tee "$evidence/current-focus.txt"
printf '%s\n' "$pid" > "$evidence/pid.txt"
adb logcat -d > "$evidence/logcat-all.txt" || true

if [ "$foreground" != true ]; then
  echo 'Application did not reach foreground within the bounded 120-second probe.' >&2
  adb shell dumpsys activity activities > "$evidence/activity-dump.txt" || true
  if grep -E 'FATAL EXCEPTION|AndroidRuntime: FATAL|am_crash' "$evidence/logcat-all.txt"; then
    echo 'Native crash evidence detected while waiting for foreground.' >&2
  fi
  exit 1
fi

adb exec-out screencap -p > "$evidence/screenshot.png"
adb shell uiautomator dump /sdcard/daube-window.xml >/dev/null 2>&1 || true
adb pull /sdcard/daube-window.xml "$evidence/accessibility-window.xml" >/dev/null 2>&1 || true
adb logcat --pid="$pid" -d > "$evidence/logcat.txt" || cp "$evidence/logcat-all.txt" "$evidence/logcat.txt"

if grep -E 'FATAL EXCEPTION|AndroidRuntime: FATAL|am_crash' "$evidence/logcat.txt"; then
  echo 'Native crash evidence detected.' >&2
  exit 1
fi

adb shell dumpsys meminfo "$package" > "$evidence/memory.txt"
adb shell dumpsys gfxinfo "$package" > "$evidence/gfxinfo.txt"

python3 - "$api_level" "$revision" "$attempt" <<'PY'
import json
import sys

api = int(sys.argv[1])
revision = sys.argv[2]
attempts = int(sys.argv[3])
evidence = f'artifacts/device-api-{api}'
report = {
    'schema_version': 1,
    'observed_revision': revision,
    'api_level': api,
    'package': 'com.daubesonntag.nexus',
    'activity': '.LocalMainActivity',
    'foreground_verified': True,
    'foreground_poll_attempts': attempts,
    'foreground_probe_max_seconds': 120,
    'crash_scan': 'PASS',
    'artifacts': [
        'install.txt', 'startup.txt', 'foreground-poll.txt', 'current-focus.txt',
        'pid.txt', 'screenshot.png', 'accessibility-window.xml', 'logcat.txt',
        'logcat-all.txt', 'memory.txt', 'gfxinfo.txt'
    ],
}
with open(f'{evidence}/device-evidence.json', 'w', encoding='utf-8') as handle:
    json.dump(report, handle, indent=2)
    handle.write('\n')
PY
