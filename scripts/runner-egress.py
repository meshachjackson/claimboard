#!/usr/bin/env python3
"""Limit the runner job's outbound traffic to a short list of hosts (phase B egress allowlist).

  runner-egress.py apply  [--hosts FILE] [--dry-run]   build the filter, then switch it on
  runner-egress.py remove [--dry-run]                  switch it off and delete it (safe to run twice)

Run it with sudo on a GitHub-hosted Ubuntu runner, only around the step that runs the harness.

How it keeps the runner alive:
  - Connections that already exist keep working (conntrack ESTABLISHED,RELATED). That covers the runner's open
    connection to the Actions service, which streams the job's logs.
  - The remote address of every connection open at that moment is also allowed for new HTTPS connections, in case
    the runner reconnects to the same service address.
  - DNS to the resolvers in resolv.conf stays open.
  - Everything else is REJECTed, so a blocked call fails at once with "connection refused" and does not hang.

Fails closed before the harness: if the list cannot be built or a rule is refused, the script removes whatever it
added and exits 1, and the job stops with a clear error. It never leaves a half-built filter on.

Names are resolved to IPv4 addresses three times, a few seconds apart, and the answers are joined, because DNS
round-robin and CDNs hand out different addresses each time. github.com and api.github.com also get GitHub's published
service ranges (the `git`, `api` and `web` lists from https://api.github.com/meta), because git can connect to any
address in them. The `actions` list is not used: it holds the addresses runners connect from. /meta is read BEFORE
the filter turns on, and an unreadable answer stops the run.

Once the rules are in, the script connects to each host the harness needs (TCP connect, no data) and stops the run,
removing its rules, if one is refused. A bad filter fails the job before the model spends tokens.

Hostnames cannot be matched by iptables, so this is an address filter, not a hostname filter (see
docs/runner-actions.md, "Egress allowlist"). IPv6 is rejected except for loopback and existing connections; clients
that try IPv6 first fall back to IPv4 at once.
"""
import argparse
import ipaddress
import json
import re
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

CHAIN = 'RUNNER_EGRESS'
HERE = Path(__file__).resolve().parent
RESOLV_FILES = ('/run/systemd/resolve/resolv.conf', '/etc/resolv.conf')
IP_RE = re.compile(r'^\d{1,3}(?:\.\d{1,3}){3}$')
HOST_RE = re.compile(r'^[a-z0-9.-]+$')
PASSES = 3
PASS_PAUSE = 3.0
META_URL = 'https://api.github.com/meta'
META_KEYS = ('git', 'api', 'web')  # not 'actions': those are the addresses runners connect from
GITHUB_HOSTS = ('github.com', 'api.github.com')
# Hosts the harness needs, checked with a real connect once the rules are in.
SELF_CHECK = ('github.com', 'api.github.com', 'api.anthropic.com', 'registry.npmjs.org')
CHECK_TRIES = 3


def parse_hosts(text):
    """Hostnames (or IPv4 literals) from the hosts file: one per line, `#` starts a comment."""
    out = []
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.split('#', 1)[0].strip()
        if not line:
            continue
        if not HOST_RE.fullmatch(line):
            raise ValueError(f'hosts line {n}: expected one plain hostname, got {line!r}')
        out.append(line)
    return out


def resolve_all(hosts, passes=PASSES, pause=PASS_PAUSE, getaddrinfo=None, sleep=time.sleep):
    """{host: set of IPv4 addresses}, joined over several passes. A host that never resolves maps to an empty set."""
    getaddrinfo = getaddrinfo or socket.getaddrinfo
    found = {h: set() for h in hosts}
    for n in range(passes):
        for h in hosts:
            try:
                found[h] |= {r[4][0] for r in getaddrinfo(h, 443, socket.AF_INET, socket.SOCK_STREAM)}
            except OSError:
                pass
        if n < passes - 1:
            sleep(pause)
    return found


def parse_meta(text):
    """IPv4 CIDR strings from the git, api and web lists of the /meta answer. Raises ValueError if it cannot be used.

    IPv6 entries are skipped (IPv6 stays blocked). Every key must be a list, so a changed answer fails closed."""
    try:
        data = json.loads(text)
    except ValueError as e:
        raise ValueError(f'/meta is not JSON: {e}')
    out = set()
    for key in META_KEYS:
        items = data.get(key) if isinstance(data, dict) else None
        if not isinstance(items, list) or not items:
            raise ValueError(f'/meta has no usable "{key}" list')
        for item in items:
            try:
                net = ipaddress.ip_network(str(item), strict=False)
            except ValueError:
                raise ValueError(f'/meta "{key}" has a bad entry: {str(item)[:40]!r}')
            if net.version == 4:
                out.add(str(net))
    if not out:
        raise ValueError('/meta lists no IPv4 ranges')
    return out


