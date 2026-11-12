const fs=require('fs');
const p='C:\\Users\\z3312\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar';
const fd=fs.openSync(p,'r'); const head=Buffer.alloc(16); fs.readSync(fd,head,0,16,0);
const headerSize=head.readUInt32LE(4), jsonLen=head.readUInt32LE(12); const json=Buffer.alloc(jsonLen); fs.readSync(fd,json,0,jsonLen,16); const tree=JSON.parse(json.toString('utf8')); const payloadStart=8+headerSize;
function walk(node,prefix,out){for(const [k,v] of Object.entries(node.files||{})){const path=prefix?prefix+'/'+k:k; if(v.files) walk(v,path,out); else out.push({path,offset:Number(v.offset),size:v.size});}}
const files=[]; walk(tree,'',files);
const matches=files.filter(f=>/dsh-web-app|dsh-web\/|dsh-headless/.test(f.path) && /(README|package\.json|cordis\.patch\.yml|lib\/index\.js)$/.test(f.path));
for(const m of matches.slice(0,60)) console.log(m.path,m.size);
function read(entry){const b=Buffer.alloc(entry.size); fs.readSync(fd,b,0,entry.size,payloadStart+entry.offset); return b.toString('utf8');}
for(const m of matches.filter(x=>/README\.md$/.test(x.path)).slice(0,3)){console.log('\n--- '+m.path+' ---\n'+read(m).slice(0,10000));}
fs.closeSync(fd);
