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
TICKET_FILENAME = re.compile(r'^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$')


def check() -> list[str]:
    errors = []
    ticket_files: dict[str, Path] = {}
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

        if path.parent != ROOT / 'notes':
            continue
        filename_match = TICKET_FILENAME.fullmatch(path.name)
        if filename_match is None:
            if path.name[:2].isdigit():
                errors.append(f'{path.name}: invalid numbered ticket filename')
            continue

        ticket_id = filename_match.group(1)
        if ticket_id in ticket_files:
            errors.append(f'{path.name}: duplicate ticket id {ticket_id} (also {ticket_files[ticket_id].name})')
        else:
            ticket_files[ticket_id] = path

        metadata = re.match(r'---\n(.*?)\n---', text, re.DOTALL)
        if metadata is None:
            errors.append(f'{path.name}: missing ticket metadata')
            continue
        fields = metadata.group(1)
        id_match = re.search(r'^id: "(\d{2})"$', fields, re.MULTILINE)
        if id_match is None or id_match.group(1) != ticket_id:
            errors.append(f'{path.name}: id disagrees with filename')
        status = re.search(r'^status: (\S+)$', fields, re.MULTILINE)
        if status is None or status.group(1) not in {'ready', 'blocked', 'in_progress', 'in_review', 'done'}:
            errors.append(f'{path.name}: invalid status')
        branch = re.search(r'^branch: "([^"]+)"$', fields, re.MULTILINE)
        if branch is None or branch.group(1) != f'V2/{path.stem}':
            errors.append(f'{path.name}: branch disagrees with filename')
        blockers = re.search(r'^blocked_by: \[(.*?)\]$', fields, re.MULTILINE)
        if blockers is None:
            errors.append(f'{path.name}: missing blocker list')
        else:
            for blocker in re.findall(r'\d+', blockers.group(1)):
                blocker_id = f'{int(blocker):02d}'
                if not list((ROOT / 'notes').glob(f'{blocker_id}-*.md')):
                    errors.append(f'{path.name}: unknown blocker {blocker}')

    original = {f'{n:02d}' for n in range(23)}
    present = set(ticket_files)
    if not original.issubset(present):
        errors.append(f'original ticket index mismatch: missing={original - present}')
    if present:
        expected = {f'{n:02d}' for n in range(max(map(int, present)) + 1)}
        if present != expected:
            errors.append(f'ticket index gap: missing={expected - present}, extra={present - expected}')
    return errors


if __name__ == '__main__':
    failures = check()
    if failures:
        print('\n'.join(failures), file=sys.stderr)
        sys.exit(1)
    ticket_count = sum(
        1 for path in (ROOT / 'notes').glob('*.md')
        if TICKET_FILENAME.fullmatch(path.name)
    )
    print(f'Documentation checks passed ({len(DOCS)} files; {ticket_count} ticket notes).')
