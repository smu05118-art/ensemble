#!/usr/bin/env python3
"""Reapply the AI-cloud entry after regenerating either Ensemble home document."""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
TAG = '<script src="cloud/ensemble-tab.js" data-ensemble-cloud="v2"></script>'
def inject(text):
    if TAG in text:
        return text
    if '</body>' not in text:
        raise ValueError('No closing body in Ensemble home')
    return text.replace('</body>', TAG + '\n</body>', 1)
if __name__ == '__main__':
    for name in ('index.html', 'ensemble_home.html'):
        path = ROOT / name
        before = path.read_text(); after = inject(before)
        if before != after:
            path.write_text(after)
        print(name + ': AI-cloud entry ready')
