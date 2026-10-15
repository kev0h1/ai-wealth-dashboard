"""G274 local-only browser checks. Every unexpected API request is blocked."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlencode, urlparse
from playwright.sync_api import expect, sync_playwright

args_parser = argparse.ArgumentParser()
args_parser.add_argument('--base-url', default='http://127.0.0.1:3144')
args = args_parser.parse_args()
assert urlparse(args.base_url).hostname in {'127.0.0.1', 'localhost'}
out = Path(__file__).resolve().parents[3] / '.impeccable/review/g274'
out.mkdir(parents=True, exist_ok=True)
errors = []
reads = {'/api/cashflow/at-risk-count': {'count': 0}, '/api/categories': [], '/api/preferences': {'hide_net_worth': True}}
with sync_playwright() as runner:
    browser = runner.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True)
    context = browser.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, reduced_motion='reduce')
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
    page = None
    def visit(**query):
        global page
        if page is not None:
            page.close()
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(args.base_url + '/design/keep-money-here?' + urlencode(query), wait_until='networkidle')
        page.evaluate('document.fonts.ready')
        expect(page.get_by_role('dialog')).to_be_visible()
    def capture(name):
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), name
        assert page.locator('[data-sheet-frame]').evaluate('n => n.scrollWidth <= n.clientWidth+1'), name
        rect = page.locator('[data-sheet-footer]').bounding_box()
        assert rect and rect['y']+rect['height'] <= page.viewport_size['height']+1, name
        page.screenshot(path=str(out/name))
    for variant in ('a','b'):
        for mode in ('light','dark'):
            for scenario in ('one','many'):
                visit(variant=variant,mode=mode,scenario=scenario)
                capture(f'phone-{variant}-{scenario}-{mode}.png')
                if variant == 'b':
                    page.get_by_role('button',name='Review set-aside',exact=True).click()
                    capture(f'phone-b-review-{scenario}-{mode}.png')
                if scenario == 'one':
                    expect(page.get_by_role('button',name='Change paying account')).to_have_count(0)
                    expect(page.get_by_text('Choose a receiving account',exact=True)).to_have_count(0)
                    expect(page.get_by_text('You only need this account.',exact=False)).to_be_visible()
                else:
                    expect(page.get_by_role('radio',name='Keep it in this account',exact=False)).to_be_checked()
                page.get_by_role('button',name='Confirm set-aside',exact=True).click()
                expect(page.get_by_role('button',name='Confirming…')).to_be_disabled()
                expect(page.get_by_role('heading',name='Preview confirmed')).to_be_visible()
                page.get_by_role('button',name='Done',exact=True).click()
                expect(page.get_by_role('dialog')).to_have_count(0)
    visit(variant='a',scenario='many',mode='dark')
    page.get_by_role('radio',name='I’ll move it to another account',exact=False).check()
    expect(page.get_by_role('button',name='Confirm set-aside',exact=True)).to_be_disabled()
    page.get_by_role('button',name='Choose a receiving account',exact=True).click()
    page.get_by_role('radio',name='Holiday',exact=False).click()
    page.get_by_role('button',name='Use this choice',exact=True).click()
    page.get_by_role('button',name='Choose a transfer to recognise',exact=True).click()
    page.get_by_role('button',name='Monthly car fund',exact=False).click()
    page.get_by_role('button',name='Use this choice',exact=True).click()
    expect(page.get_by_role('button',name='Confirm set-aside',exact=True)).to_be_enabled()
    page.get_by_role('button',name='Change paying account',exact=True).click()
    page.get_by_role('radio',name='Premier current account',exact=False).click()
    page.get_by_role('button',name='Use this choice',exact=True).click()
    expect(page.get_by_role('button',name='Confirm set-aside',exact=True)).to_be_disabled()
    page.get_by_role('radio',name='Keep it in this account',exact=False).check()
    expect(page.get_by_role('button',name='Confirm set-aside',exact=True)).to_be_enabled()
    visit(variant='a',scenario='many',edit='1',mode='dark')
    expect(page.get_by_role('radio',name='I’ll move it to another account',exact=False)).to_be_checked()
    expect(page.get_by_role('button',name='Monthly car fund',exact=True)).to_be_visible()
    expect(page.get_by_role('button',name='Confirm set-aside',exact=True)).to_be_enabled()
    visit(variant='a',scenario='global')
    expect(page.get_by_role('button',name='Confirm set-aside',exact=True)).to_be_disabled()
    visit(variant='b',scenario='none')
    expect(page.get_by_role('button',name='Review set-aside',exact=True)).to_be_disabled()
    visit(variant='a',scenario='one',state='load-error')
    page.get_by_role('button',name='Try loading accounts again').click()
    expect(page.get_by_role('button',name='Confirm set-aside',exact=True)).to_be_enabled()
    visit(variant='a',scenario='one',state='save-error',mode='dark')
    page.get_by_role('button',name='Confirm set-aside',exact=True).click()
    expect(page.get_by_role('dialog').get_by_role('alert')).to_contain_text('Your draft is still here')
    capture('phone-save-error-dark.png')
    page.get_by_role('button',name='Confirm set-aside',exact=True).click()
    expect(page.get_by_role('heading',name='Preview confirmed')).to_be_visible()
    for width,height,label in ((320,740,'narrow'),(1440,1000,'desktop')):
        context.set_default_timeout(15000)
        for variant in ('a','b'):
            visit(variant=variant,scenario='many',mode='dark')
            page.set_viewport_size({'width':width,'height':height})
            capture(f'{label}-{variant}-dark.png')
    page.keyboard.press('Tab')
    assert page.locator('[data-sheet-frame]').evaluate('n => n.contains(document.activeElement)')
    page.keyboard.press('Escape')
    expect(page.get_by_role('dialog')).to_have_count(0)
    context.close(); browser.close()
assert not errors, errors
print('PASS G274: both variants/themes, one/many/global/no-source, optional transfer and rule reset, preserved edit, load/save retry, responsive bounds and keyboard dismissal; no API writes.')
