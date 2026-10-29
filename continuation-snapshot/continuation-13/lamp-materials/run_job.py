"""Root slot required. Refuse any active Blender version before bounded launch."""
from pathlib import Path
import subprocess,sys,time,json
B=Path(__file__).resolve().parent;job=sys.argv[1];assert job in ['build'];state=B/(job+'-worker.json');logpath=B/(job+'-worker.log');assert not state.exists()and not logpath.exists()
active=subprocess.check_output(['powershell','-NoProfile','-Command',"@(Get-Process blender -ErrorAction SilentlyContinue).Count"],text=True).strip();assert active=='0',('Active Blender; refused launch',active)
available=float(subprocess.check_output(['powershell','-NoProfile','-Command',"[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,2)"],text=True).strip());assert available>=12,('Insufficient free RAM GiB',available)
start=time.time()
with logpath.open('w')as log:
 p=subprocess.Popen(['C:/Program Files/Blender Foundation/Blender 5.2/blender.exe','--factory-startup','--background','--disable-autoexec','--threads','4','--python-exit-code','1','--python',str(B/(job+'.py'))],stdout=log,stderr=subprocess.STDOUT);state.write_text(json.dumps({'status':'RUNNING','pid':p.pid,'started':start,'prelaunch_free_RAM_GiB':available,'minimum_RAM_GiB':12},indent=2))
 try:code=p.wait(timeout=120)
 except subprocess.TimeoutExpired:p.kill();code=p.wait()
state.write_text(json.dumps({'status':'EXITED','pid':p.pid,'exit_code':code,'seconds':time.time()-start},indent=2));print(state.read_text());raise SystemExit(code)
