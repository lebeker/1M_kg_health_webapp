import * as store from './store.js';
const T=window.THREE, $=s=>document.querySelector(s);
const layerDefs=[
 ['skin','Body surface','#a4b1a5','surface'],['muscles','Muscular','#b67861','muscles'],['bones','Skeletal','#c3b692','bones'],
 ['cardio','Cardiovascular','#b65d48','cardio'],['nervous','Nervous','#c5a25d','nervous'],['lymphoid','Lymphatic','#799e81','lymphoid'],['organs','Internal organs','#9c7f8c','organs'],['reproductive','Reproductive','#af8b9d',null]
];
const state={mode:'body',pull:'organs',sex:'male',hidden:new Set(),root:null,selected:null,hover:null};
const groups={},targets={},templates=new Map(),organMeshes=[],tagElements=[],graphObjects=[],spreadLabels=[];
let graph,anchors=[],ready=false,sceneGraph=null,previewRenderer=null,previewObject=null,docs={},frameCount=0;
const stage=$('#stage'),labels=$('#labels');
const renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputEncoding=T.sRGBEncoding;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;renderer.setClearColor(0,0);
stage.prepend(renderer.domElement);
const scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.01,30);camera.position.set(.12,.06,4);
const controls=new T.OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.12;controls.enablePan=false;controls.minZoom=.65;controls.maxZoom=3;controls.minPolarAngle=.2;controls.maxPolarAngle=Math.PI-.2;
scene.add(new T.HemisphereLight(0xfff9e9,0x73826f,.7));
function light(color,power,x,y,z){const l=new T.DirectionalLight(color,power);l.position.set(x,y,z);scene.add(l)}
light(0xfff4e5,1.55,-2,3,4);light(0xd2e9dd,.4,3,1,2);light(0xffffff,1.0,-1,2,-3);
const body=new T.Group();body.position.y=-.865;scene.add(body);
const shadowCanvas=document.createElement('canvas');shadowCanvas.width=128;shadowCanvas.height=128;
const ctx=shadowCanvas.getContext('2d'),gradient=ctx.createRadialGradient(64,64,1,64,64,64);gradient.addColorStop(0,'rgba(55,73,52,.20)');gradient.addColorStop(1,'rgba(55,73,52,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
const shadow=new T.Mesh(new T.PlaneGeometry(.75,.25),new T.MeshBasicMaterial({map:new T.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));shadow.position.set(0,-.88,-.12);scene.add(shadow);
const loader=new T.GLTFLoader();
const load=file=>new Promise((resolve,reject)=>loader.load(`models/designed/${file}.glb`,g=>resolve(g.scene),undefined,reject));
const organColors={'heart':'#b75339','lung-left':'#739b8d','lung-right':'#739b8d','liver':'#9d6246','stomach':'#c58861','intestine':'#c6a17a','colon':'#a8835e','kidney-left':'#9f5e60','kidney-right':'#9f5e60','pancreas':'#c5a052','thyroid':'#af7b88','spleen':'#8d6a86','eye-left':'#7b9e9d','eye-right':'#7b9e9d'};
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),3200)}
function node(id){return graph.nodes.find(n=>n.id===id)}
function links(id){return graph.edges.filter(e=>e.from===id||e.to===id)}
function related(id){return [...new Set(links(id).map(e=>e.from===id?e.to:e.from))].map(node).filter(Boolean)}
function anchorFor(mesh){return graph.nodes.find(n=>n.props?.mesh===mesh&&n.type==='organ')||graph.nodes.find(n=>n.id===mesh)||graph.nodes.find(n=>n.label?.toLowerCase()===anchors.find(a=>a.id===mesh)?.label.toLowerCase())}
function material(color,opacity=1){const c=new T.Color(color);if(typeof color!=='object')c.convertSRGBToLinear();return new T.MeshStandardMaterial({color:c,roughness:.57,metalness:.015,transparent:opacity<1,opacity,depthWrite:opacity===1,side:T.DoubleSide})}
function makeTemplate(mesh){
 mesh.updateWorldMatrix(true,false);
 const geometry=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),box=new T.Box3().setFromBufferAttribute(geometry.attributes.position),size=box.getSize(new T.Vector3()),c=box.getCenter(new T.Vector3());
 geometry.translate(-c.x,-c.y,-c.z);geometry.scale(1/Math.max(size.x,size.y,size.z),1/Math.max(size.x,size.y,size.z),1/Math.max(size.x,size.y,size.z));
 const m=new T.Mesh(geometry,mesh.material.clone());m.rotation.y=-.18;
 const group=new T.Group();group.add(m);return group;
}
function claySkin(m){
 m.transparent=true;m.depthWrite=false;m.side=T.FrontSide;
 m.onBeforeCompile=shader=>{
  shader.uniforms.cutaway={value:1};m.userData.shader=shader;
  shader.vertexShader='varying vec3 vSculptPosition;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvSculptPosition=position;');
  shader.fragmentShader='varying vec3 vSculptPosition;\nuniform float cutaway;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`float windowShape=length(vec2(vSculptPosition.x/.168,(vSculptPosition.y-1.16)/.35));
  float shellOpacity=mix(.035,1.,smoothstep(.77,1.06,windowShape));
  diffuseColor.a *= mix(1.,shellOpacity,cutaway);\n#include <alphatest_fragment>`);
 };
 m.customProgramCacheKey=()=> 'forma-cutaway-v1';
}
async function boot(){
 try {
  anchors=await fetch('models/designed/organs.json').then(r=>{if(!r.ok)throw new Error('Organ manifest unavailable.');return r.json()});
  graph=await store.initStore(anchors);
  const docScript=$('#kg-docs');if(docScript?.textContent.trim()&&!docScript.textContent.includes('__KG_DOCS__')) docs=JSON.parse(docScript.textContent);
  const sexProp=graph.meta?.props?.sex;
  if(sexProp){state.sex=sexProp.default||'male';$('#sex').innerHTML=(sexProp.values||['female','male']).filter(s=>['female','male'].includes(s)).map(s=>`<button data-sex="${s}" class="${s===state.sex?'on':''}">${s==='female'?'Female':'Male'}</button>`).join('')}
  await Promise.all(layerDefs.filter(l=>l[3]).map(async([id,name,color,file])=>{
   const root=await load(file);root.name=id;groups[id]=root;body.add(root);targets[id]=new T.Vector3();
   root.traverse(o=>{if(!o.isMesh)return;o.material=material(id==='organs'?(organColors[o.name]||'#a18070'):color);if(id==='skin'){claySkin(o.material);o.renderOrder=10;}
    if(id==='organs'){const a=anchors.find(a=>a.id===o.name);o.userData.meshId=o.name;o.userData.anchor=a;organMeshes.push(o);templates.set(o.name,makeTemplate(o));}
   });
  }));
  const objectLibrary=await load('objects');objectLibrary.traverse(o=>{if(o.isMesh){o.material=material('#b75339');templates.set(o.name,makeTemplate(o));}});
  const reproductive=new T.Group();groups.reproductive=reproductive;body.add(reproductive);targets.reproductive=new T.Vector3();
  for(const sex of ['male','female']){const g=await load('reproductive-'+sex);g.userData.sex=sex;reproductive.add(g);g.traverse(o=>{if(!o.isMesh)return;o.material=material('#af8b9d');o.userData.meshId=o.name;o.userData.sex=sex;organMeshes.push(o);templates.set(o.name,makeTemplate(o));})}
  templates.set('person',makeTemplate(groups.skin.children.find(o=>o.isMesh)));
  buildObjects();buildLegend();applySex();layout(true);renderOverview();updateSearch();
  store.subscribe(async()=>{graph=await store.getGraph();buildLegend();updateSearch();if(state.root&&!node(state.root)){closeConstellation();return}if(state.root)buildConstellation();if(state.selected&&node(state.selected))showDetails(state.selected);else if(state.root)showDetails(state.root);else renderOverview();$('#save-status').innerHTML='<span class="local-dot"></span> Saved on this device';});
  $('#loading').remove();ready=true;
 } catch(error){$('#loading').textContent='Could not open this map: '+error.message;console.error(error)}
}
function buildObjects(){
 const capsule=new T.Group();
 for(let i=0;i<2;i++){
  const pts=[new T.Vector2(0,-.42),new T.Vector2(.19,-.42),new T.Vector2(.28,-.33),new T.Vector2(.29,0)];
  const g=new T.LatheGeometry(pts,28);const m=new T.Mesh(g,material(i?'#ddc397':'#789688'));if(i)m.rotation.z=Math.PI;capsule.add(m);
 }
 capsule.rotation.z=-.55;templates.set('capsule',capsule);
 const ecg=new T.Group();const s=new T.Shape();s.moveTo(-.49,-.3);s.lineTo(.49,-.3);s.quadraticCurveTo(.55,-.3,.55,-.23);s.lineTo(.55,.31);s.quadraticCurveTo(.55,.37,.48,.37);s.lineTo(-.48,.37);s.quadraticCurveTo(-.55,.37,-.55,.3);s.lineTo(-.55,-.23);s.quadraticCurveTo(-.55,-.3,-.49,-.3);
 const screen=new T.Mesh(new T.ExtrudeGeometry(s,{depth:.1,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.035,bevelThickness:.025}),material('#819c8a'));ecg.add(screen);
 const p=[[-.43,0],[-.2,0],[-.14,.07],[-.06,-.12],[.03,.25],[.1,-.11],[.17,0],[.43,0]].map(([x,y])=>new T.Vector3(x,y,.15));
 const line=new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(p),60,.012,5,false),material('#ecebd7'));ecg.add(line);ecg.rotation.y=-.25;templates.set('ecg',ecg);
}
const eyeOpen='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.15"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="10" cy="10" r="2.2"/></svg>';
const eyeClosed='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.15"><path d="m3 3 14 14M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/></svg>';
function buildLegend(){
 $('#rows').innerHTML=layerDefs.map(([id,name,color])=>{
  const count=id==='organs'?anchors.filter(a=>!a.props.sex).length:id==='reproductive'?anchors.filter(a=>a.props.sex===state.sex).length:'01';
  return `<div class="row ${state.hidden.has(id)?'off':''} ${state.mode==='out'&&state.pull===id?'selected':''}" data-layer="${id}" role="button" tabindex="0" aria-label="Focus ${name}"><span class="dot" style="background:${color}"></span><span class="nm">${name}</span><span class="cnt">${count}</span><button class="eye" aria-label="${state.hidden.has(id)?'Show':'Hide'} ${name}" aria-pressed="${!state.hidden.has(id)}">${state.hidden.has(id)?eyeClosed:eyeOpen}</button></div>`;
 }).join('');
 $('#layer-count').textContent=8-state.hidden.size;
 for(const row of $('#rows').children){row.onclick=e=>{if(e.target.closest('.eye')){toggle(row.dataset.layer);return}setMode('out',row.dataset.layer)};row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();row.click()}}}
}
function applySex(){if(groups.reproductive)for(const g of groups.reproductive.children)g.visible=g.userData.sex===state.sex;$('#sex').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.sex===state.sex));buildLegend()}
function setMode(mode,pull){if(!['body','out','spread'].includes(mode))return;if(state.root)closeConstellation();state.mode=mode;if(pull)state.pull=pull;layout(true);buildLegend();}
function toggle(id){state.hidden.has(id)?state.hidden.delete(id):state.hidden.add(id);if(state.root)closeConstellation();buildLegend();layout(true)}
function resize(){
 const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h);const aspect=w/h;
 const span=state.root?1.82:state.mode==='spread'?Math.max(2.0,5.6/aspect):1.94;
 camera.left=-span*aspect/2;camera.right=span*aspect/2;camera.top=span/2;camera.bottom=-span/2;camera.updateProjectionMatrix();
 if(state.root)positionGraph();
}
function layout(reset=false){
 if(!groups.organs)return;
 body.visible=!state.root;shadow.visible=!state.root;
 if(!state.root){
  const visible=layerDefs.filter(l=>!state.hidden.has(l[0]));
  for(const [id]of layerDefs){const g=groups[id];if(!g)continue;g.visible=!state.hidden.has(id);const index=visible.findIndex(l=>l[0]===id);
   targets[id].set(state.mode==='spread'?(index-(visible.length-1)/2)*.66:state.mode==='out'?(id===state.pull?.38:-.28):0,state.mode==='spread'?.242:0,0);
   g.scale.setScalar(state.mode==='spread'?.72:1);
   g.traverse(o=>{if(!o.isMesh)return;const m=o.material;let opacity=1;
    const isolated=state.mode==='spread'||(state.mode==='out'&&id===state.pull);
    if(!isolated){if(id==='muscles')opacity=.018;if(id==='bones')opacity=.065;if(id==='cardio')opacity=.22;if(['nervous','lymphoid'].includes(id))opacity=.14;if(id==='reproductive')opacity=.13;}
    m.opacity=opacity;m.transparent=id==='skin'||opacity<1;m.depthWrite=id!=='skin'&&opacity===1;
    if(id==='skin'&&m.userData.shader)m.userData.shader.uniforms.cutaway.value=isolated?0:1;
   });
  }
 }
 const titles={body:['ANATOMY, CONNECTED','The whole picture','01 / 03'],out:['A CLOSER LOOK',layerDefs.find(l=>l[0]===state.pull)?.[1]+' system','02 / 03'],spread:['EVERY SYSTEM, TOGETHER','Layers of you','03 / 03']};
 if(!state.root){const [k,t,n]=titles[state.mode];$('#scene-kicker').textContent=k;$('#scene-title').textContent=t;$('#view-index').textContent=n;$('#crumb').textContent='';}
 $('.modes').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.mode===state.mode));
 if(reset){camera.zoom=1;camera.position.set(state.root?0:.1,state.root?0:.03,4);controls.target.set(0,0,0);controls.enabled=!state.root;controls.update();}
 resize();if(!state.root)buildTags();
}
function project(v){const p=v.clone().project(camera);return {x:(p.x*.5+.5)*stage.clientWidth,y:(-p.y*.5+.5)*stage.clientHeight,z:p.z}}
function buildTags(){
 labels.innerHTML='';tagElements.length=0;spreadLabels.length=0;
 if(state.mode==='spread'){
  for(const[id,name]of layerDefs.filter(l=>!state.hidden.has(l[0]))){const label=document.createElement('button');label.className='layer-caption';label.textContent=name;label.onclick=()=>setMode('out',id);labels.append(label);spreadLabels.push({id,label});}
  return;
 }
 const defs=state.mode==='out'&&state.pull!=='organs'?[]:[['heart',.36,-.045],['lung-left',.29,.115],['liver',-.29,.015],['intestine',.36,-.07]];
 for(const[id,xoff,yoff]of defs){const mesh=organMeshes.find(o=>o.userData.meshId===id),n=anchorFor(id);if(!mesh||!n||state.hidden.has('organs'))continue;
  const b=document.createElement('button');b.className='organ-tag';b.dataset.organ=id;b.setAttribute('aria-label',`Open ${n.label} constellation`);b.innerHTML=`${escape(n.label)} <b>${links(n.id).length}</b>`;b.onclick=()=>openConstellation(n.id);labels.append(b);
  tagElements.push({element:b,mesh,offset:new T.Vector3(state.mode==='out'&&xoff<0?.31:xoff,state.mode==='out'&&id==='liver'?-.075:state.mode==='out'&&id==='intestine'?-.14:yoff,0)});
 }
}
function updateTags(){
 if(state.root){positionGraphLabels();return}
 for(const {id,label}of spreadLabels){const p=project(new T.Vector3(groups[id].position.x,-.75,0));label.style.left=p.x+'px';label.style.top=p.y+'px';}
 for(const t of tagElements){const p=new T.Box3().setFromObject(t.mesh).getCenter(new T.Vector3()).add(t.offset),s=project(p);t.element.style.left=s.x+'px';t.element.style.top=s.y+'px';t.element.hidden=s.z>1||s.x<10||s.x>stage.clientWidth-10;}
}
function miniature(n,size){
 const key=n.props?.mesh||n.id;let t=templates.get(key)||templates.get(n.id)||templates.get(n.type==='protocol'?'capsule':n.type==='analysis'?'ecg':n.type==='specialist'?'person':'heart');
 const obj=t.clone(true);obj.scale.setScalar(size);
 obj.traverse(o=>{if(!o.isMesh)return;o.material=material(n.type==='condition'?'#b87752':n.type==='analysis'?'#6c998a':n.type==='part'?'#bd886e':o.material.color);});return obj;
}
function disposeGroup(g){g.traverse(o=>{if(o.userData.generatedGeometry)o.geometry?.dispose();if(o.isMesh||o.isLine)o.material?.dispose()});scene.remove(g)}
function openConstellation(id){if(!node(id))return;state.root=id;state.selected=id;document.body.classList.add('constellation');$('#crumb').textContent='/ '+node(id).label;$('#scene-kicker').textContent='FOLLOW THE CONNECTIONS';$('#scene-title').textContent=node(id).label+' constellation';$('#view-index').textContent='LOCAL GRAPH';$('#orbit-hint').textContent='Select any miniature to explore its story';buildConstellation();layout(true);showDetails(id)}
function closeConstellation(){state.root=null;state.selected=null;document.body.classList.remove('constellation');if(sceneGraph){disposeGroup(sceneGraph);sceneGraph=null}graphObjects.length=0;$('#orbit-hint').innerHTML='Drag to rotate <span>·</span> Scroll to explore';layout(true);renderOverview()}
function buildConstellation(){
 if(sceneGraph)disposeGroup(sceneGraph);sceneGraph=new T.Group();scene.add(sceneGraph);graphObjects.length=0;labels.innerHTML='';
 const center=node(state.root);if(!center)return;
 const neighbours=related(center.id);
 const objects=[center,...neighbours];
 for(let i=0;i<objects.length;i++){
  const n=objects[i],root=i===0,m=miniature(n,root?.34:.17);sceneGraph.add(m);
  const b=document.createElement('button');b.className='const-node'+(root?' root':'')+(n.id===state.selected?' selected':'');b.dataset.node=n.id;b.setAttribute('aria-label',`Show ${n.label} details`);b.innerHTML=`${escape(n.label)}<small>${escape(root?'organ · '+neighbours.length+' connections':n.type)}</small>`;b.onclick=()=>showDetails(n.id);labels.append(b);
  const item={node:n,object:m,label:b,index:i};graphObjects.push(item);
  if(!root){const edge=links(center.id).find(e=>e.from===n.id||e.to===n.id);const label=document.createElement('span');label.className='edge-label';label.textContent=edge.kind;labels.append(label);item.edgeLabel=label;item.edge=edge;}
 }
 positionGraph();
 const cap=document.createElement('div');cap.className='const-caption';cap.textContent=`${neighbours.length+1} nodes · ${links(center.id).length} connections · Spatial layout carries no anatomical meaning`;labels.append(cap);
}
function positionGraph(){
 if(!sceneGraph||!graphObjects.length)return;
 const total=graphObjects.length-1,aspect=stage.clientWidth/stage.clientHeight;
 const rx=Math.min(.78,aspect*.68),ry=.64;
 for(const item of graphObjects){
  if(item.index===0)item.object.position.set(0,0,.08);
  else {const a=-Math.PI/2+(item.index-1)*Math.PI*2/total;item.object.position.set(Math.cos(a)*rx,Math.sin(a)*ry,0);}
  if(item.line){sceneGraph.remove(item.line);item.line.geometry.dispose();item.line.material.dispose()}
  if(item.index){const end=item.object.position.clone();const start=new T.Vector3(0,0,-.09);end.z=-.09;const curve=new T.CatmullRomCurve3([start,start.clone().lerp(end,.5).add(new T.Vector3(-end.y*.03,end.x*.03,0)),end]);const geo=new T.BufferGeometry().setFromPoints(curve.getPoints(32));const line=new T.Line(geo,new T.LineBasicMaterial({color:0xc5cebb,transparent:true,opacity:.9}));line.userData.generatedGeometry=true;sceneGraph.add(line);item.line=line;}
 }
 positionGraphLabels();
}
function positionGraphLabels(){for(const item of graphObjects){const s=project(item.object.position);item.label.style.left=s.x+'px';item.label.style.top=(s.y+(item.index?41:63))+'px';if(item.edgeLabel){const p=item.object.position.clone().multiplyScalar(.55);p.z=0;if(Math.abs(p.x)<.04&&p.y<0)p.x+=.08;const e=project(p);item.edgeLabel.style.left=e.x+'px';item.edgeLabel.style.top=(e.y-3)+'px';}}}
function preview(n){
 if(!previewRenderer){previewRenderer=new T.WebGLRenderer({alpha:true,antialias:true});previewRenderer.setPixelRatio(Math.min(devicePixelRatio,1.5));previewRenderer.outputEncoding=T.sRGBEncoding;previewRenderer.toneMapping=T.ACESFilmicToneMapping;previewRenderer.toneMappingExposure=.95;}
 const container=$('.preview');if(!container)return;container.append(previewRenderer.domElement);previewRenderer.setSize(container.clientWidth,container.clientHeight);
 const s=new T.Scene();s.add(new T.HemisphereLight(0xfffaee,0x71826d,.8));const l=new T.DirectionalLight(0xfff5df,1.6);l.position.set(-2,3,4);s.add(l);const rim=new T.DirectionalLight(0xd2e8df,.8);rim.position.set(2,1,-2);s.add(rim);
 if(previewObject)previewObject.traverse(o=>{if(o.isMesh)o.material.dispose()});previewObject=miniature(n,.9);previewObject.rotation.y=-.18;previewObject.rotation.z=.08;s.add(previewObject);
 const c=new T.PerspectiveCamera(32,container.clientWidth/container.clientHeight,.01,10);c.position.set(0,0,1.95);previewRenderer.render(s,c);
}
function renderOverview(){
 const heart=node('heart')||graph.nodes.find(n=>n.type==='organ')||graph.nodes[0];
 if(!heart){$('#detail-content').innerHTML='<span class="eyebrow">YOUR MAP</span><h2>A new story</h2><p class="desc">Create your first node to begin.</p><button class="primary" id="add">Create a node +</button>';$('#add').onclick=()=>openEditor();return}
 $('#detail-content').innerHTML=`<div class="section-top"><span class="eyebrow">YOUR HEALTH, CONNECTED</span><span class="small-chip">DEMO</span></div><h2>Every organ.<br>A starting point.</h2><p class="desc">The body is your map. Connections are the story beneath the surface.</p><div class="preview"></div><div class="preview-caption">FEATURED · ${escape(heart.label)}</div><div class="rule"></div><div class="metric-row"><span>In this neighbourhood</span><b>${related(heart.id).length+1} nodes</b></div><div class="metric-row"><span>Connected systems</span><b>${new Set(related(heart.id).map(n=>n.type)).size} perspectives</b></div><button class="primary" id="explore">Explore ${escape(heart.label.toLowerCase())} <span>↗</span></button><div class="rule"></div><span class="feature-label">ONE FINDING. A BIGGER PICTURE.</span><ul class="connection-list">${related(heart.id).filter(n=>['condition','analysis','specialist'].includes(n.type)).slice(0,3).map(n=>`<li><button data-jump="${escape(n.id)}"><span class="type-dot"></span>${escape(n.label)}<small>${escape(n.type)} ↗</small></button></li>`).join('')}</ul><p class="demo-note">Example connections, ready to explore.<br>Add your own findings to make this map yours.</p>`;
 $('#explore').onclick=()=>openConstellation(heart.id);$('#detail-content').querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>{openConstellation(heart.id);showDetails(b.dataset.jump)});preview(heart);
}
function showDetails(id){
 const n=node(id);if(!n)return;state.selected=id;
 for(const item of graphObjects){item.label.classList.toggle('selected',item.node.id===id);item.object.traverse(o=>{if(o.isMesh)o.material.emissive.set(item.node.id===id?'#291307':'#000000')})}
 const edges=links(id),neighbours=related(id);const documents=Array.isArray(docs)?docs:Object.values(docs||{});const attached=documents.filter(d=>d.node===id||d.nodeId===id||n.props?.docs?.includes(d.id));
 $('#detail-content').innerHTML=`${id!==state.root?'<button class="back-link" id="back-root">← Back to '+escape(node(state.root)?.label||'organ')+'</button>':''}<div class="section-top"><span class="eyebrow">${escape(n.type).toUpperCase()}</span><span class="small-chip">${n.props?.demo?'EXAMPLE':'YOUR MAP'}</span></div><h2>${escape(n.label)}</h2><p class="desc">${escape(n.props?.description||n.props?.note||'A connected record in your personal health map.')}</p><div class="preview"></div><div class="preview-caption">3D OBJECT · ${escape(n.props?.mesh||n.type)}</div><div class="rule"></div><div class="metric-row"><span>Connections</span><b>${edges.length} linked nodes</b></div><div class="metric-row"><span>Record type</span><b>${escape(n.type)}</b></div><button class="primary" id="add">Add a connection <span>+</span></button>${id!==state.root?'<button id="recenter" class="primary secondary">Explore this neighbourhood <span>↗</span></button>':''}<div class="rule"></div><span class="feature-label">CONNECTED RECORDS</span><ul class="connection-list">${neighbours.map(other=>{const e=edges.find(e=>e.from===other.id||e.to===other.id);return `<li><button data-detail="${escape(other.id)}"><span class="type-dot"></span>${escape(other.label)}<small>${escape(e.kind)} ↗</small></button></li>`}).join('')||'<li class="demo-note">No connections yet. Add the first one.</li>'}</ul>${attached.map(d=>`<div class="detail-note">${escape(d.title||d.label||'Document')}<br>${escape(d.text||d.content||'')}</div>`).join('')}${n.type!=='organ'?'<button class="delete-btn" id="delete-node">Delete this node</button>':''}<p class="demo-note">${n.props?.demo?'Demonstration record · not a patient history.':'Saved locally in this browser.'}</p>`;
 $('#add').onclick=()=>openEditor(id);if($('#back-root'))$('#back-root').onclick=()=>showDetails(state.root);if($('#recenter'))$('#recenter').onclick=()=>openConstellation(id);
 $('#detail-content').querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>showDetails(b.dataset.detail));
 if($('#delete-node'))$('#delete-node').onclick=async()=>{try{state.selected=state.root;await store.removeNode(id);toast('Node and its connections removed')}catch(e){toast(e.message)}};
 preview(n);
}
function updateSearch(){
 const query=$('#organ-search').value.trim().toLowerCase();const matches=organMeshes.map(o=>({mesh:o,n:anchorFor(o.userData.meshId)})).filter(({mesh,n})=>n&&(!mesh.userData.sex||mesh.userData.sex===state.sex)&&n.label.toLowerCase().includes(query));
 $('#search-results').innerHTML=matches.map(({n})=>`<button data-organ-id="${escape(n.id)}">${escape(n.label)} <span>${links(n.id).length} ↗</span></button>`).join('')||'<p class="demo-note">No organs found.</p>';
 $('#search-results').querySelectorAll('button').forEach(b=>b.onclick=()=>{$('#organ-search').value='';openConstellation(b.dataset.organId)});
}
function openEditor(from=state.selected||state.root){
 $('#node-form').reset();$('#form-error').textContent='';
 $('#attach-to').innerHTML=graph.nodes.map(n=>`<option value="${escape(n.id)}" ${n.id===from?'selected':''}>${escape(n.label)}</option>`).join('');
 $('#existing-node').innerHTML=graph.nodes.filter(n=>n.id!==from).map(n=>`<option value="${escape(n.id)}">${escape(n.label)}</option>`).join('');
 $('#editor').showModal();$('#node-label').focus();
}
$('#node-form').onsubmit=async e=>{e.preventDefault();try{const type=$('#node-type').value,mesh=type==='analysis'?'ecg':type==='protocol'?'capsule':type==='specialist'?'person':node(state.root)?.props?.mesh||'heart';const n=await store.addConnectedNode({label:$('#node-label').value,type,props:{description:$('#node-note').value,mesh}},$('#attach-to').value,$('#edge-kind').value);$('#editor').close();if(!state.root)openConstellation($('#attach-to').value);showDetails(n.id);toast('Node created and connected · saved on this device');}catch(error){$('#form-error').textContent=error.message}};
$('#connect-existing').onclick=async()=>{try{await store.addEdge({from:$('#attach-to').value,to:$('#existing-node').value,kind:$('#edge-kind').value});$('#editor').close();toast('Connection saved on this device')}catch(error){$('#form-error').textContent=error.message}};
$('#node-type').onchange=()=>{$('#edge-kind').value={condition:'sign-of',analysis:'measured-by',protocol:'treated-by',part:'has-part',specialist:'reviewed-by'}[$('#node-type').value]};
$('#close-editor').onclick=()=>$('#editor').close();$('#home').onclick=()=>closeConstellation();$('#profile').onclick=()=>toast('Demo profile · example graph · edits stay on this device');
$('#sex').onclick=e=>{const b=e.target.closest('[data-sex]');if(b){state.sex=b.dataset.sex;applySex();updateSearch()}};
$('.modes').onclick=e=>{const b=e.target.closest('[data-mode]');if(b)setMode(b.dataset.mode)};
$('#reset').onclick=()=>layout(true);$('#collapse').onclick=()=>{$('#legend').classList.toggle('collapsed');const collapsed=$('#legend').classList.contains('collapsed');$('#collapse').textContent=collapsed?'›':'‹';$('#collapse').setAttribute('aria-expanded',!collapsed);resize()};
$('#organ-search').oninput=updateSearch;
const pointer=new T.Vector2(),raycaster=new T.Raycaster();let pointerDown=null;
function hit(event){const r=stage.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,-((event.clientY-r.top)/r.height)*2+1);raycaster.setFromCamera(pointer,camera);const objects=organMeshes.filter(o=>{let p=o;while(p){if(!p.visible)return false;p=p.parent}return true});return raycaster.intersectObjects(objects,false)[0]?.object;}
renderer.domElement.addEventListener('pointerdown',e=>pointerDown=[e.clientX,e.clientY]);
renderer.domElement.addEventListener('pointerup',e=>{if(state.root||!pointerDown||Math.hypot(e.clientX-pointerDown[0],e.clientY-pointerDown[1])>5)return;const o=hit(e);const n=o&&anchorFor(o.userData.meshId);if(n)openConstellation(n.id)});
renderer.domElement.addEventListener('pointermove',e=>{if(state.root)return;const o=hit(e);if(state.hover&&state.hover!==o)state.hover.material.emissive.set(0);state.hover=o;if(o)o.material.emissive.set('#382017');updateHoverBadge(o,e);renderer.domElement.style.cursor=o?'pointer':'grab';renderer.domElement.title=o?(anchorFor(o.userData.meshId)?.label||'Organ'):''});
renderer.domElement.addEventListener('pointerleave',()=>{if(state.hover)state.hover.material.emissive.set(0);state.hover=null;updateHoverBadge(null)});
function updateHoverBadge(o,event){
 let badge=$('#hover-badge');
 if(!o||state.root||tagElements.some(t=>t.mesh===o)){badge?.remove();return;}
 const n=anchorFor(o.userData.meshId);if(!n)return;
 if(!badge){badge=document.createElement('button');badge.id='hover-badge';badge.className='organ-tag';badge.style.zIndex='4';labels.append(badge);}
 badge.innerHTML=`${escape(n.label)} <b>${links(n.id).length}</b>`;badge.onclick=()=>openConstellation(n.id);
 const r=stage.getBoundingClientRect();badge.style.left=Math.max(80,Math.min(r.width-80,event.clientX-r.left+65))+'px';badge.style.top=(event.clientY-r.top-25)+'px';
}
addEventListener('keydown',e=>{if(e.target.matches('input,textarea,select')||$('#editor').open)return;if(['1','2','3'].includes(e.key))setMode({1:'body',2:'out',3:'spread'}[e.key]);if(e.key==='Escape'&&state.root)closeConstellation()});
new ResizeObserver(resize).observe(stage);
const clock=new T.Clock();let totalFrameTime=0;
function tick(){requestAnimationFrame(tick);const elapsed=clock.getDelta(),dt=Math.min(.05,elapsed),a=1-Math.exp(-dt*9);for(const[id,g]of Object.entries(groups))g.position.lerp(targets[id],a);controls.update();scene.updateMatrixWorld();updateTags();renderer.render(scene,camera);frameCount++;totalFrameTime+=elapsed;}
tick();boot();
window.__ready=()=>ready;
window.__setMode=setMode;window.__setSex=s=>{state.sex=s;applySex();updateSearch()};window.__toggle=toggle;window.__openOrgan=openConstellation;window.__closeOrgan=closeConstellation;
window.__health={get graph(){return structuredClone(graph)},get state(){return{...state,hidden:[...state.hidden]}},store,metrics:()=>({drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,averageFps:frameCount/totalFrameTime}),organs:()=>organMeshes.map(o=>({mesh:o.userData.meshId,node:anchorFor(o.userData.meshId)?.id}))};
