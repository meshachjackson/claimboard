// Accessibility audit for the board. Paste into the browser console (or a javascript_tool call) on any page.
// It measures what is on screen right now, in the current theme, and returns one object:
//   contrast: text under 4.5:1 (3:1 for large text), icon-only controls and form borders under 3:1
//   targets:  visible click targets under 24px (or under 44px on phone for primary controls)
//   unnamed:  status pills, dots and lane colors with no text and no aria-label
//   scroll:   whether the page scrolls sideways
// Rerun after switching theme (Settings > Appearance) and after opening each panel you want checked.
(() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1
  const cx = cv.getContext('2d', { willReadFrequently: true })
  // Any CSS color (oklch, color-mix, rgb) to [r,g,b,a], by letting the canvas parse it.
  const rgba = (css) => {
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1)
    const d = cx.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2], d[3] / 255]
  }
  const over = (f, b) => [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3])).concat([1])
  const lum = ([r, g, b]) => { const c = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  // The backdrop of an element: its ancestors' backgrounds, composited from the root down. Gradients and images are flagged.
  const backdrop = (el) => {
    const chain = []; let n = el, flagged = false
    while (n && n.nodeType === 1) {
      const s = getComputedStyle(n)
      if (s.backgroundImage !== 'none' && !n.matches('.ab-ticket')) flagged = true
      const c = rgba(s.backgroundColor); if (c[3] > 0) chain.push(c)
      if (c[3] === 1) break
      n = n.parentElement
    }
    let b = rgba(getComputedStyle(document.body).backgroundColor); if (b[3] < 1) b = [255, 255, 255, 1]
    for (let i = chain.length - 1; i >= 0; i--) b = over(chain[i], b)
    return { b, flagged }
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false
    }
    return true
  }
  const labelled = (el) => { const id = el.getAttribute('aria-labelledby'); const t = id && document.getElementById(id); return t ? t.textContent.trim() : '' }
  const name = (el) => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' "' + (el.getAttribute('aria-label') || labelled(el) || el.textContent || '').trim().slice(0, 30) + '"')

  const contrast = [], seen = new Set()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let t; (t = walker.nextNode());) {
    const el = t.parentElement
    if (!el || seen.has(el) || !t.nodeValue.trim() || el.closest('script,style,noscript')) continue
    seen.add(el); if (!visible(el)) continue
    const s = getComputedStyle(el), size = parseFloat(s.fontSize), bold = +s.fontWeight >= 700
    const need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5
    const { b, flagged } = backdrop(el)
    const f = over(rgba(s.color), b), r = ratio(f, b)
    // Disabled controls are exempt from WCAG 1.4.3; mark them so they are visible in the list but not counted.
    const disabled = el.closest('[disabled],[aria-disabled="true"]')
    if (r < need) contrast.push({ kind: 'text', el: name(el), ratio: +r.toFixed(2), need, size, flagged, disabled: !!disabled })
  }
  // Placeholders use ::placeholder, which getComputedStyle reads with the pseudo argument.
  document.querySelectorAll('input[placeholder],textarea[placeholder]').forEach(el => {
    if (!visible(el)) return
    const { b } = backdrop(el), f = over(rgba(getComputedStyle(el, '::placeholder').color), b), r = ratio(f, b)
    if (r < 4.5) contrast.push({ kind: 'placeholder', el: name(el), ratio: +r.toFixed(2), need: 4.5 })
  })
  // Icon-only controls: the icon (currentColor of the icon element) against its backdrop, 3:1. Switches are checked by their track below.
  document.querySelectorAll('button,a,[role=button]').forEach(el => {
    if (!visible(el) || (el.textContent || '').trim() || el.matches('[role=switch]')) return
    const icon = el.querySelector('svg,[class*=i-]') || el
    const { b } = backdrop(el), f = over(rgba(getComputedStyle(icon).color), b), r = ratio(f, b)
    if (r < 3 && !el.matches('[disabled],[aria-disabled="true"]')) contrast.push({ kind: 'icon', el: name(el), ratio: +r.toFixed(2), need: 3 })
  })
  // Form fields and switches: the edge that marks the control must reach 3:1 against what it sits on.
  // An input with no border of its own is judged by the nearest ancestor that draws one (the search wrapper); a switch by its track.
  document.querySelectorAll('input:not([type=checkbox]):not([type=radio]),select,textarea,[role=switch]').forEach(el => {
    if (!visible(el)) return
    const bw = (n) => parseFloat(getComputedStyle(n).borderTopWidth) > 0
    let edgeEl = el
    if (!bw(el) && !el.matches('[role=switch]')) { let n = el.parentElement; for (let i = 0; n && i < 3 && !bw(n); i++) n = n.parentElement; if (n && bw(n)) edgeEl = n }
    const s = getComputedStyle(edgeEl)
    const outer = edgeEl.parentElement || edgeEl
    const { b } = backdrop(outer)
    const edge = bw(edgeEl) ? over(rgba(s.borderTopColor), b) : over(rgba(s.backgroundColor), b)
    const r = ratio(edge, b)
    if (r < 3) contrast.push({ kind: el.matches('[role=switch]') ? 'switch-track' : 'field-border', el: name(el), ratio: +r.toFixed(2), need: 3 })
  })
  // Focus ring: the accent color against the page ground and the card surface.
  const root = getComputedStyle(document.documentElement)
  const ring = rgba(root.getPropertyValue('--color-accent').trim() || '#2A4BD7')
  const ringRatios = { onGround: +ratio(ring, rgba(root.getPropertyValue('--color-ground').trim())).toFixed(2), onSurface: +ratio(ring, rgba(root.getPropertyValue('--color-surface').trim())).toFixed(2) }

  // Targets: anything a pointer can click. Inline text links inside a sentence are exempt (WCAG 2.5.8 inline exception).
  const phone = innerWidth < 768, min = 24, primary = 44
  const targets = []
  document.querySelectorAll('a[href],button,[role=button],[role=tab],[role=switch],[role=menuitem],input:not([type=hidden]),select,textarea,summary,[tabindex="0"]').forEach(el => {
    if (!visible(el) || el.matches('[disabled],.sr-only')) return
    // A ::after drawn absolutely over or around the control (a stretched link, or padding added for reach) is part of its click area.
    const af = getComputedStyle(el, '::after')
    let box = el.closest('label') || el // an input inside a label is clicked through the label
    let pw = 0, ph = 0
    if (af.position === 'absolute' && af.content !== 'none') { pw = parseFloat(af.width) || 0; ph = parseFloat(af.height) || 0 }
    const rr = box.getBoundingClientRect(), r = { width: Math.max(rr.width, pw), height: Math.max(rr.height, ph), top: rr.top, bottom: rr.bottom }
    if (r.bottom < 0 || r.top > innerHeight * 4) return
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.parentElement && /\S/.test(el.parentElement.textContent.replace(el.textContent, ''))
    const limit = (phone && el.matches('nav a,nav button,[role=tab],button,[role=button]')) ? primary : min
    if (!inline && (r.width < limit - 0.5 || r.height < limit - 0.5)) targets.push({ el: name(el), w: Math.round(r.width), h: Math.round(r.height), need: limit })
  })

  // Status elements with no text and no accessible name.
  const unnamed = []
  document.querySelectorAll('[class*=pill],[class*=dot],[data-status],[data-lane],[style*="--ab-"],[style*="var(--ab-"]').forEach(el => {
    if (!visible(el)) return
    const has = (el.textContent || '').trim() || el.getAttribute('aria-label') || el.getAttribute('title') || el.querySelector('[aria-label]') || el.closest('[aria-label]') || el.getAttribute('aria-hidden') === 'true' || el.closest('[aria-hidden="true"]') || (el.parentElement && el.parentElement.textContent.trim()) // a dot beside its text label is decorative
    const bg = getComputedStyle(el).backgroundColor
    const r = el.getBoundingClientRect()
    if (!has && rgba(bg)[3] > 0 && r.width < 40 && r.height < 40) unnamed.push(name(el))
  })

  const scroll = { scrollWidth: document.documentElement.scrollWidth, innerWidth, sideways: document.documentElement.scrollWidth > innerWidth }
  const small = innerWidth >= 768 ? [] : [...document.querySelectorAll('body *')].filter(e => visible(e) && [...e.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim()) && parseFloat(getComputedStyle(e).fontSize) < 12).map(name)
  const real = contrast.filter(c => !c.disabled)
  return {
    page: location.pathname + location.search, theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', width: innerWidth,
    counts: { textMeasured: seen.size, contrastFails: real.length, contrastDisabledIgnored: contrast.length - real.length, targetsUnderMin: targets.length, unnamedStatus: unnamed.length, textUnder12px: small.length },
    ringRatios, scroll, contrast: real.slice(0, 40), targets: targets.slice(0, 40), unnamed: unnamed.slice(0, 20), small: small.slice(0, 10)
  }
})()
