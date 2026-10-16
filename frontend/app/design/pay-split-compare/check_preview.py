"""G279 local-only component preview checks. All customer API traffic is inert."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlencode, urlparse
from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:3160')
parser.add_argument('--interactions-only', action='store_true')
parser.add_argument('--errors-only', action='store_true')
args = parser.parse_args()
assert urlparse(args.base_url).hostname in {'127.0.0.1', 'localhost'}
out = Path(__file__).resolve().parents[3] / '.impeccable/review/g279'
out.mkdir(parents=True, exist_ok=True)
errors = []
reads = {'/api/cashflow/at-risk-count': {'count': 0}, '/api/categories': [], '/api/preferences': {'hide_net_worth': True}}
with sync_playwright() as runner:
    browser = runner.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True)
    context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, reduced_motion='reduce')
    def guard(route):
        path = urlparse(route.request.url).path
        if path in reads and route.request.method == 'GET':
            route.fulfill(status=200, content_type='application/json', body=json.dumps(reads[path]))
        elif '/api/' in path:
            errors.append(f'Unexpected API: {route.request.method} {path}')
            route.abort()
        else:
            route.continue_()
    context.route('**/*', guard)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    def visit(**query):
        page.goto(args.base_url + '/design/pay-split-compare?' + urlencode(query), wait_until='networkidle')
        expect(page.get_by_role('heading', name='Pay-split comparison', exact=True)).to_be_visible()
        page.wait_for_function('document.fonts.status === "loaded"')
        # Hydration/entrance settling, matching the repository's 4s screenshot budget.
        page.wait_for_timeout(4000)
        assert page.evaluate('document.documentElement.classList.contains("dark")') == (query.get('mode') == 'dark')
    def capture(name):
        page.evaluate('window.scrollTo(0,0)')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), name
        sheet = page.locator('[data-sheet-frame]')
        if sheet.count():
            assert sheet.evaluate('n=>n.scrollWidth<=n.clientWidth+1'), name
            rect = sheet.bounding_box()
            assert rect and rect['y'] >= -1 and rect['y'] + rect['height'] <= page.viewport_size['height'] + 1, name
        page.screenshot(path=str(out/name), full_page=not bool(sheet.count()))
        print('capture', name, flush=True)
    for variant in (() if args.interactions_only or args.errors_only else ('a', 'b')):
        for view in ('card', 'detail'):
            for mode in ('light', 'dark'):
                for scenario in ('under', 'fixed', 'free', 'beyond', 'thin'):
                    visit(variant=variant, view=view, mode=mode, scenario=scenario)
                    comparison = page.get_by_role('region', name='Reference comparison', exact=True)
                    expect(comparison).to_be_visible()
                    if scenario == 'thin':
                        expect(comparison).to_contain_text('No comparison yet')
                        assert '£0' not in comparison.inner_text()
                    elif scenario == 'beyond':
                        expect(comparison).to_contain_text('£414')
                        expect(comparison).to_contain_text('£98.80')
                        expect(comparison).to_contain_text('−£5.80')
                    if variant == 'a' and view == 'detail' and scenario != 'thin':
                        expect(page.get_by_label('Paired actual and reference bars', exact=True)).to_be_visible()
                    capture(f'phone-{variant}-{view}-{scenario}-{mode}.png')
    for mode in (() if args.errors_only else ('light', 'dark')):
        visit(variant='b', view='detail', scenario='beyond', mode=mode)
        for section, amount in [('Fixed', '£2,836'), ('Moved', '£963'), ('Free', '£1,552')]:
            opener = page.get_by_role('button', name=f'View {section} evidence', exact=True)
            opener.click()
            dialog = page.get_by_role('dialog', name=section+' evidence', exact=True)
            expect(dialog).to_be_visible()
            expect(dialog).to_contain_text(amount)
            if section == 'Fixed':
                capture(f'phone-evidence-{mode}.png')
            page.keyboard.press('Tab')
            assert page.locator('[data-sheet-frame]').evaluate('n=>n.contains(document.activeElement)')
            page.keyboard.press('Escape')
            expect(dialog).to_have_count(0)
            expect(opener).to_be_focused()
        # Existing production job links must stay inside the inert preview.
        page.get_by_role('link', name='Fixed, Bills and commitments', exact=True).click()
        expect(page.get_by_role('dialog', name='Fixed evidence', exact=True)).to_be_visible()
        assert '/design/pay-split-compare' in page.url
        page.keyboard.press('Escape')
        page.get_by_role('button', name='Choose a reference', exact=True).click()
        capture(f'phone-reference-picker-{mode}.png')
        page.get_by_role('radio', name='Conscious Spending Plan · example', exact=False).click(no_wait_after=True)
        expect(page.get_by_role('dialog')).to_have_count(0)
        expect(page.get_by_role('button', name='Choose a reference')).to_contain_text('Conscious Spending Plan')
        page.reload(wait_until='networkidle')
        expect(page.get_by_role('button', name='Choose a reference')).to_contain_text('Conscious Spending Plan')
        capture(f'phone-conscious-{mode}.png')
        page.get_by_role('button', name='Choose a reference').click()
        page.get_by_role('radio', name='Pay yourself first · principle', exact=False).click(no_wait_after=True)
        expect(page.get_by_role('region', name='Reference comparison')).to_contain_text('A principle, not a percentage')
        expect(page.get_by_label('Paired actual and reference bars', exact=True)).to_have_count(0)
        capture(f'phone-principle-{mode}.png')
        page.get_by_role('button', name='How comparison works', exact=True).click()
        expect(page.get_by_role('dialog')).to_contain_text('not exact equivalents')
        capture(f'phone-explanation-{mode}.png')
        page.keyboard.press('Escape')
        page.get_by_role('button', name='Reset reference', exact=True).click()
    for width, height in ([] if args.errors_only else [(320, 740), (1440, 1000)]):
        page.set_viewport_size({'width': width, 'height': height})
        for variant in ('a', 'b'):
            visit(variant=variant, view='detail', scenario='beyond', mode='dark')
            capture(f'{width}-{variant}-detail-dark.png')
    page.set_viewport_size({'width': 390, 'height': 844})
    visit(variant='b', view='detail', state='load-error', mode='dark')
    expect(page.get_by_role('alert').filter(has_text='Could not load')).to_be_visible()
    capture('phone-load-error-dark.png')
    page.get_by_role('button', name='Try again', exact=True).click()
    expect(page.get_by_role('region', name='Reference comparison')).to_be_visible()
    assert 'variant=b' in page.url and 'mode=dark' in page.url and 'view=detail' in page.url
    page.add_init_script("const originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='sorted.design.g279.reference.v1')throw new DOMException('Blocked','SecurityError');return originalSetItem.call(this,k,v)}")
    page.reload(wait_until='networkidle')
    page.get_by_role('button', name='Choose a reference').click()
    page.get_by_role('radio', name='Conscious Spending Plan · example', exact=False).click(no_wait_after=True)
    expect(page.get_by_role('status')).to_contain_text('Not saved on this device')
    expect(page.get_by_role('button', name='Choose a reference')).to_contain_text('Conscious Spending Plan')
    capture('phone-storage-blocked-dark.png')
    context.close()
    browser.close()
assert not errors, errors
print('PASS G279: both coded variants/surfaces/themes, four financial cases and thin, numeric reconciliation, period evidence and safe link interception, remembered/principle references, storage/load errors, responsive bounds and keyboard dismissal; no live API writes.')
