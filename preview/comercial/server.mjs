// Independent visual prototype. Never imports the MW1 API, credentials or database.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('./index.html',import.meta.url));
const port=Number(process.env.PORT||8080);
const csp="default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'";
createServer((req,res)=>{
  const path=req.url?.split('?')[0];
  if(req.method!=='GET' && req.method!=='HEAD'){
    res.writeHead(405,{'Allow':'GET, HEAD'}).end();return;
  }
  if(path==='/healthz'){
    res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}).end('ok');return;
  }
  if(path!=='/' && path!=='/index.html'){
    res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}).end('Not found');return;
  }
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store'}).end(req.method==='HEAD'?undefined:html);
}).listen(port,'0.0.0.0');
