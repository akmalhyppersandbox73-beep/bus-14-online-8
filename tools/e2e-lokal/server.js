// Server uji lokal: index.html + config.js uji + /api (Registry & handler asli proyek). Tidak memakai express/peer (tidak perlu npm install).
const http=require('http'),fs=require('fs'),path=require('path');
const PROJ=process.env.PROJ||path.join(__dirname,'..','..'); // akar proyek
const {Registry}=require(PROJ+'/server/rooms'),{createHandler}=require(PROJ+'/server/http');
exports.start=async()=>{
  const reg=new Registry();const h=createHandler(reg,{allowedOrigins:['*']});
  let port=0;
  const srv=http.createServer((q,s)=>h(q,s,()=>{
    const u=new URL(q.url,'http://x').pathname;
    if(u==='/'||u==='/index.html'){s.setHeader('Content-Type','text/html; charset=utf-8');return s.end(fs.readFileSync(PROJ+'/index.html'))}
    if(u==='/config.js'){s.setHeader('Content-Type','application/javascript');return s.end(`window.GAME_CONFIG={SERVER_URL:"http://127.0.0.1:${port}",API_BASE_URL:"http://127.0.0.1:${port}/api",PEERJS_HOST:"127.0.0.1",PEERJS_PORT:${port},PEERJS_SECURE:false,PEERJS_PATH:"/peerjs",ICE_SERVERS:[]};`)}
    s.statusCode=404;s.end('{}')}));
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));port=srv.address().port;
  return {reg,port,base:'http://127.0.0.1:'+port,close:()=>new Promise(r=>srv.close(r))};
};
