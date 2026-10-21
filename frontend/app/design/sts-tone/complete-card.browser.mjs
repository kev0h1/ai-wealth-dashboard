// Manual, synthetic-only check against the real Next CSS and hydrated card.
// G287_TEST_ORIGIN=http://127.0.0.1:3147 node app/design/sts-tone/complete-card.browser.mjs /tmp/<scratch>
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { get } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const origin = process.env.G287_TEST_ORIGIN || "http://127.0.0.1:3147";
const output = process.argv[2];
assert.ok(output && path.isAbsolute(output), "Pass an absolute scratch output directory");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "g287-complete-chrome-"));
const chrome = spawn("/usr/bin/google-chrome", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
const results = [], exceptions = [], customerRequests = [];
try {
  let port;
  for (let n = 0; n < 100; n++) {
    try { port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; } catch { await delay(100); }
  }
  assert.ok(port, "Chrome exposes a local debugging port");
  const info = await new Promise((resolve, reject) => {
    const request = get({ hostname: "127.0.0.1", port, path: "/json/version" }, response => {
      let body = ""; response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; }); response.on("error", reject);
      response.on("end", () => { try { assert.equal(response.statusCode, 200); resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    });
    request.on("error", reject); request.setTimeout(5000, () => request.destroy(new Error("Chrome metadata timed out")));
  });
  socket = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
    if (message.method === "Network.requestWillBeSent" && /\/api\//.test(message.params.request.url)) customerRequests.push(message.params.request.url);
    const task = pending.get(message.id); if (!task) return;
    pending.delete(message.id); clearTimeout(task.timer);
    if (message.error) task.reject(new Error(`${task.method}: ${JSON.stringify(message.error)}`)); else task.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 45000);
    pending.set(id, { resolve, reject, timer, method }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call("Page.enable"); await call("Runtime.enable"); await call("Network.enable");
  await call("Network.setBlockedURLs", { urls: ["*/api/*", "https://*"] });
  await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const evaluate = async expression => {
    const reply = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails)); return reply.result.value;
  };
  const waitFor = async expression => {
    for (let n = 0; n < 240; n++) { if (await evaluate(`!!(${expression})`)) return; await delay(100); }
    throw new Error(`Timed out: ${expression}; ${JSON.stringify(await evaluate("({url:location.href,ready:document.readyState,theme:document.documentElement.className,marker:document.querySelector('[data-g287-ready]')?.dataset.g287Ready,scenario:document.querySelector('[data-g287-card]')?.dataset.g287Scenario,text:document.body.innerText.slice(0,600)})"))}`);
  };
  const viewport = async width => {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await call("Emulation.setTouchEmulationEnabled", { enabled: width < 600 });
  };
  const navigate = async (variant, state, mode, masked = false) => {
    // An explicit fresh-document and hydration wait is used with persistent
    // CDP; a CLI virtual-time budget would close the target during the matrix.
    await call("Page.navigate", { url: "about:blank" }); await waitFor("location.href === 'about:blank'");
    await call("Page.navigate", { url: `${origin}/design/sts-tone?${new URLSearchParams({ variant, state, mode, masked: masked ? "1" : "0" })}` });
    await waitFor(`document.querySelector('[data-g287-ready="true"]') && document.documentElement.classList.contains('dark') === ${mode === "dark"} && ${masked ? "!document.querySelector('[data-g287-card]')" : `document.querySelector('[data-g287-card="${variant}"][data-g287-scenario="${state}"]')`}`);
    await evaluate("document.fonts.ready.then(() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true)))))");
  };
  const activate = async (selector, touch = false) => {
    const box = await evaluate(`(() => {const e=${selector}; if(!e)throw Error('Missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    if (touch) {
      await call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [box] });
      await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await call("Input.dispatchMouseEvent", { type: "mousePressed", ...box, button: "left", clickCount: 1 });
      await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...box, button: "left", clickCount: 1 });
    }
  };
  const key = async (key, code, keyCode) => {
    await call("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  };
  const screenshot = async name => {
    await evaluate("scrollTo(0,0)");
    const clip = await evaluate("(() => {const paired=document.querySelector('[data-g287-upcoming]');const r=document.querySelector(paired?'#complete-card-proposal':'[data-g287-card]')?.getBoundingClientRect();return r?{x:Math.max(0,r.x-2),y:Math.max(0,r.y-2),width:r.width+4,height:r.height+4}:null;})()");
    const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    await writeFile(path.join(output, `${name}.png`), Buffer.from(shot.data, "base64"));
  };
  const summary = `document.querySelector('[data-g287-card] .sts-card > div > details > summary')`;
  const cases = [];
  const states = ["habitual", "one-off", "plans", "cards", "card-check", "comfortable", "move", "small", "urgent", "chronology", "loading", "stale", "error", "empty", "degraded", "long"];
  for (const mode of ["light", "dark"]) {
    for (const state of states) cases.push({ variant: "a", state, mode, width: 390 });
    for (const state of ["habitual", "cards", "plans", "card-check"]) cases.push({ variant: "b", state, mode, width: 390 });
    for (const state of ["habitual", "cards"]) cases.push({ variant: "current", state, mode, width: 390 });
    for (const state of ["habitual", "plans", "cards", "card-check", "comfortable", "chronology", "stale", "loading"]) cases.push({ variant: "c", state, mode, width: 390 });
    for (const state of states) cases.push({ variant: "d", state, mode, width: 390 });
    for (const width of [320, 1280]) for (const state of ["habitual", "long"]) cases.push({ variant: "d", state, mode, width });
    for (const width of [320, 1280]) cases.push({ variant: "c", state: "long", mode, width });
    for (const width of [320, 375, 1280]) for (const state of ["long", "cards"]) cases.push({ variant: "a", state, mode, width });
    for (const variant of ["e", "f"]) {
      for (const state of [...states, "tight", "buffer", "even"]) cases.push({ variant, state, mode, width: 390 });
      for (const width of [320, 1280]) for (const state of ["habitual", "comfortable", "plans", "long", ...(variant === "e" ? ["card-check"] : [])]) cases.push({ variant, state, mode, width });
    }
  }
  const selectedVariants = process.env.G287_BROWSER_VARIANTS?.split(",");
  for (const test of process.env.G287_BROWSER_PHASE === "interactions" ? [] : cases.filter(test => !selectedVariants || selectedVariants.includes(test.variant))) {
    const { variant, state, mode, width } = test;
    await viewport(width); await navigate(variant, state, mode);
    const figureState = !["loading", "error", "empty", "degraded"].includes(state);
    const measure = await evaluate(`(() => {
      const frame=document.querySelector('[data-g287-card]'); const figure=frame.querySelector('#safe-to-spend-heading > span:first-child');
      const panel=frame.querySelector('aside[aria-label="Card balance activity"]'); const summary=${summary};
      const r=frame.getBoundingClientRect(); const p=panel?.getBoundingClientRect();
      const upcoming=document.querySelector('[data-g287-upcoming]');const uf=upcoming?.querySelector('p[aria-label]');
      const rgb=colour=>{const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.fillStyle=colour;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3)};
      const canonical=colour=>'rgb('+rgb(colour).join(', ')+')';
      const luma=colour=>rgb(colour).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      const contrast=(a,b)=>{const x=luma(a),y=luma(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
      const fc=figure?getComputedStyle(figure).color:null;const uc=uf?getComputedStyle(uf).color:null;
      const chip=frame.querySelector('[class~="text-red-700"]');const cc=chip?getComputedStyle(chip).color:null;
      const badgeFacts=root=>{const badge=root?.querySelector('[data-g287-tone]');if(!badge)return null;const icon=badge.querySelector('svg');const bg=getComputedStyle(badge).backgroundColor;const r=badge.getBoundingClientRect();return{tone:badge.dataset.g287Tone,text:badge.textContent,colour:canonical(getComputedStyle(badge).color),icon:icon?canonical(getComputedStyle(icon).color):null,textContrast:contrast(getComputedStyle(badge).color,bg),iconContrast:icon?contrast(getComputedStyle(icon).color,bg):null,left:r.left,right:r.right}};
      const headerFacts=(root,heading,amount)=>{const card=root?.querySelector('.glass-hero');const badge=root?.querySelector('[data-g287-tone]');if(!card||!badge||!heading||!amount)return null;const c=card.getBoundingClientRect(),b=badge.getBoundingClientRect(),h=heading.getBoundingClientRect(),f=amount.getBoundingClientRect(),s=getComputedStyle(card);return{rightInset:c.right-b.right-parseFloat(s.paddingRight)-parseFloat(s.borderRightWidth),figureGap:f.top-h.bottom}};
      return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,frame:{x:r.x,right:r.right},
        figures:frame.querySelectorAll('#safe-to-spend-heading').length,
        amount:figure?.textContent,colour:figure?getComputedStyle(figure).color:null,size:figure?getComputedStyle(figure).fontSize:null,
        eyebrow:frame.querySelector('.sts-card > div:first-child > p')?.textContent,
        summaryColour:summary?getComputedStyle(summary).color:null,
        upcomingQualifier:upcoming?.querySelector('#runway-heading + div > span')?.textContent?.trim(),
        upcomingQualifierColour:upcoming?.querySelector('#runway-heading + div > span')?getComputedStyle(upcoming.querySelector('#runway-heading + div > span')).color:null,
        upcomingAmount:uf?.textContent?.trim(),
        homeBadge:badgeFacts(frame),upcomingBadge:badgeFacts(upcoming),
        homeHeader:headerFacts(frame,frame.querySelector('.sts-card > div:first-child'),figure),
        upcomingHeader:headerFacts(upcoming,upcoming?.querySelector('#runway-heading'),uf),
        upcomingColour:uc,chipColour:cc,
        contrast:fc?contrast(fc,getComputedStyle(frame.querySelector('.glass-hero')).backgroundColor):null,
        upcomingContrast:uc?contrast(uc,getComputedStyle(upcoming.querySelector('.glass-hero')).backgroundColor):null,
        chipContrast:cc?contrast(cc,getComputedStyle(chip).backgroundColor):null,
        summaryBackground:summary?getComputedStyle(summary).backgroundColor:null,
        cardVisible:!!panel&&getComputedStyle(panel).display!=='none'&&p.width>0&&p.height>0,
        accountLinks:frame.querySelectorAll('[data-g219-accounts-link]').length,
        actions:[...frame.querySelectorAll('[data-g219-action-row] button')].map(e=>e.textContent.trim()),
        // G304 added true inline prose links, covered by the WCAG inline
        // target-size exception. Keep all standalone actions at 44px.
        smallTargets:[...frame.querySelectorAll('button,a,summary')].filter(e=>!e.closest('[data-g304-envelope],[data-g304-plan]')).filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&(b.width<44||b.height<44)}).map(e=>e.textContent.trim())};
    })()`);
    assert.equal(measure.width, width); assert.equal(measure.overflow, false, JSON.stringify({ test, measure }));
    assert.ok(measure.frame.x >= 0 && measure.frame.right <= width + 1, "card fits shell");
    assert.equal(measure.figures, figureState ? 1 : 0, `${state}: one real card identity`);
    assert.equal(measure.accountLinks, figureState ? 1 : 0, `${state}: Accounts action retained`);
    if (["cards", "card-check"].includes(state)) assert.equal(measure.cardVisible, true, `${variant}/${mode}/${width}: card activity visible`);
    if (state === "cards") assert.deepEqual(measure.actions, ["See your cards"]);
    if (state === "card-check") { assert.deepEqual(measure.actions, ["Review card bill"]); assert.equal(measure.amount, "£0"); }
    if (figureState && variant === "a") assert.equal(measure.size, "30px");
    if (state === "habitual" && ["a", "b"].includes(variant)) assert.equal(measure.colour, mode === "dark" ? "rgb(241, 245, 249)" : "rgb(15, 23, 42)");
    if (variant === "d" && figureState) {
      assert.equal(measure.size, "30px");
      const ink = mode === "dark" ? "rgb(241, 245, 249)" : "rgb(15, 23, 42)";
      if (["habitual", "one-off", "small", "urgent", "chronology", "long"].includes(state)) {
        assert.match(measure.amount, /^−£/, "actual signed text, readable without colour");
        assert.equal(measure.colour, ink);
        assert.equal(measure.eyebrow, "Shortfall before payday");
        assert.equal(measure.summaryColour, mode === "dark" ? "rgb(203, 213, 225)" : "rgb(71, 85, 105)");
      } else assert.doesNotMatch(measure.amount, /^−/, "no invented negative cash for card-check, positive or stale states");
      if (["habitual", "one-off", "small", "urgent", "long", "plans"].includes(state)) {
        assert.match(measure.upcomingAmount, /^−£/);
        assert.equal(measure.upcomingColour, ink);
        assert.equal(measure.upcomingQualifier, "short");
        assert.notEqual(measure.upcomingQualifierColour, ink, "amber lives in the qualifier");
      }
      if (state === "habitual") {
        assert.equal(measure.chipColour, measure.upcomingQualifierColour, "same amber signifier on both cards");
        assert.ok(measure.contrast >= 4.5 && measure.upcomingContrast >= 4.5 && measure.chipContrast >= 4.5, JSON.stringify({test,measure}));
      }
      if (state === "chronology") assert.doesNotMatch(measure.upcomingAmount, /^−/, "a positive payday forecast stays positive despite Home's earlier shortfall");
    }
    if (variant === "c" && ["habitual", "long"].includes(state)) {
      assert.equal(measure.colour, measure.upcomingColour, "same actual risk colour on Home and Upcoming");
      assert.equal(measure.chipColour, measure.colour, "Short signifier shares the semantic foreground");
      assert.ok(measure.contrast >= 4.5 && measure.upcomingContrast >= 4.5 && measure.chipContrast >= 4.5, JSON.stringify({test,measure}));
    }
    if (variant === "current" && state === "habitual") assert.notEqual(measure.colour, measure.upcomingColour, "reference retains the reported drift");
    if (["e", "f"].includes(variant)) {
      const ink = mode === "dark" ? "rgb(241, 245, 249)" : "rgb(15, 23, 42)";
      if (figureState) { assert.equal(measure.colour, ink, "all hero states keep ink figures"); assert.equal(measure.size, "30px"); }
      const neutral = ["loading", "stale", "error", "empty", "degraded"].includes(state);
      if (neutral) { assert.equal(measure.homeBadge, null); assert.equal(measure.upcomingBadge, null); }
      else {
        const risk = ["habitual", "one-off", "small", "urgent", "chronology", "long"].includes(state);
        const tone = risk ? "risk" : state === "comfortable" ? "good" : "watch";
        assert.equal(measure.homeBadge?.tone, tone, JSON.stringify({test,measure}));
        assert.equal(measure.upcomingBadge?.tone, tone, JSON.stringify({test,measure}));
        assert.equal(measure.upcomingColour, ink);
        assert.equal(measure.homeBadge.icon, measure.upcomingBadge.icon, "shared semantic icon colour on both cards");
        for (const badge of [measure.homeBadge, measure.upcomingBadge]) {
          assert.ok(badge.textContrast >= 4.5 && badge.iconContrast >= 3, JSON.stringify({test,badge}));
          assert.ok(badge.left >= 0 && badge.right <= width + 1, "status stays in viewport");
          if (variant === "f") assert.equal(badge.colour, ink, "only the icon is coloured in F");
          else assert.equal(badge.colour, badge.icon, "icon and label share status colour in E");
        }
        if (risk || ["plans", "buffer"].includes(state)) assert.match(measure.amount, /^−£/, "shortfalls preserve an actual text minus sign");
        else assert.doesNotMatch(measure.amount, /^−/, "no invented cash debt in positive, zero or card-check states");
        if (state === "plans") assert.equal(measure.eyebrow, "Short after plans");
        if (state === "buffer") assert.equal(measure.eyebrow, "Below your buffer");
        if (state === "even") assert.equal(measure.upcomingQualifier, "even");
        if (state === "chronology") {
          assert.equal(measure.upcomingAmount, "£427"); assert.equal(measure.upcomingBadge.text, "Earlier gap");
          assert.equal(measure.upcomingQualifierColour, ink, "positive ending cash cannot get a green qualifier while an earlier payment gap is known");
        } else if (risk) assert.equal(measure.upcomingBadge.text, measure.homeBadge.text, "both payment-shortfall badges say Short");
        if (variant === "e") for (const header of [measure.homeHeader, measure.upcomingHeader]) {
          assert.ok(header && Math.abs(header.rightInset) < 1, JSON.stringify({test,header,message:"status aligns to the card's right content edge"}));
          assert.ok(Math.abs(header.figureGap - 20) < 1, JSON.stringify({test,header,message:"both figures sit 20px below their header row"}));
        }
      }
    }
    if (variant !== "current" && figureState) assert.equal(measure.summaryBackground, "rgba(0, 0, 0, 0)");
    assert.deepEqual(measure.smallTargets, [], `${state}: 44px target audit`);
    const shouldCapture = (["e", "f"].includes(variant) && ["habitual", "comfortable", "plans", "tight", "buffer", "even", "card-check", "chronology", "stale", "error"].includes(state)) || (width === 390 && ["habitual", "cards", "card-check"].includes(state)) || (width !== 390 && (mode === "dark" || width === 320));
    if (shouldCapture) await screenshot(`${variant}-${mode}-${width}-${state}`);
    if (["habitual", "cards", "card-check", "chronology", "plans"].includes(state)) {
      await activate(summary, width < 600);
      await waitFor("document.querySelector('[data-g287-card] details').open");
      if (variant !== "current") assert.equal(await evaluate(`getComputedStyle(${summary}).backgroundColor`), "rgba(0, 0, 0, 0)", "no sticky touch-hover purple fill");
      if (state === "cards") assert.equal(await evaluate("document.querySelector('[data-g287-card]').innerText.includes('Transfers between your own included accounts do not change the total')"), true);
      if (state === "chronology") assert.equal(await evaluate("document.querySelector('[data-g287-card]').innerText.includes('Bills before payday')"), false);
      if (["a", "c", "d"].includes(variant) && width === 390 && ["habitual", "card-check"].includes(state)) {
        if (variant === "c" && state === "habitual") {
          await activate("document.querySelector('[data-g287-upcoming] summary')", true);
          const riskColours=await evaluate("[...document.querySelectorAll('[data-g287-card] dd[class*=\"text-red-600\"], [data-g287-upcoming] dd[class*=\"text-rose-600\"]')].map(e=>getComputedStyle(e).color)");
          assert.ok(riskColours.length>=2);assert.ok(riskColours.every(colour=>colour===measure.colour), "both signed risk totals use the same foreground");
        }
        await screenshot(`${variant}-${mode}-${width}-${state}-open`);
      }
    }
    results.push({ ...test, ...measure });
  }
  await writeFile(path.join(output, "matrix.json"), JSON.stringify(results, null, 2));

  // Exercise the real footer controls with touch, then keyboard activation.
  await viewport(390);
  for (const [state, label, href] of [["habitual", "See what’s due", "/upcoming"], ["cards", "See your cards", "/cards"], ["card-check", "Review card bill", "/cards"]]) {
    await navigate("d", state, "dark");
    await activate("document.querySelector('[data-g219-action-row] button')", true);
    await waitFor(`document.querySelector('[data-preview-destination]').dataset.previewDestination === '${href}'`);
    assert.match(await evaluate("location.pathname"), /\/design\/sts-tone$/);
    assert.ok((await evaluate("document.querySelector('[data-preview-destination]').textContent")).includes(label));
    await activate("document.querySelector('[data-g219-accounts-link]')", true);
    await waitFor("document.querySelector('[data-preview-destination]').dataset.previewDestination === '/accounts'");
    assert.match(await evaluate("location.pathname"), /\/design\/sts-tone$/);
  }
  await navigate("d", "habitual", "light");
  await evaluate(`${summary}.focus()`); await key("Enter", "Enter", 13);
  await waitFor("document.querySelector('[data-g287-card] details').open");
  const focus = await evaluate(`({active:document.activeElement.tagName,ring:getComputedStyle(${summary}).boxShadow})`);
  assert.equal(focus.active, "SUMMARY"); assert.notEqual(focus.ring, "none", "keyboard focus ring");
  await key("Enter", "Enter", 13); await waitFor("!document.querySelector('[data-g287-card] details').open");
  await key("Tab", "Tab", 9);
  assert.equal(await evaluate("document.activeElement.textContent.trim()"), "See what’s due");
  await key("Enter", "Enter", 13); await waitFor("document.querySelector('[data-preview-destination]').dataset.previewDestination === '/upcoming'");
  await key("Tab", "Tab", 9); await key("Enter", "Enter", 13);
  await waitFor("document.querySelector('[data-preview-destination]').dataset.previewDestination === '/accounts'");
  for (const state of ["error", "empty", "degraded", "stale"]) {
    await navigate("d", state, "light");
    await activate("[...document.querySelectorAll('[data-g287-card] button')].find(e=>['Retry','Try again','Check again'].includes(e.textContent.trim()))", true);
    await waitFor(`document.querySelector('[data-g287-scenario="habitual"]')`);
  }
  await navigate("d", "plans", "dark");
  await activate("document.querySelector('[data-g287-upcoming] summary')", true);
  await activate("document.querySelector('[data-g287-upcoming] [data-g304-plan] a')", true);
  await waitFor("document.querySelector('[data-preview-destination]').dataset.previewDestination === '/planning#commitments'");
  assert.match(await evaluate("location.pathname"), /\/design\/sts-tone$/);
  await navigate("a", "card-check", "dark", true);
  assert.equal(await evaluate("!!document.querySelector('[data-g287-card]')"), false);
  assert.doesNotMatch(await evaluate("document.body.innerText"), /£\d|£[\d,]+\.\d/);
  await navigate("c", "habitual", "dark", true);
  assert.equal(await evaluate("!!document.querySelector('[data-g287-upcoming], [data-g287-card]')"), false, "both colour examples honour masking");
  assert.doesNotMatch(await evaluate("document.body.innerText"), /£\d|£[\d,]+\.\d/);
  await navigate("d", "habitual", "dark", true);
  assert.equal(await evaluate("!!document.querySelector('[data-g287-upcoming], [data-g287-card]')"), false);
  assert.doesNotMatch(await evaluate("document.body.innerText"), /£\d|£[\d,]+\.\d/);
  for (const variant of ["e", "f"]) {
    await navigate(variant, "habitual", "dark");
    for (const state of ["comfortable", "plans", "chronology", "habitual"]) {
      await activate(`[...document.querySelectorAll('a[href]')].find(e=>e.closest('ul')&&new URL(e.href).searchParams.get('state')===${JSON.stringify(state)})`, true);
      await waitFor(`document.querySelector('[data-g287-card="${variant}"][data-g287-scenario="${state}"]')`);
      await evaluate("document.fonts.ready");
      if (state === "habitual") {
        assert.equal(await evaluate("document.querySelector('#safe-to-spend-heading > span:first-child').textContent"), "−£573", "query navigation restores a single sign");
        assert.equal(await evaluate("document.querySelectorAll('#runway-heading [data-g287-tone]').length"), 1, "one portal status after state changes");
      }
    }
    await activate("document.querySelector('[data-g219-action-row] button')", true);
    await waitFor("document.querySelector('[data-preview-destination]').dataset.previewDestination === '/upcoming'");
    await navigate(variant, "stale", "light");
    await activate("[...document.querySelectorAll('[data-g287-card] button')].find(e=>['Retry','Try again','Check again'].includes(e.textContent.trim()))", true);
    await waitFor("document.querySelector('[data-g287-scenario=\"habitual\"]')");
    await waitFor("document.querySelector('#runway-heading [data-g287-tone]')");
    await navigate(variant, "habitual", "dark", true);
    assert.equal(await evaluate("!!document.querySelector('[data-g287-upcoming], [data-g287-card], #complete-state-overview')"), false, "new state overview and both cards honour masking");
    assert.doesNotMatch(await evaluate("document.body.innerText"), /£\d|£[\d,]+\.\d/);
  }
  assert.deepEqual(exceptions, [], "no page exceptions"); assert.deepEqual(customerRequests, [], "no customer API attempts");
  await writeFile(path.join(output, "results.json"), JSON.stringify({ layouts: results.length, interactions: "touch/keyboard disclosure, footer destinations, local retry and legacy privacy gate", exceptions, customerRequests, results }, null, 2));
  console.log(JSON.stringify({ layouts: results.length, interactions: "passed", output }));
} finally { socket?.close(); chrome.kill("SIGTERM"); }
