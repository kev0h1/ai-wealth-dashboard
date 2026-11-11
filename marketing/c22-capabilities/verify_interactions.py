"""Exercise the optional fixture seams through the real chat controls."""
import argparse
import datetime
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
SHELL = {"/api/cashflow/at-risk-count": {"count": 0}, "/api/categories": [], "/api/preferences": {"hide_net_worth": False}}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:3146')
    args = parser.parse_args()
    assert urlparse(args.base).hostname in {'localhost', '127.0.0.1'}
    unexpected, results = [], []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 422, 'height': 1100}, reduced_motion='reduce')
        def guard(route):
            path = urlparse(route.request.url).path
            if path in SHELL and route.request.method == 'GET':
                route.fulfill(status=200, content_type='application/json', body=json.dumps(SHELL[path]))
            elif '/api/' in path:
                unexpected.append(f'{route.request.method} {path}')
                route.abort()
            else:
                route.continue_()
        context.route('**/*', guard)
        page = context.new_page()
        page.clock.set_fixed_time(datetime.datetime(2026, 11, 11, 12, tzinfo=datetime.UTC))
        for theme in ('light', 'dark'):
            page.goto(args.base + '/design/marketing-kit?feature-proof=penny-proposal&mode=' + theme, wait_until='domcontentloaded')
            proof = page.locator('[data-feature-proof]').first
            goal = page.get_by_role('region', name='Goal proposal')
            expect(goal).to_be_visible()
            goal.get_by_role('button', name='Change', exact=True).click()
            expect(proof.get_by_role('radio')).to_have_count(1)
            expect(proof.get_by_role('radio')).to_contain_text('Everyday account')
            proof.get_by_role('button', name='Back', exact=True).click()
            expect(goal).to_be_visible()
            goal.get_by_role('button', name='Cancel', exact=True).click()
            expect(proof).to_contain_text('Cancelled')
            expect(proof.get_by_role('button', name='Create goal', exact=True)).to_have_count(0)
            results.append({'theme': theme, 'sourcePicker': 'fixture account, no API', 'back': 'returns to actual goal card', 'cancel': 'no goal created'})
        browser.close()
    assert not unexpected, unexpected
    out = ROOT / 'marketing/c22-capabilities/interaction-review.json'
    out.write_text(json.dumps({'date': '2026-11-11', 'unexpectedApi': unexpected, 'results': results}, indent=2) + '\n')
    print('Real source-picker, Back and Cancel controls passed in both themes; no live API.')

if __name__ == '__main__': main()
