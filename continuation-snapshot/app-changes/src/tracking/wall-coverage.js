// Same artwork, several image references, one visible panel. The native detector
// remains the source of truth; this policy never predicts recognition or pose.
export function panelCropTransform(panelImagePx, sourceCropPx, scaledWidth = 1) {
  const [pw, ph] = panelImagePx || [], [x, y, w, h] = sourceCropPx || []
  if (![pw, ph, x, y, w, h, scaledWidth].every(Number.isFinite) ||
    pw <= 0 || ph <= 0 || w <= 0 || h <= 0 || scaledWidth <= 0 ||
    x < 0 || y < 0 || x + w > pw || y + h > ph) throw new Error('Invalid panel crop')
  const scale = scaledWidth * pw / w
  const tx = scaledWidth * (pw / 2 - x - w / 2) / w
  const ty = scaledWidth * (y + h / 2 - ph / 2) / w
  return {scale, position:[tx, ty, 0],
    panelToTarget3x3:[scale,0,tx,0,scale,ty,0,0,1],
    targetToPanel3x3:[1/scale,0,-tx/scale,0,1/scale,-ty/scale,0,0,1],
    pixelToTarget3x3:[scaledWidth/w,0,-scaledWidth*(x+w/2)/w,0,-scaledWidth/w,scaledWidth*(y+h/2)/w,0,0,1]}
}

export function createWallCoverageArbiter({names, staleAfterMs = 1000} = {}) {
  if (!Array.isArray(names) || !names.length || new Set(names).size !== names.length || names.some(n => typeof n !== 'string' || !n)) throw new Error('Unique coverage names required')
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) throw new Error('Positive coverage freshness bound required')
  const records = new Map(names.map(name => [name, {found:false, usable:false, seenAt:null}]))
  let selected = null, handoffs = 0, generation = 0, lastNow = -Infinity
  const time = now => {
    if (!Number.isFinite(now) || now < lastNow) throw new Error('Coverage clock must be finite and monotonic')
    lastNow = now; return now
  }
  const fresh = (name, now) => {
    const r = records.get(name)
    return !!r && r.found && r.usable && r.seenAt !== null && now >= r.seenAt && now-r.seenAt <= staleAfterMs
  }
  function observe(name, {now, usable = true} = {}) {
    time(now); const r = records.get(name)
    if (!r) return false
    r.found = true; r.usable = usable === true; r.seenAt = now
    return true
  }
  function lose(name) {const r=records.get(name); if (r) {r.found=false;r.usable=false}}
  function choose(now) {
    time(now)
    if (fresh(selected, now)) return selected // overlap never causes per-frame ping-pong
    const previous = selected
    selected = [...records].filter(([name]) => fresh(name,now))
      .sort((a,b) => b[1].seenAt-a[1].seenAt || names.indexOf(a[0])-names.indexOf(b[0]))[0]?.[0] || null
    if (previous !== selected) {generation++; if(previous && selected) handoffs++}
    return selected
  }
  function reset() {for(const r of records.values())Object.assign(r,{found:false,usable:false,seenAt:null});selected=null;lastNow=-Infinity;generation++}
  function diagnostics(now) {time(now);return {selected, handoffs, generation, staleAfterMs,
    targets:[...records].map(([name,r])=>({name,...r,fresh:fresh(name,now)}))}}
  return {observe,lose,choose,fresh,reset,diagnostics}
}