def fetch_meta(url=META_URL, tries=3, timeout=8, sleep=time.sleep, urlopen=urllib.request.urlopen):
    """Read /meta with a few tries. Raises RuntimeError naming the reason if it never works."""
    last = 'no answer'
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'agent-board-runner-egress', 'Accept': 'application/json'})
            with urlopen(req, timeout=timeout) as resp:
                return parse_meta(resp.read().decode('utf-8'))
        except Exception as e:  # network, HTTP (a 403 here is usually the unauthenticated rate limit) or parse errors
            last = f'{type(e).__name__}: {e}'
        if n < tries - 1:
            sleep(2 * (n + 1))
    raise RuntimeError(f'could not read {url} ({last}); refusing to turn the filter on')


def tcp_connect(host, port=443, timeout=4):
    """One TCP connect, no data. Dual stack like a real client: tries every address the name gives, then gives up."""
    with socket.create_connection((host, port), timeout=timeout):
        pass


def self_check(hosts, connect=tcp_connect, tries=CHECK_TRIES, sleep=time.sleep):
    """Connect to each host with the filter on. Returns (output lines, name of the first host that was refused or None)."""
    lines = []
    for h in hosts:
        err = ''
        for n in range(tries):
            try:
                connect(h)
                lines.append(f'self-check {h}:443 ok')
                break
            except OSError as e:
                err = str(e) or type(e).__name__
                if n < tries - 1:
                    sleep(2)
        else:
            lines.append(f'self-check {h}:443 FAILED after {tries} tries: {err}')
            return lines, h
    return lines, None


def resolvers(texts):
    """Upstream nameserver addresses from resolv.conf texts. The 127.* stub is skipped; loopback is always open."""
    found = []
    for text in texts:
        for line in text.splitlines():
            m = re.match(r'^\s*nameserver\s+(\S+)', line)
            if m and IP_RE.match(m.group(1)) and not m.group(1).startswith('127.') and m.group(1) not in found:
                found.append(m.group(1))
    return found


def peers(ss_text):
    """Remote IPv4 addresses on port 443 from `ss -tnH state established` output."""
    found = set()
    for line in ss_text.splitlines():
        cols = line.split()
        if len(cols) >= 4:
            addr, _, port = cols[-1].rpartition(':')
            if port == '443' and IP_RE.match(addr) and not addr.startswith('127.'):
                found.add(addr)
    return found


def rules(hosts_ips, dns, peer_ips, cidrs=()):
    """The iptables argument lists for the chain, in order. The last rule rejects everything left.

    cidrs are GitHub's ranges from /meta; `-d` takes an address or a range, so they use the same rule shape."""
    r = [['-o', 'lo', '-j', 'ACCEPT'],
         ['-m', 'conntrack', '--ctstate', 'ESTABLISHED,RELATED', '-j', 'ACCEPT']]
    for ip in dns:
        r += [['-d', ip, '-p', proto, '--dport', '53', '-j', 'ACCEPT'] for proto in ('udp', 'tcp')]
    for ip in sorted(hosts_ips | peer_ips) + sorted(cidrs):
        r.append(['-d', ip, '-p', 'tcp', '--dport', '443', '-j', 'ACCEPT'])
    r += [['-p', 'tcp', '-j', 'REJECT', '--reject-with', 'tcp-reset'], ['-j', 'REJECT']]
    return r


def run_cmd(cmd, dry):
    if dry:
        print(' '.join(cmd))
        return 0
    return subprocess.run(cmd, capture_output=True, text=True).returncode


def remove(dry):
    """Take the filter out. Every step tolerates 'already gone'."""
    for tool in ('iptables', 'ip6tables'):
        while run_cmd([tool, '-w', '-D', 'OUTPUT', '-j', CHAIN], dry) == 0 and not dry:
            pass
        run_cmd([tool, '-w', '-F', CHAIN], dry)
        run_cmd([tool, '-w', '-X', CHAIN], dry)
    print('egress filter removed')
    return 0


