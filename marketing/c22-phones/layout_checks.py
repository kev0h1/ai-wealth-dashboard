"""Check the visible regions Kevin found missing or obscured in the phone kit."""
from __future__ import annotations

BODY_RATIOS = {
    "iphone-63": 71.5 / 149.6,
    "iphone-69": 77.6 / 163,
    "iphone-65": 77.8 / 158,
    "android": 76.6 / 162.8,
}
DISPLAY_RATIOS = {
    "iphone-63": 1206 / 2622,
    "iphone-69": 1320 / 2868,
    "iphone-65": 1242 / 2688,
    "android": 1344 / 2992,
}
LOGICAL_WIDTHS = {"iphone-63": 402, "iphone-69": 440, "iphone-65": 414, "android": 412}

MEASURE = r"""node => {
  const rect = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height};
  };
  const article = rect(node);
  const phone = rect(node.querySelector('[data-c22-phone]'));
  const screen = rect(node.querySelector('[data-c22-screen]'));
  const stage = rect(node.querySelector('[data-c22-phone]').parentElement);
  const viewport = node.querySelector('[data-c22-product-viewport]');
  const product = node.querySelector('[data-c22-product]');
  const content = node.querySelector('[data-c22-content]');
  const navigation = node.querySelector('nav[data-penny-navigation]');
  const main = rect(content), nav = rect(navigation);
  const scale = rect(product).width / product.clientWidth;
  const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
  const clip = {
    left:Math.max(article.left,stage.left,screen.left,main.left),
    top:Math.max(article.top,stage.top,screen.top,main.top),
    right:Math.min(article.right,stage.right,screen.right,main.right),
    bottom:Math.min(article.bottom,stage.bottom,screen.bottom,main.bottom,nav.top),
  };
  const visible = r => !!r && r.width > 0 && r.height > 0 &&
    r.left >= clip.left-.5 && r.top >= clip.top-.5 &&
    r.right <= clip.right+.5 && r.bottom <= clip.bottom+.5;
  const goal = node.querySelector('section[aria-label="Goal proposal"]');
  const goalButtons = goal ? [...goal.querySelectorAll('button')]
    .filter(el => ['Create goal','Cancel','Edit schedule'].includes(el.textContent.trim()))
    .map(el => {
      const r=rect(el),range=document.createRange();range.selectNodeContents(el);
      const t=rect({getBoundingClientRect:()=>range.getBoundingClientRect()});
      return {label:el.textContent.trim(),fullyVisible:visible(r),textVisible:visible(t),
        textInsideButton:t.left>=r.left-.5&&t.right<=r.right+.5&&t.top>=r.top-.5&&t.bottom<=r.bottom+.5,
        height:r.height/scale,width:r.width/scale,clearance:(nav.top-r.bottom)/scale};
    }) : [];
  const hero = node.querySelector('[data-g186-hero="b"]');
  const rail = node.querySelector('[data-c22-spend-rail]');
  const railRect = rect(rail), railStyle = rail ? getComputedStyle(rail,'::before') : null;
  const arrival = node.querySelector('[data-c22-pay-arrived]');
  const summary = node.querySelector('[data-c22-spend-nav]');
  const accountRows = [...node.querySelectorAll('[data-spend-from-account]')];
  const ledger = [...node.querySelectorAll('summary')].find(el => el.innerText.includes('How we got'));
  const scope = node.querySelector('#safe-to-spend-scope');
  const upcomingAccounts = [...node.querySelectorAll('[data-c22-upcoming-accounts] [data-account-row]')];
  const purpose = node.querySelector('[data-c22-purpose-screen]');
  const split = node.querySelector('[data-c22-pay-split-comparison]');
  const comparison = split?.querySelector('[aria-label="Reference comparison"]');
  const purposeCard = purpose?.querySelector(':scope > .glass-card');
  const purposeActions = purposeCard ? [...purposeCard.querySelectorAll('button')].map(el => {
    const r=rect(el),range=document.createRange();range.selectNodeContents(el);
    const t=rect({getBoundingClientRect:()=>range.getBoundingClientRect()});
    return {label:el.innerText,fullyVisible:visible(r),textVisible:visible(t),
      textInsideButton:t.left>=r.left-.5&&t.right<=r.right+.5&&t.top>=r.top-.5&&t.bottom<=r.bottom+.5,
      height:r.height/scale,width:r.width/scale,clearance:(nav.top-r.bottom)/scale};
  }) : [];
  return {
    bodyRatio:phone.width/phone.height,displayRatio:screen.width/screen.height,
    screenInsidePhone:screen.left>=phone.left-.5&&screen.right<=phone.right+.5&&screen.top>=phone.top-.5&&screen.bottom<=phone.bottom+.5,
    uniformScale:Math.abs(matrix.a-matrix.d)<.0001&&Math.abs(matrix.b)<.0001&&Math.abs(matrix.c)<.0001,
    logicalWidth:product.clientWidth,contentScrollTop:content.scrollTop,clip,nav,
    mockSystemIcons:node.querySelectorAll('[class*="statusMarks"], [class*="statusBar"] :is(i,b,em,svg,img)').length,
    split:split ? {completeVisible:visible(rect(split)),comparisonVisible:visible(rect(comparison)),text:split.innerText,
      period:node.querySelector('[data-c22-product-header]')?.innerText??'',
      clearance:(nav.top-rect(split).bottom)/scale} : null,
    goal:goal ? {completeCardVisible:visible(rect(goal)),buttons:goalButtons,text:goal.innerText} : null,
    home:scope ? {scopeVisible:visible(rect(scope)),scope:scope.innerText,
      accounts:accountRows.map(el=>({id:el.getAttribute('data-spend-from-account'),text:el.innerText,visible:visible(rect(el))})),
      ledgerVisible:visible(rect(ledger)),ledger:ledger?.innerText??''} : null,
    upcomingAccounts:upcomingAccounts.map(el=>({id:el.getAttribute('data-account-row'),text:el.innerText,visible:visible(rect(el)),height:rect(el).height/scale})),
    upcomingPayments:node.querySelector('[data-c22-upcoming-payments]')?.innerText??null,
    purpose:purpose ? {completeCardVisible:visible(rect(purposeCard)),text:purpose.innerText,buttons:purposeActions} : null,
    spend:hero ? {heroVisible:visible(rect(hero)),periodBar:!!node.querySelector('[data-g285-period-bar="b"]'),
      summaryPresent:!!summary,summaryText:summary?.innerText??'',
      arrivalVisible:visible(rect(arrival)),arrivalText:arrival?.innerText??'',
      railPresent:!!rail,railWidth:railStyle?.width??'',railColour:railStyle?.backgroundColor??'',
      railVisibleHeight:railRect ? Math.max(0,Math.min(railRect.bottom,clip.bottom)-Math.max(railRect.top,clip.top))/scale:0,
      heroText:hero.innerText} : null,
  };
}"""


