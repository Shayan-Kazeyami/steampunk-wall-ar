from pathlib import Path
import json,hashlib,socket,subprocess,sys,time
from playwright.sync_api import sync_playwright
B=Path(__file__).resolve().parent; S=B/'staging'; O=B/'portable-proof';O.mkdir(exist_ok=True)
active=subprocess.check_output(['powershell','-NoProfile','-Command','@(Get-Process blender -ErrorAction SilentlyContinue).Count'],text=True).strip(); assert active=='0',active
ram=float(subprocess.check_output(['powershell','-NoProfile','-Command','[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,2)'],text=True).strip());assert ram>=12,ram
with socket.socket() as s: s.bind(('127.0.0.1',0)); port=s.getsockname()[1]
server=subprocess.Popen([sys.executable,'-m','http.server',str(port),'--bind','127.0.0.1','--directory',str(S)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
results=[];start=time.time()
try:
 time.sleep(1);assert server.poll() is None
 with sync_playwright() as api:
  browser=api.chromium.launch(headless=True,args=['--use-angle=d3d11'])
  try:
   for side,sub in [('left','continuation-14/left-lamp-materials'),('right','continuation-13/lamp-materials')]:
    errors=[];http=[];page=browser.new_page(viewport={'width':1200,'height':900},device_scale_factor=1)
    page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None);page.on('response',lambda r:http.append([r.url,r.status]) if r.status>=400 else None)
    page.goto(f'http://127.0.0.1:{port}/review/garage-lamps/{sub}/assembly-browser.html');page.wait_for_function("document.querySelector('#status').dataset.ready||document.querySelector('#status').dataset.error",timeout=120000)
    assert not page.locator('#status').get_attribute('data-error'),page.locator('#status').get_attribute('data-error');d=page.evaluate('review.diagnostics');a=d['assembly'];assert 'NVIDIA' in d['glRenderer'] and 'SwiftShader' not in d['glRenderer'],d['glRenderer'];assert a['meshes']==80 and a['families']==5 and a['totalTriangles']==193920 and len(a['alignment'])==16,a;assert all(x['world_origin_max']<=2e-6 for x in a['alignment']);assert all(v==16 for v in a['familyCounts'].values())
    closure=page.evaluate("""()=>{const a=assembly,r=review;let count=0,b=true,g=true;for(const x of [r.g.scene,a.bulbs.scene,a.glass.scene])x.traverse(o=>{if(o.isMesh)count++});a.bulbs.scene.traverse(o=>{if(o.isMesh)b&&=o.castShadow===false});a.glass.scene.traverse(o=>{if(o.isMesh)g&&=o.castShadow===false});return {count,bulbCastShadowFalse:b,glassCastShadowFalse:g,contract:r.validateLampContract(r.g.scene,r.manifest,r.supportedExtensions)}}""");assert closure['count']==80 and closure['bulbCastShadowFalse'] and closure['glassCastShadowFalse'];page.evaluate("()=>{review.scene.pause();document.querySelector('#status').style.display='none';review.render()}");page.locator('canvas').screenshot(path=str(O/f'{side}-all16.png'));assert not errors and not http,(errors,http);results.append({'side':side,'diagnostics':d,'closure':closure,'applicationErrors':errors,'httpErrors':http});page.close()
  finally:browser.close()
finally:
 server.terminate();server.wait(timeout=10)
files=sorted(p for p in (S/'review/garage-lamps').rglob('*') if p.is_file() and p.name!='MANIFEST.json');pins={str(p.relative_to(S)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in files};pins['portable-check.py']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
result={'status':'PASS','free_ram_gib':ram,'server_closed':server.poll() is not None,'seconds':time.time()-start,'results':results,'pins':pins,'limits':['Component review only; no complete-wall, source GI or actual-shadow, phone or physical-print acceptance.']};(O/'RESULT.json').write_text(json.dumps(result,indent=2));print('PASS',[(x['side'],x['diagnostics']['glRenderer']) for x in results], 'server closed',server.poll() is not None)
