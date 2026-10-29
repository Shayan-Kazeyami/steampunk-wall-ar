"""Root slot required; any-Blender/12GiB RAM/port guards, owned bounded server."""
from pathlib import Path
import subprocess,sys,time,socket,json
B=Path(__file__).resolve().parent;R=B.parents[4];assert subprocess.check_output(['powershell','-NoProfile','-Command',"@(Get-Process blender -ErrorAction SilentlyContinue).Count"],text=True).strip()=='0','Active Blender; refused browser';available=float(subprocess.check_output(['powershell','-NoProfile','-Command',"[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,2)"],text=True).strip());assert available>=12,available
with socket.socket()as probe:probe.bind(('127.0.0.1',8083))
start=time.time();assert not(B/'browser-worker.json').exists();code=None
with(B/'http.log').open('w')as http,(B/'browser-run.log').open('w')as log:
 server=subprocess.Popen([sys.executable,'-m','http.server','8083','--bind','127.0.0.1','--directory',str(R)],stdout=http,stderr=subprocess.STDOUT)
 try:
  (B/'browser-worker.json').write_text(json.dumps({'status':'RUNNING','server_pid':server.pid,'prelaunch_free_RAM_GiB':available,'minimum_RAM_GiB':12}));time.sleep(1);assert server.poll()is None;job=subprocess.run([sys.executable,str(B/'check_browser.py')],cwd=R,stdout=log,stderr=subprocess.STDOUT,timeout=180);code=job.returncode
 finally:server.terminate();server.wait(timeout=10);(B/'browser-worker.json').write_text(json.dumps({'status':'EXITED','server_pid':server.pid,'server_closed':True,'browser_exit':code,'seconds':time.time()-start,'prelaunch_free_RAM_GiB':available},indent=2))
print((B/'browser-worker.json').read_text());raise SystemExit(code)
