// Source-level event/scene regression checks using real GLB geometry and three.js.
// This is not a browser rendering test: renderer/controls/DOM are small test adapters.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const library={console,performance,TextDecoder,TextEncoder,URL,Blob,ArrayBuffer,navigator:{userAgent:"Node geometry validation"}};vm.createContext(library);vm.runInContext(readFileSync(new URL('lib/three.min.js',root),'utf8'),library);const THREE=library.THREE;
class Element {
 constructor(){this.children=[];this.dataset={};this.className='';this.textContent='';this.counter={textContent:''};this.classList={toggle:()=>{},add:()=>{},remove:()=>{}};}
 set innerHTML(value){this.html=value;this.children=[];this.counter.textContent=value.match(/class="cnt">([^<]*)/)?.[1]||'';}
 get innerHTML(){return this.html||'';}
 appendChild(child){this.children.push(child);return child;}
 querySelector(selector){return selector==='.cnt'?this.counter:null;}
 click(){this.onclick?.({target:{closest:()=>null},currentTarget:this});}
}
const els=Object.fromEntries(['stage','rows','foot','legend','collapse','skinBtn'].map(id=>[id,new Element()]));
const modes=['body','out','spread'].map(mode=>Object.assign(new Element(),{dataset:{mode}}));
const sexes=['female','male'].map(sex=>Object.assign(new Element(),{dataset:{sex}}));
const document={querySelector:s=>s==='.row[data-layer="organs"] .cnt'?els.rows.children.find(r=>r.dataset.layer==='organs')?.counter:null,getElementById:id=>els[id],createElement:()=>new Element(),querySelectorAll:s=>s==='.bar button[data-mode]'?modes:s==='#sex button'?sexes:s==='.row'?els.rows.children:[]};
THREE.WebGLRenderer=class{constructor(){this.domElement=new Element()}setPixelRatio(){}setSize(){}render(){}};
THREE.OrbitControls=class{constructor(){this.target=new THREE.Vector3()}update(){}};
vm.runInContext(readFileSync(new URL('lib/GLTFLoader.js',root),'utf8'),library);
const ActualGLTFLoader=THREE.GLTFLoader;
THREE.GLTFLoader=class extends ActualGLTFLoader{load(file,ok,progress,fail){queueMicrotask(()=>{try{const b=readFileSync(new URL(file,root));this.parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',ok,fail)}catch(e){fail?.(e)}})}};
const context={THREE,document,console,innerWidth:1280,innerHeight:800,devicePixelRatio:1,requestAnimationFrame:()=>{},addEventListener:()=>{},queueMicrotask,performance};context.window=context;
const html=readFileSync(new URL('index.html',root),'utf8');const code=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];vm.createContext(context);vm.runInContext(code,context);
assert.equal(els.rows.children.length,8,'rail exists before any file finishes loading');
for(let i=0;i<50&&!context.__ready();i++)await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(context.__ready(),true,'model loading finishes');
const evaluate=s=>vm.runInContext(s,context);
assert.equal(evaluate('variantCount("reproductive","male")'),12);
assert.equal(evaluate('variantCount("reproductive","female")'),19);
assert.equal(evaluate('counts.organs'),104,'all original common organs retained');
for(const row of els.rows.children){row.click();assert.equal(evaluate('state.mode'),'out');assert.equal(evaluate('state.pull'),row.dataset.layer);assert.equal(evaluate(`groups.${row.dataset.layer}.visible`),true);}
const row=els.rows.children.find(r=>r.dataset.layer==='bones');row.onclick({target:{closest:s=>s==='.eye'?{}:null}});assert.equal(evaluate('groups.bones.visible'),false);context.__toggle('bones');assert.equal(evaluate('groups.bones.visible'),true);
context.__setSex('female');assert.equal(evaluate('availableOrganCount()'),101);assert.equal(evaluate('groups.reproductive.userData.variants.female.visible'),true);assert.equal(evaluate('groups.reproductive.userData.variants.male.visible'),false);assert.equal(evaluate('(()=>{let found;groups.organs.traverse(o=>{if(o.isMesh&&/^Urethra/i.test(o.name))found=o.visible});return found})()'),false);
context.__setSex('male');assert.equal(evaluate('availableOrganCount()'),104);assert.equal(evaluate('groups.reproductive.userData.variants.male.visible'),true);assert.equal(evaluate('(()=>{let found;groups.organs.traverse(o=>{if(o.isMesh&&/^Urethra/i.test(o.name))found=o.visible});return found})()'),true);
for(const mode of modes){mode.click();assert.equal(evaluate('state.mode'),mode.dataset.mode);assert.ok(evaluate('Number.isFinite(camera.position.z)&&camera.position.z>0'));}
context.__setSkin(true);assert.equal(evaluate('groups.skin.visible'),true);context.__collapse();assert.equal(evaluate('state.collapsed'),true);
assert.ok(!html.includes('models/designed'),'default viewer never loads damaged simplified replacements');
console.log('PASS: rail before loads, all 8 layer rows, eye toggles, 3 modes, full 104-organ set, male/female variants, sex-specific urethra, skin control, collapse, finite camera framing.');
