import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.mp4':'video/mp4'};
// This fixture endpoint never reads an arbitrary filename or proxies an upstream.
const image=await fs.readFile(path.join(root,'Showcase/assets/scene-01.png'));
export function createPreviewServer(){return http.createServer(async(req,res)=>{
 try{
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/view'){res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});res.end(image);return;}
  const pathname=decodeURIComponent(url.pathname==='/'?'/dev/table/index.html':url.pathname);
  if(!/^\/(?:dev\/table|web)\//.test(pathname)||pathname.includes('\0')||pathname.includes('\\'))throw Error('outside preview');
  const file=path.resolve(root,'.'+pathname);
  if(![path.join(root,'dev/table')+path.sep,path.join(root,'web')+path.sep].some(base=>file.startsWith(base)))throw Error('outside preview');
  const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self'"});res.end(data);
 }catch{res.writeHead(404);res.end('Not found');}
});}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.TABLE_PORT||8293);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('TABLE_PORT must be 1024–65535');
 const server=createPreviewServer();server.on('error',error=>{console.error(error.message);process.exitCode=1;});
 server.listen(port,'127.0.0.1',()=>console.log(`Table preview http://127.0.0.1:${port}/ (Ctrl+C to stop; browser-only synthetic data)`));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
}
