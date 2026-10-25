import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv, processAlive } from '../launcher-config.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const runtime = () => { const path=mkdtempSync(join(root,'.runtime/launcher-test-'));mkdirSync(join(path,'logs'));return path; };
async function launch(directory,extra={}) {
  const child=spawn(process.execPath,[join(root,'scripts/mvp.mjs'),'--skip-build','--no-frontend'],{cwd:root,windowsHide:true,env:{...process.env,BETWEENLY_RUNTIME:directory,DEEPSEEK_API_KEY:'test-only-key',TYPESAFE_API_KEY:'',JEV_ENABLED:'false',...extra},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const code=await new Promise((yes,no)=>{child.once('exit',yes);child.once('error',no);});
  return {code,output};
}

test('Windows BOM, whitespace, quotes and CRLF work in local configuration',()=>{
  const config=parseEnv('\uFEFF# local\r\n DEEPSEEK_API_KEY = "fake-key"\r\nTYPESAFE_API_KEY=\'fake-jev\'\r\nJEV_ENABLED=auto\r\nEMPTY=\r\n');
  assert.equal(config.DEEPSEEK_API_KEY,'fake-key');assert.equal(config.TYPESAFE_API_KEY,'fake-jev');assert.equal(config.EMPTY,'');
});
test('malformed configuration reports the line number without printing its contents',()=>{
  assert.throws(()=>parseEnv('GOOD=value\nprivate-credential-without-equals'),error=>error.message.includes('line 2')&&!error.message.includes('private-credential'));
});
test('invalid process IDs do not identify an existing launcher',()=>{
  assert.equal(processAlive(undefined),false);assert.equal(processAlive(-1),false);assert.equal(processAlive('123'),false);assert.equal(processAlive(process.pid),true);
});
test('configuration failures exit with an explanation and persist a startup log',async()=>{
  const directory=runtime();writeFileSync(join(directory,'run.json'),'{');const result=await launch(directory,{DEEPSEEK_API_KEY:''});
  assert.equal(result.code,1);assert.match(result.output,/Betweenly could not start:/);assert.doesNotMatch(result.output,/at ModuleJob|file:\/\/\//);
  assert.match(readFileSync(join(directory,'logs/launcher.log'),'utf8'),/startup registry is unreadable/);
});
test('a healthy existing instance is reused without replacing its registry or data',async t=>{
  const directory=runtime();let port;
  const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'healthy',service:'api-gateway'}));});
  for(let candidate=7080;candidate<7090;candidate++) {
    try { await new Promise((yes,no)=>{server.once('error',no);server.listen(candidate,'127.0.0.1',yes);});port=candidate;break; }
    catch(error){server.removeAllListeners('error');if(error.code!=='EADDRINUSE')throw error;}
  }
  assert.ok(port,'No free isolated test port');t.after(()=>new Promise(yes=>server.close(yes)));
  const manifest=JSON.stringify({launcherPid:process.pid,gatewayUrl:`http://127.0.0.1:${port}`,children:[]});
  writeFileSync(join(directory,'run.json'),manifest);writeFileSync(join(directory,'keep.txt'),'keep user data');
  const result=await launch(directory,{BETWEENLY_PORT_OFFSET:String(port-5080)});
  assert.equal(result.code,0);assert.match(result.output,/already running/);assert.equal(readFileSync(join(directory,'run.json'),'utf8'),manifest);assert.equal(readFileSync(join(directory,'keep.txt'),'utf8'),'keep user data');
});
test('a live but unreachable instance fails clearly without deleting its registry',async()=>{
  const directory=runtime();const manifest=JSON.stringify({launcherPid:process.pid,children:[]});writeFileSync(join(directory,'run.json'),manifest);
  const result=await launch(directory,{BETWEENLY_PORT_OFFSET:'3000'});
  assert.equal(result.code,1);assert.match(result.output,/already active/);assert.equal(readFileSync(join(directory,'run.json'),'utf8'),manifest);
});
