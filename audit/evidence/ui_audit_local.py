#!/usr/bin/env python3
"""
Local accessibility re-check (F-018) — DOM inspection of the RUNNING app.

Mirrors the method of the production UI audit (audit/evidence/ui_audit.json):
per route it counts controls without an accessible name, form fields without a
label, headings, landmarks, the skip link and horizontal overflow.

Usage: python3 audit/evidence/ui_audit_local.py [base_url]
"""
import json
import sys
import urllib.request
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3111"
COOKIE_NAME = "sb-lyswmlmrlviptprhfiph-auth-token"

ROUTES = [
    "/", "/dashboard", "/orders", "/customers", "/products", "/collections",
    "/reconciliation", "/reports", "/settings", "/settings/integrations",
    "/login", "/register", "/forgot-password",
]

JS = r"""
() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  const accName = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const t = labelledby.split(/\s+/).map(id => (document.getElementById(id)||{}).textContent || '').join(' ').trim();
      if (t) return t;
    }
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    const txt = (el.innerText || el.textContent || '').trim();
    if (txt) return txt;
    const alt = el.querySelector('img[alt]');
    if (alt && alt.getAttribute('alt').trim()) return alt.getAttribute('alt').trim();
    const svgTitle = el.querySelector('svg title');
    if (svgTitle && svgTitle.textContent.trim()) return svgTitle.textContent.trim();
    if (el.tagName === 'INPUT' && el.getAttribute('placeholder')) return el.getAttribute('placeholder');
    return '';
  };
  const fieldLabel = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const t = labelledby.split(/\s+/).map(id => (document.getElementById(id)||{}).textContent || '').join(' ').trim();
      if (t) return t;
    }
    if (el.id) {
      const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lab && lab.textContent.trim()) return lab.textContent.trim();
    }
    const wrapping = el.closest('label');
    if (wrapping && wrapping.textContent.trim()) return wrapping.textContent.trim();
    if (el.getAttribute('placeholder') && el.getAttribute('placeholder').trim()) return el.getAttribute('placeholder').trim();
    return '';
  };
  const controls = [...document.querySelectorAll('button, a[href], [role="button"], input, select, textarea')].filter(visible);
  const fields = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')].filter(visible);
  const h1s = [...document.querySelectorAll('h1')].filter(visible);
  return {
    ctl: controls.length,
    ctlNoName: controls.filter(c => !accName(c)).length,
    ctlNoNameSample: controls.filter(c => !accName(c)).slice(0, 4).map(c => c.tagName + '.' + (c.className || '').toString().slice(0, 40)),
    fld: fields.length,
    fldNoLabel: fields.filter(f => !fieldLabel(f)).length,
    fldNoLabelSample: fields.filter(f => !fieldLabel(f)).slice(0, 4).map(f => f.tagName + '#' + (f.id || '') + '[' + (f.getAttribute('type') || '') + ']'),
    h1: h1s.length,
    h1t: h1s.map(h => h.textContent.trim()).join(' | ').slice(0, 60),
    lm: [document.querySelectorAll('header').length, document.querySelectorAll('nav').length, document.querySelectorAll('main').length, document.querySelectorAll('footer').length].join('/'),
    skip: !!document.querySelector('a[href="#main-content"]'),
    mainId: !!document.getElementById('main-content'),
    ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    lang: document.documentElement.lang,
  };
}
"""


def main():
    cookie = json.load(open("/tmp/cookie-pair.json"))
    out = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1444, "height": 900})
        ctx.add_cookies([{
            "name": cookie["name"], "value": cookie["value"],
            "domain": "localhost", "path": "/",
        }])
        page = ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        for route in ROUTES:
            errors.clear()
            resp = page.goto(BASE + route, wait_until="networkidle", timeout=45000)
            page.wait_for_timeout(1200)
            data = page.evaluate(JS)
            data["route"] = route
            data["status"] = resp.status if resp else 0
            data["errs"] = len(errors)
            data["errSample"] = errors[:3]
            out.append(data)
            print(f"{route:24} {data['status']} h1={data['h1']} ctl={data['ctl']} "
                  f"noName={data['ctlNoName']} fld={data['fld']} noLabel={data['fldNoLabel']} "
                  f"lm={data['lm']} skip={data['skip']} mainId={data['mainId']} ovf={data['ovf']} errs={data['errs']}")
            if data["ctlNoName"]:
                print("      noName:", data["ctlNoNameSample"])
            if data["fldNoLabel"]:
                print("      noLabel:", data["fldNoLabelSample"])
        browser.close()
    json.dump(out, open("audit/evidence/ui_audit_local.json", "w"), ensure_ascii=False, indent=2)
    print("\nwritten: audit/evidence/ui_audit_local.json")


if __name__ == "__main__":
    main()
