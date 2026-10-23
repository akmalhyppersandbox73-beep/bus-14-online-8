import json,subprocess
from playwright.sync_api import sync_playwright
import os
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..'))
st=json.loads(subprocess.check_output(['node','-e',"const s=require('%s/tools/e2e-lokal/stubs');console.log(JSON.stringify({p:s.peerStub,t:s.threeStub}))"%ROOT]))
def rooms(n): return [{"id":"ABC%s"%chr(65+i%26),"name":"Server %d"%i,"hostName":"H%d"%i,"players":1,"max":4,"status":"LOBBY","full":False} for i in range(n)]
def mk(b,w,h,n,touch=True):
    ctx=b.new_context(viewport={'width':w,'height':h},has_touch=touch,is_mobile=touch)
    ctx.route('**/peerjs**',lambda r,*a:r.fulfill(content_type='application/javascript',body=st['p']))
    ctx.route('**/three.min.js',lambda r,*a:r.fulfill(content_type='application/javascript',body=st['t']))
    ctx.route('**/health',lambda r,*a:r.fulfill(content_type='application/json',body='{"app":"bus14-server"}'))
    B=json.dumps({"rooms":rooms(n)})
    ctx.route('**/api/rooms*',lambda r,*a:r.fulfill(content_type='application/json',body=B))
    pg=ctx.new_page(); pg.errs=[]; pg.on('pageerror',lambda e:pg.errs.append(str(e)))
    pg.goto('file://'+ROOT+'/index.html'); pg.wait_for_timeout(1200)
    pg.evaluate("document.getElementById('ld')&&document.getElementById('ld').remove()")
    pg.evaluate("document.getElementById('bon').click()"); pg.wait_for_timeout(900)
    return ctx,pg
M="""()=>{const q=s=>document.querySelector(s),mo=q('#mo'),R=e=>e.getBoundingClientRect();
 const inVp=e=>{const b=R(e);return b.top>=-1&&b.bottom<=innerHeight+1&&b.left>=-1&&b.right<=innerWidth+1};
 return {hs:document.documentElement.scrollWidth>innerWidth||mo.scrollWidth>mo.clientWidth,moScr:[mo.scrollHeight,mo.clientHeight],listH:Math.round(R(q('#olist')).height),listScr:[q('#olist').scrollHeight,q('#olist').clientHeight],
 vis:Object.fromEntries(['orf','ocr','ojn','ob','osq','pno'].map(i=>[i,inVp(q('#'+i))]))}}"""
with sync_playwright() as p:
    b=p.chromium.launch()
    print('== landscape: form BUAT SERVER terbuka, join klik')
    for (w,h) in [(844,390),(667,375),(568,320)]:
        ctx,pg=mk(b,w,h,12)
        pg.tap('#ocr'); pg.wait_for_timeout(300)
        r=pg.evaluate(M)
        mos=pg.evaluate("(()=>{const s=document.querySelector('.mos');return [s.scrollHeight,s.clientHeight]})()")
        ocg=pg.evaluate("(()=>{pg=document.querySelector('#ocg');pg.scrollIntoView({block:'nearest'});const b=pg.getBoundingClientRect(),m=document.querySelector('.mos').getBoundingClientRect();return b.top>=m.top-1&&b.bottom<=m.bottom+1})()")
        print(w,h,'form open',json.dumps(r),'mos',mos,'ocg tampak setelah scroll kolom kiri:',ocg)
        pg.screenshot(path='/home/claude/shots/form_%dx%d.png'%(w,h))
        # scroll list to bottom, tap last join
        pg.tap('#ocr'); pg.wait_for_timeout(200)
        pg.evaluate("document.querySelector('#olist').scrollTop=99999"); pg.wait_for_timeout(200)
        calls=pg.evaluate("(()=>{window.__j=[];return 1})()")
        btn=pg.locator('#olist .ri button').last
        bb=btn.bounding_box(); print('  last join box',bb, 'size ok', bb['height']>=36 and bb['width']>=60)
        btn.tap(); pg.wait_for_timeout(1500)
        joined=pg.evaluate("!document.querySelector('#mr').classList.contains('hid')||document.querySelector('#on').textContent")
        print('  setelah tap Gabung ->',joined,'| errs',pg.errs[:2])
        ctx.close()
    print('== landscape varian daftar')
    for n in (0,1):
        ctx,pg=mk(b,740,360,n); print(n,json.dumps(pg.evaluate(M))); pg.screenshot(path='/home/claude/shots/n%d_740.png'%n); ctx.close()
    print('== regresi')
    for name,(w,h,t) in {'portrait360x740':(360,740,True),'portrait390x844':(390,844,True),'tablet1024x768':(1024,768,True),'tabletPortrait768x1024':(768,1024,True),'pc1366x768':(1366,768,False),'pc1920x1080':(1920,1080,False),'pcShort1280x500':(1280,500,False)}.items():
        ctx,pg=mk(b,w,h,12,t); r=pg.evaluate(M); print(name,json.dumps(r)); pg.screenshot(path='/home/claude/shots/reg_%s.png'%name); ctx.close()
    b.close()
