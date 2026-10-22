#!/usr/bin/env python3
"""Offline documentation integrity checks; external URLs are never fetched."""
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
DOCS = [ROOT / 'README.md', ROOT / 'design.md', *sorted((ROOT / 'notes').glob('*.md')),
        ROOT / 'frontend' / 'README.md', *sorted((ROOT / 'docs').glob('*.md'))]
LINK = re.compile(r'!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)')


def check() -> list[str]:
    errors = []
    tickets = set()
    for path in DOCS:
        text = path.read_text()
        # Code examples aren't navigable document links.
        prose = re.sub(r'```.*?```', '', text, flags=re.DOTALL)
        for match in LINK.finditer(prose):
            link = urlsplit(match.group(1).strip('<>'))
            if link.scheme or link.netloc or not link.path:
                continue
            target = (path.parent / unquote(link.path)).resolve()
            if not target.is_relative_to(ROOT) or not target.exists():
                errors.append(f'{path.relative_to(ROOT)}: broken local link {match.group(1)}')
        if path.parent == ROOT / 'notes' and path.name[:2].isdigit():
            ticket_id = path.name[:2]
            tickets.add(ticket_id)
            metadata = re.match(r'---\n(.*?)\n---', text, re.DOTALL)
            if metadata is None:
                errors.append(f'{path.name}: missing ticket metadata')
                continue
            fields = metadata.group(1)
            if f'id: "{ticket_id}"' not in fields:
                errors.append(f'{path.name}: id disagrees with filename')
            status = re.search(r'^status: (\S+)$', fields, re.MULTILINE)
            if status is None or status.group(1) not in {'ready', 'blocked', 'in_progress', 'in_review', 'done'}:
                errors.append(f'{path.name}: invalid status')
            if f'branch: "V2/{path.stem}"' not in fields:
                errors.append(f'{path.name}: branch disagrees with filename')
            blockers = re.search(r'^blocked_by: \[(.*?)\]$', fields, re.MULTILINE)
            if blockers is None:
                errors.append(f'{path.name}: missing blocker list')
            else:
                for blocker in re.findall(r'\d+', blockers.group(1)):
                    if not list((ROOT / 'notes').glob(f'{int(blocker):02d}-*.md')):
                        errors.append(f'{path.name}: unknown blocker {blocker}')
    expected = {f'{n:02d}' for n in range(23)}
    if tickets != expected:
        errors.append(f'ticket index mismatch: missing={expected - tickets}, extra={tickets - expected}')
    return errors


if __name__ == '__main__':
    failures = check()
    if failures:
        print('\n'.join(failures), file=sys.stderr)
        sys.exit(1)
    print(f'Documentation checks passed ({len(DOCS)} files; 23 ticket notes).')
