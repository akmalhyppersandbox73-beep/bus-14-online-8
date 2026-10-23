// Stub PeerJS (BroadcastChannel antar-halaman pada satu konteks browser) + stub THREE (Proxy) — hanya untuk uji E2E lokal tanpa internet.
exports.peerStub = `
(function(){
const bc=new BroadcastChannel('fakepeer'),uid=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
let me=null;const CONNS=new Map(); // cid -> Conn
class Conn{constructor(peer,remote,cid){this.peer=remote;this.cid=cid;this.owner=peer;this.open=false;this.h={};}
 on(e,f){(this.h[e]=this.h[e]||[]).push(f)} emit(e,...a){(this.h[e]||[]).forEach(f=>{try{f(...a)}catch(x){console.error('conn handler',x&&x.stack||x)}})}
 send(d){if(!this.open)throw new Error('closed');if(window.__fpMute)return;bc.postMessage({t:'d',cid:this.cid,to:this.peer,data:JSON.parse(JSON.stringify(d))})}
 close(){if(!this.open)return;this.open=false;bc.postMessage({t:'c',cid:this.cid,to:this.peer});CONNS.delete(this.cid);setTimeout(()=>this.emit('close'),0)}}
class Peer{constructor(id,opts){this.id=id||('g'+uid());this.h={};this.open=false;this.disconnected=false;this.destroyed=false;this.tok=uid();me=this;
 bc.postMessage({t:'claim',id:this.id,tok:this.tok});this._claim=setTimeout(()=>{if(this.destroyed)return;if(this._taken){this.emit('error',{type:'unavailable-id'});return}this.open=true;this.emit('open',this.id)},id?120:5)}
 on(e,f){(this.h[e]=this.h[e]||[]).push(f)} emit(e,...a){(this.h[e]||[]).forEach(f=>{try{f(...a)}catch(x){console.error('peer handler',x&&x.stack||x)}})}
 connect(rid){const cid=uid(),c=new Conn(this,rid,cid);CONNS.set(cid,c);bc.postMessage({t:'conn',to:rid,from:this.id,cid});
  setTimeout(()=>{if(!c.open&&!c._gone){CONNS.delete(cid);this.emit('error',{type:'peer-unavailable'})}},700);return c}
 reconnect(){} destroy(){this.destroyed=true;this.open=false;clearTimeout(this._claim);[...CONNS.values()].forEach(c=>c.close());me=null}}
bc.onmessage=ev=>{const m=ev.data;if(!me||me.destroyed)return;
 if(m.t=='claim'){if(me.open&&me.id===m.id)bc.postMessage({t:'taken',id:m.id,tok:m.tok})}
 else if(m.t=='taken'){if(me.tok===m.tok)me._taken=1}
 else if(m.t=='conn'){if(m.to!==me.id||!me.open)return;const c=new Conn(me,m.from,m.cid);CONNS.set(m.cid,c);c.open=true;bc.postMessage({t:'ack',cid:m.cid,to:m.from});me.emit('connection',c);c.emit('open')}
 else if(m.t=='ack'){const c=CONNS.get(m.cid);if(c&&m.to===me.id&&!c.open){c.open=true;c.emit('open')}}
 else if(m.t=='d'){if(window.__fpMute)return;const c=CONNS.get(m.cid);if(c&&c.open&&m.to===me.id)c.emit('data',m.data)}
 else if(m.t=='c'){const c=CONNS.get(m.cid);if(c&&m.to===me.id){c.open=false;CONNS.delete(m.cid);c.emit('close')}}};
window.__fp={dropAll:()=>{[...CONNS.values()].forEach(c=>c.close())},conns:()=>CONNS.size};
window.Peer=Peer;
})();`;
exports.threeStub = `
(function(){const f=function(){};const P=new Proxy(f,{get:(t,k)=>{if(k===Symbol.toPrimitive)return()=>0;if(k==='then')return undefined;return P},set:()=>true,apply:()=>P,construct:()=>P,has:()=>true});window.THREE=P;})();`;