def check_layout(target, format_id: str, story: str) -> dict:
    result = target.evaluate(MEASURE)
    context = (format_id, story)
    assert abs(result["bodyRatio"] / BODY_RATIOS[format_id] - 1) <= .01, (context, "Distorted chassis", result)
    assert abs(result["displayRatio"] / DISPLAY_RATIOS[format_id] - 1) <= .01, (context, "Distorted display", result)
    assert result["uniformScale"] and result["screenInsidePhone"], (context, result)
    assert result["logicalWidth"] == LOGICAL_WIDTHS[format_id], (context, "Changed product viewport", result)
    assert result["contentScrollTop"] == 0, (context, "Unexpected initial scroll", result)
    assert result["mockSystemIcons"] == 0, (context, "Mock handset system icons remain", result)
    if story == "amount":
        home = result["home"]
        assert home and home["scopeVisible"] and "buffer" in home["scope"], (context, home)
        assert len(home["accounts"]) == 2 and all(row["visible"] for row in home["accounts"]), (context, "Missing two visible account figures", home)
        assert "£272" in home["accounts"][0]["text"] and "£150" in home["accounts"][1]["text"], (context, home)
        assert home["ledgerVisible"] and "£312" in home["ledger"], (context, "No visible reconciliation entry", home)
    if story == "upcoming":
        payments = result["upcomingPayments"]
        assert payments and all(label in payments for label in ["Energy", "£188", "£38", "£95"]), (context, payments)
    if story == "upcoming-accounts":
        accounts = result["upcomingAccounts"]
        assert len(accounts) == 3 and all(row["visible"] and row["height"] >= 43.9 for row in accounts), (context, "Account readings folded or clipped", accounts)
        assert all(amount in " ".join(row["text"] for row in accounts) for amount in ["£272", "£150", "£0"]), (context, accounts)
        assert "Move suggested" in " ".join(row["text"] for row in accounts), (context, accounts)
    if story == "aside":
        purpose = result["purpose"]
        assert purpose and purpose["completeCardVisible"], (context, "One-off confirmation clipped", purpose)
        assert all(label in purpose["text"] for label in ["Car service", "£120", "12 Dec", "Monzo current account", "No bank payment"]), (context, purpose)
        assert {button["label"] for button in purpose["buttons"]} == {"Confirm", "Cancel"}, (context, purpose)
        assert all(button["fullyVisible"] and button["textVisible"] and button["textInsideButton"] and button["height"] >= 43.9 and button["width"] >= 43.9 and button["clearance"] >= 7.9 for button in purpose["buttons"]), (context, "One-off action obscured", purpose)
    if story == "goal":
        goal = result["goal"]
        assert goal and goal["completeCardVisible"], (context, "Goal card is clipped", result)
        assert {b["label"] for b in goal["buttons"]} == {"Create goal", "Cancel", "Edit schedule"}, (context, goal)
        assert all(b["fullyVisible"] and b["textVisible"] and b["textInsideButton"] and b["height"] >= 43.9 and b["width"] >= 43.9 and b["clearance"] >= 7.9 for b in goal["buttons"]), (context, "Goal action obscured", goal)
    if story == "spend":
        spend = result["spend"]
        assert spend and spend["heroVisible"] and spend["periodBar"] and spend["summaryPresent"], (context, "Incomplete Spend page", result)
        assert all(label in spend["summaryText"].casefold() for label in ["changes", "spending", "charts"]), (context, spend)
        assert spend["arrivalVisible"] and spend["railPresent"] and spend["railVisibleHeight"] >= 32, (context, "Missing visible journey", result)
        assert spend["railWidth"] == "1px" and spend["railColour"] not in ["transparent", "rgba(0, 0, 0, 0)"], (context, spend)
        assert "£860" in spend["heroText"] and "£1,800" in spend["heroText"] and "£400" in spend["heroText"] and "£1,800" in spend["arrivalText"], (context, "Spend fixture does not reconcile", spend)
    if story == "split":
        split = result["split"]
        assert split and split["completeVisible"] and split["comparisonVisible"] and split["clearance"] >= 7.9, (context, "50/30/20 comparison clipped", split)
        assert "Completed pay period" in split["period"] and "30 Sep to 29 Oct 2026" in split["period"], (context, "Comparison period unclear", split)
        assert all(label in split["text"] for label in ["50/30/20 example", "£1,800", "Fixed", "Moved", "Free", "£0", "−£60", "−£90", "50% example", "20% example", "30% example"]), (context, split)
        assert "£312" not in split["text"], (context, "Current forecast mixed with completed-period comparison", split)
    return result
