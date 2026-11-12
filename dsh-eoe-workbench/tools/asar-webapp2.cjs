const fs=require('fs');
const p='C:\\Users\\z3312\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar';
const fd=fs.openSync(p,'r'); const head=Buffer.alloc(16); fs.readSync(fd,head,0,16,0);
const headerSize=head.readUInt32LE(4), jsonLen=head.readUInt32LE(12); const json=Buffer.alloc(jsonLen); fs.readSync(fd,json,0,jsonLen,16); const tree=JSON.parse(json.toString('utf8')); const payloadStart=8+headerSize;
function walk(node,prefix,out){for(const [k,v] of Object.entries(node.files||{})){const path=prefix?prefix+'/'+k:k; if(v.files) walk(v,path,out); else out.push({path,offset:Number(v.offset),size:v.size});}}
const files=[]; walk(tree,'',files);
function readPath(path){const e=files.find(f=>f.path===path); if(!e) throw new Error('not found '+path); const b=Buffer.alloc(e.size); fs.readSync(fd,b,0,e.size,payloadStart+e.offset); return b.toString('utf8');}
for(const path of ['dsh/node_modules/@deepseek-ai/dsh-web-app/package.json','dsh/node_modules/@deepseek-ai/dsh-web-app/lib/index.js','dsh/node_modules/@deepseek-ai/dsh-web/package.json','dsh/node_modules/@deepseek-ai/dsh-web/lib/index.js']){
 console.log('\n--- '+path+' ---\n'+readPath(path).slice(0,22000));
}
fs.closeSync(fd);
