"""CDP screenshot and interaction harness, using local Chrome. No npm dependencies."""
import base64,json,os,subprocess,sys,time,urllib.parse,urllib.request
import websocket
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT=9347
proc=subprocess.Popen(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','--headless=new',f'--remote-debugging-port={PORT}','--remote-allow-origins=*','--user-data-dir=/tmp/forma-browser-qa','--window-size=1280,800','--force-device-scale-factor=1','--use-angle=metal','--enable-unsafe-gpu-swiftshader','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for i in range(80):
 try: urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json/version',timeout=1).read();break
 except Exception:time.sleep(.25)
req=urllib.request.Request(f'http://127.0.0.1:{PORT}/json/new?http://127.0.0.1:8770/body/',method='PUT')
tgt=json.loads(urllib.request.urlopen(req).read());ws=websocket.create_connection(tgt['webSocketDebuggerUrl'],timeout=60);seq=0;errors=[]
def cmd(method,**params):
 global seq
 seq+=1;ws.send(json.dumps({'id':seq,'method':method,'params':params}))
 while True:
  msg=json.loads(ws.recv())
  if msg.get('method')=='Runtime.exceptionThrown':errors.append(msg['params'])
  if msg.get('method')=='Runtime.consoleAPICalled' and msg['params']['type']=='error':errors.append(msg['params'])
  if msg.get('method')=='Log.entryAdded' and msg['params']['entry']['level']=='error':errors.append(msg['params'])
  if msg.get('id')==seq:
   if 'error' in msg:raise RuntimeError(msg['error'])
   return msg.get('result',{})
def js(expr):
 r=cmd('Runtime.evaluate',expression=expr,awaitPromise=True,returnByValue=True)
 if 'exceptionDetails' in r:raise RuntimeError(r['exceptionDetails'])
 return r.get('result',{}).get('value')
def shot(name):
 path=os.path.join(ROOT,'shots',name+'.png');os.makedirs(os.path.dirname(path),exist_ok=True)
 open(path,'wb').write(base64.b64decode(cmd('Page.captureScreenshot',format='png')['data']));print('SHOT',path,flush=True)
cmd('Page.enable');cmd('Runtime.enable');cmd('Log.enable');cmd('Emulation.setDeviceMetricsOverride',width=1280,height=800,deviceScaleFactor=1,mobile=False)
for _ in range(100):
 if js('window.__ready?.()'):break
 time.sleep(.2)
print('READY',js('window.__ready?.()'),flush=True)
if not js('window.__ready?.()'):print(js('document.body.innerText'),errors);proc.terminate();sys.exit(1)
js("Object.keys(localStorage).filter(k=>k.startsWith('health-map:kg1:')).forEach(k=>localStorage.removeItem(k))");cmd('Page.reload')
for _ in range(100):
 if js('window.__ready?.()'):break
 time.sleep(.2)
time.sleep(1)
shot(sys.argv[1]+'-body' if len(sys.argv)>1 else 'pass1-body')
print('METRICS',js('window.__health.metrics()'),flush=True)
print('ORGANS',js('window.__health.organs()'),flush=True)
js("window.__setMode('out','organs')");time.sleep(1);shot(sys.argv[1]+'-layer' if len(sys.argv)>1 else 'pass1-layer')
js("window.__openOrgan('heart')");time.sleep(.6);shot(sys.argv[1]+'-heart' if len(sys.argv)>1 else 'pass1-heart')
print('ERRORS',errors,flush=True)
# Optional test code runs with cmd/js/shot helpers.
if os.environ.get('FORMA_QA_EXTRA'):exec(open(os.environ['FORMA_QA_EXTRA']).read())
ws.close();proc.terminate()