def apply(args):
    dry = args.dry_run
    hosts = parse_hosts(args.hosts.read_text())
    if not hosts:
        print('the hosts file lists no hosts', file=sys.stderr)
        return 1
    found = resolve_all(hosts, passes=1 if args.fast else PASSES, pause=PASS_PAUSE)
    failed = [h for h in hosts if not found[h]]
    if failed:
        # A missing host would fail later with a confusing error. Stop now instead.
        print('did not resolve: ' + ', '.join(failed), file=sys.stderr)
        return 1
    ips = set().union(*found.values())
    # GitHub's ranges are read now, while the network is still open. If they cannot be read, stop.
    cidrs = set()
    if any(h in GITHUB_HOSTS for h in hosts):
        try:
            cidrs = parse_meta(args.meta_file.read_text()) if args.meta_file else fetch_meta()
        except (ValueError, RuntimeError, OSError) as e:
            print(f'github ranges unavailable: {e}', file=sys.stderr)
            return 1
    dns = resolvers([Path(p).read_text() for p in args.resolv if Path(p).exists()])
    peer_ips = set()
    if not args.no_peers:
        ss = subprocess.run(['ss', '-tnH', 'state', 'established'], capture_output=True, text=True)
        if ss.returncode != 0:
            print('ss failed; cannot read the runner connections', file=sys.stderr)
            return 1
        peer_ips = peers(ss.stdout)
    chain_rules = rules(ips, dns, peer_ips, cidrs)
    try:
        for tool in ('iptables', 'ip6tables'):
            if run_cmd([tool, '-w', '-N', CHAIN], dry) != 0:
                raise RuntimeError(f'{tool} would not create the chain')
        for r in chain_rules:
            if run_cmd(['iptables', '-w', '-A', CHAIN, *r], dry) != 0:
                raise RuntimeError('iptables refused: ' + ' '.join(r))
        # IPv6: loopback and existing connections only.
        for r in (['-o', 'lo', '-j', 'ACCEPT'], ['-m', 'conntrack', '--ctstate', 'ESTABLISHED,RELATED', '-j', 'ACCEPT'], ['-j', 'REJECT']):
            if run_cmd(['ip6tables', '-w', '-A', CHAIN, *r], dry) != 0:
                raise RuntimeError('ip6tables refused: ' + ' '.join(r))
        # The jump goes in last, so the chain is complete before it filters anything.
        for tool in ('iptables', 'ip6tables'):
            if run_cmd([tool, '-w', '-I', 'OUTPUT', '1', '-j', CHAIN], dry) != 0:
                raise RuntimeError(f'{tool} would not switch the chain on')
    except RuntimeError as e:
        print(f'egress filter failed: {e}', file=sys.stderr)
        remove(dry)
        return 1
    print(f'egress filter on: {len(hosts)} hosts -> {len(ips)} addresses + {len(cidrs)} github ranges, '
          f'{len(dns)} resolvers, {len(peer_ips)} open peers')
    # Prove the filter lets the harness through before the model spends tokens. Dry runs and tests skip the connects.
    if dry or args.no_self_check:
        print('self-check skipped')
        return 0
    lines, refused = self_check([h for h in SELF_CHECK])
    print('\n'.join(lines))
    if refused:
        print(f'egress filter failed: {refused}:443 was refused with the filter on; rules removed', file=sys.stderr)
        remove(dry)
        return 1
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('action', choices=('apply', 'remove'))
    ap.add_argument('--hosts', type=Path, default=HERE / 'runner-egress-hosts.txt')
    ap.add_argument('--dry-run', action='store_true', help='print the commands, change nothing')
    ap.add_argument('--resolv', nargs='*', default=list(RESOLV_FILES), help='resolv.conf files to read (tests only)')
    ap.add_argument('--no-peers', action='store_true', help='skip the open-connection snapshot (tests only)')
    ap.add_argument('--fast', action='store_true', help='resolve once, not three times (tests only)')
    ap.add_argument('--meta-file', type=Path, help='read the /meta answer from this file, not the network (tests only)')
    ap.add_argument('--no-self-check', action='store_true', help='skip the connect checks (tests only)')
    args = ap.parse_args(argv)
    return remove(args.dry_run) if args.action == 'remove' else apply(args)


if __name__ == '__main__':
    sys.exit(main())
