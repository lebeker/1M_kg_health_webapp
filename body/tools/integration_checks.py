# Executed by browser_qa.py with its live CDP session and helpers.
report={}
def check(name,expr):
 value=js(expr)
 if not value:raise AssertionError(name)
 report[name]=True;print('PASS',name,flush=True)
check('heart has 9 3D nodes and 8 labelled edges',"document.querySelectorAll('.const-node').length===9 && document.querySelectorAll('.edge-label').length===8")
js("document.querySelector('[data-node=hypertension]').click()")
check('node opens details',"document.querySelector('#detail h2').textContent==='Hypertension'")
js("document.querySelector('#back-root').click();document.querySelector('#add').click();document.querySelector('#node-label').value='Lipid profile QA';document.querySelector('#node-type').value='analysis';document.querySelector('#node-type').dispatchEvent(new Event('change'));document.querySelector('#node-note').value='A note for the next specialist';document.querySelector('#node-form').requestSubmit()")
time.sleep(.25)
check('create and attach through editor',"window.__health.graph.nodes.some(n=>n.label==='Lipid profile QA') && document.querySelectorAll('.const-node').length===10 && !document.querySelector('#editor').open")
created=js("window.__health.graph.nodes.find(n=>n.label==='Lipid profile QA').id")
check('new node details show saved note',"document.querySelector('#detail-content').textContent.includes('A note for the next specialist')")
cmd('Page.reload')
for _ in range(100):
 if js('window.__ready?.()'):break
 time.sleep(.1)
time.sleep(.4)
check('reload preserves graph and increments organ badge',"window.__health.graph.nodes.some(n=>n.label==='Lipid profile QA') && document.querySelector('[data-organ=heart] b').textContent==='9'")
js("window.__openOrgan('kidney-left');document.querySelector('#add').click();document.querySelector('#existing-node').value="+json.dumps(created)+";document.querySelector('#edge-kind').value='measured-by';document.querySelector('#connect-existing').click()")
time.sleep(.2)
check('same analysis can attach to another organ',"window.__health.graph.edges.some(e=>e.from==='kidney-left'&&e.to==="+json.dumps(created)+") && document.querySelectorAll('.const-node').length===2")
js("document.querySelector('[data-node=\""+created+"\"]').click();document.querySelector('#delete-node').click()")
time.sleep(.2)
check('delete cascades across organ links',"!window.__health.graph.nodes.some(n=>n.id==="+json.dumps(created)+") && !window.__health.graph.edges.some(e=>e.to==="+json.dumps(created)+"||e.from==="+json.dumps(created)+")")
js("window.__closeOrgan();window.__setSex('female')")
check('female prop swaps reproductive count',"window.__health.state.sex==='female' && document.querySelector('[data-layer=reproductive] .cnt').textContent==='8'")
js("window.__setSex('male');window.__toggle('organs')")
check('layer eye hides organ labels',"!document.querySelector('.organ-tag')")
js("window.__toggle('organs');document.querySelector('#organ-search').value='stomach';document.querySelector('#organ-search').dispatchEvent(new Event('input'));document.querySelector('#search-results button').click()")
check('search opens a separate organ constellation',"window.__health.state.root==='stomach' && document.querySelector('#detail h2').textContent==='Stomach'")
check('every mesh has a graph ID',"window.__health.organs().length===41 && window.__health.organs().every(o=>o.node)")
js("window.__closeOrgan();window.__setMode('spread');document.querySelector('#toast').classList.remove('show')");time.sleep(.8);shot('final-spread')
js("window.__setMode('body')");time.sleep(.7)
# Time 240 requestAnimationFrame intervals, after the layout has settled.
report['performance']=js("""new Promise(resolve=>{let frames=[],previous;function sample(t){if(previous!==undefined)frames.push(t-previous);previous=t;if(frames.length<240)requestAnimationFrame(sample);else{let sorted=[...frames].sort((a,b)=>a-b);resolve({fps:1000/(frames.reduce((a,b)=>a+b,0)/frames.length),p95FrameMs:sorted[Math.floor(sorted.length*.95)],frames:frames.length,...window.__health.metrics()});}}requestAnimationFrame(sample);})""")
report['pageBytes']=js("performance.getEntriesByType('resource').reduce((s,r)=>s+r.decodedBodySize,0)+performance.getEntriesByType('navigation')[0].decodedBodySize")
check('page weight below 8 MB',str(report['pageBytes'])+'<8000000')
# Verify caller-supplied graph, organ IDs, document notes, and sex defaults in a fresh document.
embedded={'schema':'kg/1','meta':{'props':{'sex':{'type':'enum','values':['female','male'],'default':'female'}}},'nodes':[{'id':'custom-heart','type':'organ','label':'Heart','props':{'mesh':'heart'}},{'id':'custom-analysis','type':'analysis','label':'Custom ECG','props':{'mesh':'ecg'}}],'edges':[{'from':'custom-heart','to':'custom-analysis','kind':'measured-by','power':1}]}
injection="""(()=>{let observer=new MutationObserver(()=>{if(!document.head)return;const s=document.createElement('script');s.id='kg-graph';s.type='application/json';s.textContent=GRAPH;document.head.append(s);const d=document.createElement('script');d.id='kg-docs';d.type='application/json';d.textContent=JSON.stringify([{nodeId:'custom-analysis',title:'ECG note',text:'Imported document'}]);document.head.append(d);observer.disconnect();});observer.observe(document,{childList:true,subtree:true});})()""".replace('GRAPH',json.dumps(json.dumps(embedded)))
identifier=cmd('Page.addScriptToEvaluateOnNewDocument',source=injection)['identifier'];cmd('Page.reload')
for _ in range(100):
 if js('window.__ready?.()'):break
 time.sleep(.1)
check('embedded graph replaces fixture and supplies sex',"window.__health.graph.nodes.length===2 && window.__health.state.sex==='female' && document.querySelector('[data-organ=heart] b').textContent==='1'")
js("document.querySelector('[data-organ=heart]').click();document.querySelector('[data-node=custom-analysis]').click()")
check('embedded IDs and kg-docs open correctly',"window.__health.state.root==='custom-heart' && document.querySelector('#detail-content').textContent.includes('Imported document')")
cmd('Page.removeScriptToEvaluateOnNewDocument',identifier=identifier);cmd('Page.reload')
for _ in range(100):
 if js('window.__ready?.()'):break
 time.sleep(.1)
# Final screenshots of the clean demonstration graph, after all test edits are deleted.
time.sleep(.6);shot('final-body');js("window.__setMode('out','organs')");time.sleep(.8);shot('final-layer');js("window.__openOrgan('heart')");time.sleep(.4);shot('final-heart')
report['consoleErrors']=errors
assert not errors,errors
print('VALIDATION',json.dumps(report),flush=True)
open(os.path.join(ROOT,'shots','validation.json'),'w').write(json.dumps(report,indent=2))
