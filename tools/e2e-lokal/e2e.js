// UJI E2E LOKAL (opsional, BUKAN bagian npm test): memuat index.html di Chromium sungguhan via Playwright dan menjalankan skenario nama pemain
// (host + guest ONLINE & LAN, nama kosong/panjang, reconnect, keluar, kick, nama server kustom, mulai game + chat).
// CATATAN: PeerJS diganti stub (BroadcastChannel antar-tab) dan Three.js diganti stub, jadi ini BUKAN uji WebRTC/Suga sungguhan.
// Prasyarat: npm i -D playwright && npx playwright install chromium   (atau set PLAYWRIGHT_BROWSERS_PATH). Jalankan: node tools/e2e-lokal/e2e.js
const {chromium}=(()=>{try{return require('playwright')}catch(e){return require('/home/claude/.npm-global/lib/node_modules/playwright')}})();
const {peerStub,threeStub}=require('./stubs');const {start}=require('./server');
const results=[];const ok=(c,m)=>{results.push([!!c,m]);console.log((c?'  PASS ':'  FAIL ')+m)};
const eq=(a,b,m)=>{const A=JSON.stringify(a),B=JSON.stringify(b);ok(A===B,m+(A===B?'':'  | dapat='+A+' harap='+B))};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const S=await start();const br=await chromium.launch();const ctx=await br.newContext({viewport:{width:420,height:820}});
  await ctx.route(/peerjs/,r=>r.fulfill({contentType:'application/javascript',body:peerStub}));
  await ctx.route(/three\.min\.js/,r=>r.fulfill({contentType:'application/javascript',body:threeStub}));
  const errs=[];
  const mk=async tag=>{const p=await ctx.newPage();p.tag=tag;p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));p.on('console',m=>{if(m.type()=='error')errs.push(tag+' console.error: '+m.text())});await p.goto(S.base+'/');await p.waitForTimeout(300);return p};
  const rows=p=>p.$$eval('#mpl .ri',els=>els.map(e=>e.querySelector('b').textContent));
  const vis=(p,id)=>p.$eval('#'+id,e=>!e.classList.contains('hid'));
  const rooms=async mode=>(await fetch(S.base+'/api/rooms?mode='+mode).then(r=>r.json())).rooms;
  const onlineHost=async(p,name,srvName)=>{await p.click('#bon');await p.fill('#pno',name);await p.click('#ocr');if(srvName)await p.fill('#osn',srvName);await p.click('#ocg');await p.waitForSelector('#mr:not(.hid)',{timeout:8000});return(await p.textContent('#mid')).replace('ROOM ID: ','').trim()};
  const onlineJoin=async(p,name,id)=>{await p.click('#bon');await p.fill('#pno',name);await p.fill('#oid',id);await p.click('#ojn');await p.waitForSelector('#mr:not(.hid)',{timeout:8000})};

  console.log('\n[1] Host ONLINE membuat room dengan nama custom (input diketik dengan karakter tidak valid)');
  const H=await mk('HOST');
  await H.click('#bon');await H.fill('#pno','Host  Satu<>');
  eq(await H.$eval('#pno',e=>e.value),'Host  Satu','karakter tidak valid (<>) dibuang langsung; spasi ganda dibiarkan selagi mengetik');
  await H.$eval('#pno',e=>e.blur());eq(await H.$eval('#pno',e=>e.value),'Host Satu','setelah blur kolom dirapikan');
  await H.click('#ocr');
  eq(await H.$eval('#osn',e=>e.value),'Server Host Satu','nama server bawaan = "Server <nama host>"');
  await H.click('#ocg');await H.waitForSelector('#mr:not(.hid)',{timeout:8000});
  const ID=(await H.textContent('#mid')).replace('ROOM ID: ','').trim();ok(/^[A-Z]{4}$/.test(ID),'Room ID '+ID);
  let L=await rooms('online');
  eq(L.map(r=>[r.hostName,r.name]),[['Host Satu','Server Host Satu']],'daftar server: hostName custom + nama server bawaan');

  console.log('\n[2] Tiga guest: nama biasa, nama panjang+tag HTML, nama kosong');
  const A=await mk('A'),B=await mk('B'),C=await mk('C');
  await onlineJoin(A,'Ana',ID);
  await B.click('#bon');await B.$eval('#pno',e=>{e.value='<b>Budi Panjang Sekali Nama</b>';e.dispatchEvent(new Event('input'))});await B.fill('#oid',ID);await B.click('#ojn');await B.waitForSelector('#mr:not(.hid)',{timeout:8000});
  await C.click('#bon');await C.fill('#pno','');await C.fill('#oid',ID);await C.click('#ojn');await C.waitForSelector('#mr:not(.hid)',{timeout:8000});
  await sleep(1200);
  const bName=await B.$eval('#pno',e=>e.value);eq(bName,'bBudi Panjang Se','nama B (tag HTML + terlalu panjang) dibersihkan & dipotong 16 karakter');
  const hostRows=await rows(H);
  console.log('   baris lobi host:',hostRows);
  eq(hostRows.length,4,'host melihat 4 pemain');
  ok(hostRows[0].startsWith('Host Satu (kamu)')&&hostRows[0].includes('HOST'),'host: baris pertama = nama host sendiri (kamu, HOST)');
  const strip=r=>r.replace(' (kamu)','').replace(' ★ HOST','');
  const setOf=async p=>(await rows(p)).map(strip).sort();
  const want=['Ana',bName,'Host Satu','Pemain'].sort();
  for(const p of [H,A,B,C])eq(await setOf(p),want,p.tag+': daftar nama sama persis & tidak ada yang tertimpa');
  for(const [p,n] of [[A,'Ana'],[B,bName],[C,'Pemain']]){const me=(await rows(p)).filter(r=>r.includes('(kamu)')).map(strip);eq(me,[n],p.tag+': baris "(kamu)" = nama sendiri');}
  eq((await rooms('online')).length,1,'masih satu room terdaftar');

  console.log('\n[3] Guest 4 melihat room di DAFTAR SERVER dengan host custom');
  const D=await mk('D');await D.click('#bon');await D.waitForSelector('#olist .ri',{timeout:8000});
  const listTxt=await D.textContent('#olist');ok(listTxt.includes('Server Host Satu')&&listTxt.includes('host Host Satu'),'UI daftar server menampilkan nama server & host custom');

  console.log('\n[4] Reconnect guest A (koneksi diputus paksa) -> nama tetap');
  const before=await setOf(H);
  await A.evaluate(()=>window.__fp.dropAll());
  await sleep(6500);
  for(const p of [H,A,B,C])eq(await setOf(p),before,p.tag+': nama utuh setelah reconnect');
  eq((await rows(A)).filter(r=>r.includes('(kamu)')).map(strip),['Ana'],'A: tetap "Ana (kamu)"');

  console.log('\n[5] Guest A keluar sendiri; guest baru "Eko" masuk');
  await A.click('#mb');await A.waitForSelector('#lc:not(.hid)');await A.click('#lcy');await sleep(1500);
  const afterLeave=['Host Satu',bName,'Pemain'].sort();
  for(const p of [H,B,C])eq(await setOf(p),afterLeave,p.tag+': tanpa Ana, nama lain utuh');
  const E=await mk('E');await onlineJoin(E,'Eko',ID);await sleep(1200);
  for(const p of [H,B,C,E])eq(await setOf(p),['Eko','Host Satu',bName,'Pemain'].sort(),p.tag+': Eko muncul, tidak mewarisi nama Ana');

  console.log('\n[6] Host KICK guest B (konfirmasi menyebut nama B) -> nama lain utuh');
  const kb=await H.$$('#mpl .ri');let kicked=false;
  for(const r of kb){const t=await r.$eval('b',e=>e.textContent);if(t.startsWith(bName)){await (await r.$('button')).click();kicked=true}}
  ok(kicked,'tombol KICK pada baris '+bName);
  await H.waitForSelector('#kc:not(.hid)');const kmsg=await H.textContent('#kcm');ok(kmsg.includes(bName),'dialog kick menyebut nama pemain: "'+kmsg.slice(0,50)+'…"');
  await H.click('#kcy');await sleep(1500);
  for(const p of [H,C,E])eq(await setOf(p),['Eko','Host Satu','Pemain'].sort(),p.tag+': setelah kick');

  console.log('\n[7] Nama server KUSTOM tidak ditimpa saat nama host diubah; hostName custom di registry');
  const F=await mk('F');await F.click('#bon');await F.fill('#pno','Dewi');await F.click('#ocr');
  await F.fill('#osn','Warung Horor');await F.fill('#pno','Citra');
  eq(await F.$eval('#osn',e=>e.value),'Warung Horor','nama server kustom tidak berubah setelah nama diganti');
  await F.click('#ocg');await F.waitForSelector('#mr:not(.hid)',{timeout:8000});
  L=await rooms('online');const w=L.find(r=>r.name==='Warung Horor');
  ok(w&&w.hostName==='Citra','registry: name="Warung Horor", hostName="Citra" → '+JSON.stringify(w&&[w.name,w.hostName]));

  console.log('\n[8] Nama bertahan: Pengaturan & muat ulang halaman');
  const P2=await mk('RELOAD');await P2.click('#bon');await P2.fill('#pno','Nama Tersimpan');await P2.reload();await P2.waitForTimeout(400);
  eq(await P2.$eval('#pno',e=>e.value),'Nama Tersimpan','setelah reload, kolom nama online terisi nama terakhir');
  await P2.click('#bo');eq(await P2.$eval('#nm',e=>e.value),'Nama Tersimpan','kolom Nama di Pengaturan sama');
  await P2.fill('#nm','Dari Pengaturan');await P2.click('#set .bk');await P2.click('#bp');
  eq(await P2.$eval('#pnl',e=>e.value),'Dari Pengaturan','layar LAN ikut nama dari Pengaturan');

  console.log('\n[9] Multiplayer LAN: host & guest dengan nama berbeda');
  const LH=await mk('LANHOST');await LH.click('#bp');await LH.fill('#pnl','Lan Host');await LH.click('#mc');await LH.waitForSelector('#mr:not(.hid)',{timeout:8000});
  const LID=(await LH.textContent('#mid')).replace('ROOM ID: ','').trim();
  const LG=await mk('LANGUEST');await LG.click('#bp');await LG.fill('#pnl','Lan Tamu');await LG.fill('#mi',LID);await LG.click('#mj');await LG.waitForSelector('#mr:not(.hid)',{timeout:8000});await sleep(1200);
  for(const p of [LH,LG])eq(await setOf(p),['Lan Host','Lan Tamu'],p.tag+': nama LAN benar');
  const lr=(await rooms('lan'))[0];ok(lr&&lr.hostName==='Lan Host','registry LAN hostName="Lan Host" '+JSON.stringify(lr&&[lr.name,lr.hostName]));

  console.log('\n[10] Mulai game ONLINE + chat: nama pengirim benar');
  await C.click('#mrdy');await E.click('#mrdy');await sleep(800);
  const startDisabled=await H.$eval('#mst',e=>e.disabled);ok(!startDisabled,'tombol MULAI aktif setelah semua siap');
  await H.click('#mst');await sleep(3500);
  const cbVisible=await vis(C,'cb');ok(cbVisible,'tombol CHAT muncul di guest (game dimulai)');
  if(cbVisible){await C.click('#cb');await C.fill('#ci','halo dari C');await C.click('#cs');await sleep(800);
    const hostChat=await H.evaluate(()=>{const b=document.getElementById('cb');b.click();return document.getElementById('cl').textContent});
    ok(hostChat.includes('Pemain')&&hostChat.includes('halo dari C'),'chat di host: pengirim = "Pemain" → '+JSON.stringify(hostChat.slice(0,80)));
    await sleep(300);
    const echo=await C.textContent('#cl');ok(echo.includes('halo dari C'),'chat di pengirim tampil');}
  console.log('\n[11] Error JavaScript selama seluruh uji:');
  console.log(errs.length?errs.map(e=>'   '+e).join('\n'):'   (tidak ada)');
  ok(errs.length===0,'tidak ada pageerror/console.error');
  const f=results.filter(r=>!r[0]).length;console.log('\nRINGKASAN E2E:',results.length-f,'lulus,',f,'gagal');
  await br.close();await S.close();process.exit(f?1:0);
})().catch(e=>{console.error('FATAL',e);process.exit(2)});
