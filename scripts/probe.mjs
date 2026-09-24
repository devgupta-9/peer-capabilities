// Local stdio handshake only: never print raw configuration, env, stderr or payloads.
import { spawn } from 'node:child_process';
let request = '';
for await (const chunk of process.stdin) request += chunk;
let spec;
try { spec = JSON.parse(request); } catch { console.log(JSON.stringify({ok:false,error:'invalid_input'})); process.exit(1); }
const child = spawn(spec.command, spec.args ?? [], {
  cwd: spec.cwd, env: {...process.env, ...(spec.env ?? {})}, shell:false, windowsHide:true,
  stdio:['pipe','pipe','pipe'],
});
let finished=false, buffer='', bytes=0, stderrBytes=0;
const timer=setTimeout(()=>finish({ok:false,error:'timeout'}), 30000);
function finish(result) {
  if (finished) return;
  finished=true; clearTimeout(timer);
  child.kill();
  console.log(JSON.stringify(result));
}
function send(obj) { if (!finished) child.stdin.write(JSON.stringify({jsonrpc:'2.0',...obj})+'\n'); }
child.on('error',()=>finish({ok:false,error:'spawn_failed'}));
child.stdin.on('error',()=>finish({ok:false,error:'stdin_failed'}));
child.on('exit',()=>{if(!finished)finish({ok:false,error:'early_exit'});});
child.stderr.on('data',chunk=>{stderrBytes+=chunk.length; if(stderrBytes>2_000_000)finish({ok:false,error:'excessive_stderr'});});
child.stdout.on('data',chunk=>{
  bytes+=chunk.length;
  if(bytes>2_000_000){finish({ok:false,error:'excessive_output'});return;}
  buffer+=chunk;
  let newline;
  while((newline=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
    let msg;try{msg=JSON.parse(line);}catch{continue;}
    if(msg.id===1){
      if(msg.error||!msg.result){finish({ok:false,error:'initialize_failed'});return;}
      send({method:'notifications/initialized'});
      send({id:2,method:'tools/list',params:{}});
    }else if(msg.id===2){
      if(msg.error||!Array.isArray(msg.result?.tools)){finish({ok:false,error:'tools_list_failed'});return;}
      const names=msg.result.tools.map(t=>t.name);
      const delegate=msg.result.tools.find(t=>t.name==='delegate_peer');
      finish({ok:true,tools:names,...(delegate?{explicitModelSchema:['model','effort','selectionReason'].every(k=>delegate.inputSchema.required?.includes(k))&&!('tier' in delegate.inputSchema.properties)}:{})});
    }
  }
});
send({id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'local-ai-health',version:'1.0.0'}}});
