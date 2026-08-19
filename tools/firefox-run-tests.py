#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Drive Firefox over the Marionette protocol to read window.__TEST_RESULTS__.

Firefox's --screenshot fires at the load event, which is before our async test matrix
finishes, so a screenshot cannot prove the verdict. Marionette can: it is Firefox's own
remote-control protocol, spoken over a TCP socket with length-prefixed JSON.
"""
import json
import socket
import subprocess
import sys
import time

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8127/tests/"
PORT = 2828
PROFILE = "/tmp/qbe-firefox-test-profile"

subprocess.run(["rm", "-rf", PROFILE], check=False)
subprocess.run(["mkdir", "-p", PROFILE], check=True)
with open(PROFILE + "/user.js", "w") as fh:
    fh.write('user_pref("marionette.port", %d);\n' % PORT)
    fh.write('user_pref("browser.shell.checkDefaultBrowser", false);\n')

proc = subprocess.Popen(
    ["/Applications/Firefox.app/Contents/MacOS/firefox", "--headless",
     "--marionette", "--profile", PROFILE, "about:blank"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)

sock = None
for _ in range(60):
    try:
        sock = socket.create_connection(("127.0.0.1", PORT), timeout=2)
        break
    except OSError:
        time.sleep(0.5)
if sock is None:
    proc.terminate()
    sys.exit("could not connect to marionette")

buf = b""


def recv():
    """Read one length-prefixed message: '<len>:<json>'."""
    global buf
    while b":" not in buf:
        buf += sock.recv(65536)
    length, _, rest = buf.partition(b":")
    n = int(length)
    while len(rest) < n:
        rest += sock.recv(65536)
    buf = rest[n:]
    return json.loads(rest[:n])


msg_id = [0]


def send(command, params=None):
    msg_id[0] += 1
    payload = json.dumps([0, msg_id[0], command, params or {}]).encode()
    sock.sendall(str(len(payload)).encode() + b":" + payload)
    return recv()


recv()  # server handshake
send("WebDriver:NewSession", {"capabilities": {}})
send("WebDriver:Navigate", {"url": URL})

# Poll for the runner to publish its results object.
#
# 240 x 0.5s = two minutes. It was 40 (twenty seconds), which was comfortable when the suite was
# ~100 assertions and silently became a false "runner never published __TEST_RESULTS__" as it grew
# past ~350 — a timeout that reports as a harness failure rather than as a slow suite is worse than
# no timeout at all. Two minutes is far past any healthy run and still bounded.
result = None
for _ in range(240):
    out = send("WebDriver:ExecuteScript", {
        "script": "return window.__TEST_RESULTS__ ? JSON.stringify({"
                  "ok: window.__TEST_RESULTS__.ok,"
                  "passed: window.__TEST_RESULTS__.passed,"
                  "failed: window.__TEST_RESULTS__.failed,"
                  "total: window.__TEST_RESULTS__.total,"
                  "title: document.title,"
                  "failures: window.__TEST_RESULTS__.results"
                  ".filter(function(r){return !r.passed})"
                  ".map(function(r){return '['+r.group+'] '+r.name+' :: '+r.detail})"
                  "}) : null;",
        "args": [],
    })
    # Marionette replies are [type, id, error, result]; ExecuteScript puts the return
    # value at result["value"].
    body = out[3] if isinstance(out, list) and len(out) > 3 else out
    if isinstance(out, list) and out[2]:
        sys.exit("marionette error: %s" % json.dumps(out[2])[:400])
    value = body.get("value") if isinstance(body, dict) else body
    if value:
        result = json.loads(value)
        break
    time.sleep(0.5)

send("WebDriver:DeleteSession")
sock.close()
proc.terminate()

if result is None:
    sys.exit("runner never published __TEST_RESULTS__")
print(json.dumps(result, indent=2))
sys.exit(0 if result["ok"] else 1)
