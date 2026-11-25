"""Reproduce the C22 gallery, keyboard, download and divider checks locally."""
import importlib.util
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('c22_export',ROOT/'marketing/c22-phones/export_assets.py')
export=importlib.util.module_from_spec(spec);spec.loader.exec_module(export)
data=export.catalog()
OUT=ROOT/'frontend/.screens/c22-phones'
OUT.mkdir(parents=True,exist_ok=True)
results=[];captures=[];errors=[];requests=[]
MEASURE=r'''() => {
 const p=document.querySelector('[data-c22-product]'),a=document.querySelector('[data-c22-artboard]');
 const scale=p.getBoundingClientRect().width/p.clientWidth;
 const closed=[...p.querySelectorAll('summary')].filter(el=>!el.parentElement.open)
  .concat([...p.querySelectorAll('[data-schedule-disclosure]>button[aria-expanded="false"]')])
  .filter(el=>el.getBoundingClientRect().height>0);
 const disclosures=closed.map(el=>{const r=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);const c=range.getBoundingClientRect();return{label:el.innerText,top:(c.top-r.top)/scale,bottom:(r.bottom-c.bottom)/scale,height:r.height/scale}});
 const identityRows=[];
 for(const node of p.querySelectorAll('[data-bill-key] > div.pointer-events-none,[data-tutorial-id="tutorial-planning-allocations"] > button')){
  const r=node.getBoundingClientRect(),children=[...node.children].map(n=>n.getBoundingClientRect()).filter(b=>b.width>0&&b.height>0);
  if(r.height>0&&children.length)identityRows.push({label:node.innerText,top:(Math.min(...children.map(b=>b.top))-r.top)/scale,bottom:(r.bottom-Math.max(...children.map(b=>b.bottom)))/scale});
 }
 const art=a.getBoundingClientRect();
 const controls=[...document.querySelectorAll('[aria-label="Artwork controls"] a,[aria-label="Artwork controls"] select')].map(el=>{const r=el.getBoundingClientRect();return{label:el.innerText||el.getAttribute('aria-label'),height:r.height,width:r.width}});
 return{disclosures,identityRows,productWidth:p.clientWidth,artboard:{left:art.left,right:art.right,top:art.top,width:art.width,height:art.height},scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,controls,
  navDisplayed:getComputedStyle(p.querySelector('nav[data-penny-navigation]')).display,
  allProductControlsInert:[...p.querySelectorAll('button,a,summary,input,select')].every(el=>!!el.closest('[inert]')),
  background:getComputedStyle(p).backgroundColor,text:a.innerText};
}'''
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--virtual-time-budget=4000'])
 for theme in ['light','dark']:
  context=browser.new_context(device_scale_factor=1,reduced_motion='reduce',color_scheme=theme)
  context.add_init_script(f"localStorage.setItem('wd_dark','{1 if theme=='dark' else 0}')")
  context.add_init_script("""(()=>{const D=Date,t=D.parse('2026-11-17T09:41:00Z');window.Date=class extends D{constructor(...a){super(...(a.length?a:[t]));}static now(){return t;}}})();""")
  def guard(route):
   parsed=urlparse(route.request.url);path=parsed.path
   if path in export.SHELL_GETS and route.request.method=='GET':
    route.fulfill(status=200,content_type='application/json',body=json.dumps(export.SHELL_GETS[path]));requests.append(path)
   elif '/api/' in path:errors.append(f'Unexpected API {route.request.method} {path}');route.abort()
   elif parsed.scheme in ['http','https'] and parsed.hostname not in ['localhost','127.0.0.1']:errors.append(f'External {parsed.hostname}{path}');route.abort()
   else:route.continue_()
  context.route('**/*',guard)
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  for width in [320,390,1440]:
   page.set_viewport_size({'width':width,'height':900})
   response=page.goto(f'http://127.0.0.1:3158/design/marketing-phones?mode={theme}',wait_until='networkidle');assert response.status==200
   page.wait_for_selector('[data-c22-viewport-ready="true"]');page.evaluate('document.fonts.ready')
   page.wait_for_function('document.querySelector("[data-c22-preview-ready=true]") !== null')
   page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
   page.add_style_tag(content='nextjs-portal{display:none!important}');page.evaluate('window.scrollTo(0,0)')
   measure=page.evaluate(MEASURE);results.append({'theme':theme,'width':width,'story':'amount',**measure})
   assert measure['scrollWidth']<=width+1 and measure['allProductControlsInert']
   assert measure['navDisplayed']=='flex' and measure['productWidth']>=320
   assert all(el['height']>=43.9 for el in measure['controls'])
   assert all(abs(row['top']-row['bottom'])<=1.01 for row in measure['disclosures'])
   if width<500:assert measure['artboard']['top']<=500,measure['artboard']
   name=f'gallery-{theme}-{width}-top.png';page.screenshot(path=str(OUT/name));captures.append(str(OUT/name))
   if width in [390,1440]:
    page.locator('[class*=previewShell]').scroll_into_view_if_needed();name=f'gallery-{theme}-{width}-preview.png';page.screenshot(path=str(OUT/name));captures.append(str(OUT/name))
    for story in ['upcoming','cover','aside','goal']:
     page.goto(f'http://127.0.0.1:3158/design/marketing-phones?mode={theme}&story={story}',wait_until='networkidle')
     page.wait_for_selector('[data-c22-viewport-ready="true"]');page.evaluate('document.fonts.ready')
     m=page.evaluate(MEASURE);results.append({'theme':theme,'width':width,'story':story,**m})
     assert all(abs(row['top']-row['bottom'])<=1.01 for row in m['disclosures']),m['disclosures']
     assert all(abs(row['top']-row['bottom'])<=1.01 for row in m['identityRows']),m['identityRows']
  context.close()
 context=browser.new_context(viewport={'width':390,'height':900},reduced_motion='reduce')
 context.route('**/api/**',lambda route:route.abort())
 page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:3158/design/marketing-phones',wait_until='networkidle')
 page.wait_for_selector('[data-c22-viewport-ready="true"]')
 focused=[]
 for _ in range(9):
  page.keyboard.press('Tab')
  focused.append(page.evaluate("""()=>({tag:document.activeElement.tagName,label:document.activeElement.innerText||document.activeElement.getAttribute('aria-label'),inProduct:!!document.activeElement.closest('[data-c22-product]'),outline:getComputedStyle(document.activeElement).outlineWidth})"""))
 assert all(not f['inProduct'] for f in focused)
 page.get_by_label('Device export',exact=True).select_option('android');page.wait_for_url('**format=android**');page.wait_for_selector('[data-c22-viewport-ready="true"]')
 page.get_by_label('Story',exact=True).select_option('cover');page.wait_for_url('**story=cover**');page.wait_for_selector('[data-c22-product="cover"]')
 page.get_by_role('link',name='B · Close view',exact=True).click();page.wait_for_selector('[data-c22-variant="b"]')
 page.get_by_role('link',name='Dark',exact=True).click();page.wait_for_selector('[data-c22-theme="dark"]')
 page.wait_for_selector('[data-c22-viewport-ready="true"]');assert page.locator('[data-c22-product]').evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(15, 23, 42)'
 control_url=page.url
 page.goto('http://127.0.0.1:3158/design/marketing-phones?state=upcoming',wait_until='networkidle');page.wait_for_selector('[data-c22-product="upcoming"]')
 manifest=json.loads((export.OUT/'manifest.json').read_text());http=[]
 for item in manifest['assets']+manifest['packs']:
  path='/design-media/c22/phones/'+item['file'];response=context.request.head('http://127.0.0.1:3158'+path)
  assert response.status==200,(path,response.status);http.append(path)
 assert context.request.get('http://127.0.0.1:3158/design-media/c22/phones/manifest.json').status==200
 context.close()
 theme_switches=[]
 for saved in ['0','1']:
  context=browser.new_context(viewport={'width':390,'height':900},reduced_motion='reduce')
  context.add_init_script("localStorage.setItem('wd_dark','"+saved+"')")
  context.route('**/api/**',lambda route:route.fulfill(status=200,content_type='application/json',body='{}'))
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:3158/design',wait_until='networkidle')
  original_scheme=page.evaluate('document.documentElement.style.colorScheme')
  page.goto('http://127.0.0.1:3158/design/marketing-phones?mode=dark',wait_until='networkidle')
  page.wait_for_selector('[data-c22-viewport-ready="true"]')
  states=[]
  for theme in ['light','dark','light']:
   page.get_by_role('link',name=theme.title(),exact=True).click()
   page.wait_for_selector('[data-c22-theme="'+theme+'"]')
   page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
   state=page.evaluate("""()=>({htmlDark:document.documentElement.classList.contains('dark'),card:getComputedStyle(document.querySelector('[data-g324-hero]')).backgroundColor,saved:localStorage.getItem('wd_dark')})""")
   assert state['htmlDark']==(theme=='dark') and state['saved']==saved,state
   states.append({'theme':theme,**state})
  assert states[0]['card']==states[2]['card'] and states[0]['card']!=states[1]['card']
  page.get_by_role('link',name='Design previews',exact=True).click();page.wait_for_url('**/design')
  page.wait_for_function("document.documentElement.classList.contains('dark') === "+('true' if saved=='1' else 'false'))
  assert page.evaluate("document.documentElement.classList.contains('dark')")==(saved=='1')
  assert page.evaluate("document.documentElement.style.colorScheme") == original_scheme
  theme_switches.append({'saved':saved,'states':states,'restored':True,'restoredInlineScheme':original_scheme})
  context.close()
 browser.close()
assert not errors,errors
record={'status':'passed','cases':results,'captures':captures,'pageErrors':errors,'shellGets':sorted(set(requests)),'keyboard':focused,'controlUrl':control_url,'http200Assets':http,'themeSwitches':theme_switches}
(OUT/'review.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'status':'passed','cases':len(results),'captures':len(captures),'downloadResponses200':len(http),'pageErrors':errors},indent=2))
