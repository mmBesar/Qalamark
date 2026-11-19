import sys,json,time,base64,urllib.request,subprocess,os
BASE='http://127.0.0.1:4455'
def req(m,p,b=None):
    r=urllib.request.Request(BASE+p,method=m,data=json.dumps(b).encode() if b is not None else None,headers={'Content-Type':'application/json'})
    return json.load(urllib.request.urlopen(r,timeout=90))
srv=subprocess.Popen(['WebKitWebDriver','--port=4455'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1.5)
URL='http://127.0.0.1:34610/'
def run():
    caps={'capabilities':{'alwaysMatch':{'browserName':'MiniBrowser','webkitgtk:browserOptions':{'binary':'/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser','args':['--automation']}}}}
    sid=req('POST','/session',caps)['value']['sessionId']
    js=lambda s,a=[]: req('POST',f'/session/{sid}/execute/sync',{'script':s,'args':a})['value']
    req('POST',f'/session/{sid}/window/rect',{'width':1200,'height':1100})
    req('POST',f'/session/{sid}/url',{'url':URL}); time.sleep(2)
    settings=json.loads(os.environ.get('SETTINGS','{}'))
    js("localStorage.setItem('qm.settings', JSON.stringify(arguments[0]))",[settings])
    req('POST',f'/session/{sid}/url',{'url':URL}); time.sleep(2)
    js("""const set=(el,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
      set(document.querySelector('input[autocomplete=username]'),'alice');set(document.querySelector('input[type=password]'),'alice-password');document.querySelector('button.primary').click();""")
    time.sleep(3)
    js("document.querySelector('aside .actions button').click()"); time.sleep(1.5)
    text=os.environ.get('TEXT','')
    js("const c=document.querySelector('.cm-content');c.focus();document.execCommand('insertText',false,arguments[0])",[text]); time.sleep(1.5)
    js("const s=document.createElement('style');s.textContent=arguments[0];document.head.append(s);return 1",[os.environ.get('CSS','')])
    if os.environ.get('JS'):
        try: js(os.environ['JS'])
        except Exception as e: print('JSERR',e, getattr(e,'read',lambda:b'')()[:400])
    time.sleep(0.8)
    out=js(open(os.environ['PROBE']).read()) if os.environ.get('PROBE') else None
    if out: print(out)
    open(sys.argv[1],'wb').write(base64.b64decode(req('GET',f'/session/{sid}/screenshot')['value']))
    req('DELETE',f'/session/{sid}')
try: run()
finally: srv.terminate()
