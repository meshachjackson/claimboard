#!/usr/bin/env python3
"""Signed callback from the runner and verifier workflows to the orchestrator's status gateway. Phase C, docs/runner-actions.md.

Body: exactly seven fields, {job_id, step_id, status, output_ref, tokens_in, tokens_out, verdict}, as canonical
JSON (sorted keys, no spaces, no timestamp), so the same inputs always give the same bytes. Token counts are 0 when
not metered; verdict is "" for builder jobs and PASS, FAIL or INCONCLUSIVE for verifier jobs.
Headers:
  <prefix>-Timestamp: Unix seconds (the gateway refuses one more than 5 minutes old)
  <prefix>-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>", keyed with VERA_CALLBACK_SECRET>
  <prefix>-Idempotency-Key: callback:<job_id>:<status>   (the gateway derives the same key; this one is for logs)
The header prefix is CALLBACK_HEADER_PREFIX (default X-Orchestrator); the gateway must expect the same one.
The runner and the verifier hold different secrets, both reaching this script as VERA_CALLBACK_SECRET.

The URL and the secret come from the environment (VERA_CALLBACK_URL, VERA_CALLBACK_SECRET), set from repo secrets
in the workflow. If either is missing the callback is skipped with a notice and exit 0, so a run started by hand
before Phase C is set up still works. The URL must be https. Standard library only."""
import argparse
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

STATUSES = ('started', 'served', 'failed', 'needs_input')
VERDICTS = ('PASS', 'FAIL', 'INCONCLUSIVE')
FIELDS = ('job_id', 'step_id', 'status', 'output_ref', 'tokens_in', 'tokens_out', 'verdict')
JOB_ID = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
STEP_ID = re.compile(r'^STP-[0-9]{6,}$')
TRIES = 3


def payload(job_id, step_id, status, output_ref='', tokens_in=None, tokens_out=None, verdict=''):
    """The seven-field body as a dict. Raises ValueError on a bad field."""
    if not JOB_ID.match(job_id or ''):
        raise ValueError('job_id must match ^[A-Za-z0-9_-]{1,64}$')
    if not STEP_ID.match(step_id or ''):
        raise ValueError('step_id must look like STP-<digits>')
    if status not in STATUSES:
        raise ValueError(f'status must be one of {", ".join(STATUSES)}')
    verdict = verdict or ''
    if verdict and verdict not in VERDICTS:
        raise ValueError(f'verdict must be empty or one of {", ".join(VERDICTS)}')
    if verdict and status not in ('served', 'failed'):
        raise ValueError('a verdict goes with a final status (served or failed)')
    return {'job_id': job_id, 'step_id': step_id, 'status': status, 'output_ref': str(output_ref or '')[:500],
            'tokens_in': _count(tokens_in), 'tokens_out': _count(tokens_out), 'verdict': verdict}


def _count(v):
    """A token count; 0 when the run did not report one ("0 when not metered")."""
    if v is None or v == '':
        return 0
    n = int(v)
    if n < 0:
        raise ValueError('token counts cannot be negative')
    return n


def body_bytes(p):
    return json.dumps(p, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def sign(secret, timestamp, body):
    """HMAC-SHA256 of "<timestamp>.<raw body>" (the callback contract)."""
    return 'sha256=' + hmac.new(secret.encode(), f'{timestamp}.'.encode() + body, hashlib.sha256).hexdigest()


def dedupe_key(p):
    return f'callback:{p["job_id"]}:{p["status"]}'


def headers(secret, timestamp, body, p):
    prefix = os.environ.get('CALLBACK_HEADER_PREFIX') or 'X-Orchestrator'
    return {'Content-Type': 'application/json', f'{prefix}-Timestamp': str(timestamp),
            f'{prefix}-Signature': sign(secret, timestamp, body), f'{prefix}-Idempotency-Key': dedupe_key(p)}


def send(url, hdrs, body, opener=urllib.request.urlopen, sleep=time.sleep):
    """POST with up to 3 tries on a network error or a 5xx. A 4xx is final. Returns the HTTP status."""
    last = None
    for attempt in range(1, TRIES + 1):
        req = urllib.request.Request(url, data=body, headers=hdrs, method='POST')
        try:
            with opener(req, timeout=20) as r:
                return r.status
        except urllib.error.HTTPError as e:
            last = e.code
            if e.code < 500:
                return e.code
        except (urllib.error.URLError, OSError) as e:
            last = str(getattr(e, 'reason', e))
        if attempt < TRIES:
            sleep(2 * attempt)
    raise OSError(f'callback failed after {TRIES} tries: {last}')


def main(argv=None, env=None, opener=urllib.request.urlopen, sleep=time.sleep, clock=time.time):
    env = os.environ if env is None else env
    ap = argparse.ArgumentParser(prog='runner-callback.py')
    ap.add_argument('--job-id', required=True)
    ap.add_argument('--step-id', required=True)
    ap.add_argument('--status', required=True)
    ap.add_argument('--output-ref', default='')
    ap.add_argument('--tokens-in', default='')
    ap.add_argument('--tokens-out', default='')
    ap.add_argument('--verdict', default='')
    ap.add_argument('--dry-run', action='store_true', help='print the headers and body, send nothing')
    a = ap.parse_args(argv)
    try:
        p = payload(a.job_id, a.step_id, a.status, a.output_ref, a.tokens_in, a.tokens_out, a.verdict)
    except ValueError as e:
        print(f'callback refused: {e}', file=sys.stderr)
        return 2
    url, secret = env.get('VERA_CALLBACK_URL', ''), env.get('VERA_CALLBACK_SECRET', '')
    if not url or not secret:
        print('callback skipped: VERA_CALLBACK_URL or VERA_CALLBACK_SECRET is not set')
        return 0
    if not url.startswith('https://'):
        print('callback refused: VERA_CALLBACK_URL must start with https://', file=sys.stderr)
        return 2
    body = body_bytes(p)
    hdrs = headers(secret, int(clock()), body, p)
    if a.dry_run:
        print(json.dumps({'headers': hdrs, 'body': body.decode()}))
        return 0
    try:
        code = send(url, hdrs, body, opener=opener, sleep=sleep)
    except OSError as e:
        print(f'callback {dedupe_key(p)}: {e}', file=sys.stderr)
        return 1
    print(f'callback {dedupe_key(p)}: HTTP {code}')
    return 0 if 200 <= code < 300 else 1


if __name__ == '__main__':
    sys.exit(main())
