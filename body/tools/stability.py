import time, json

def snap():
    return js("""(function(){
      const inner=groups.organs.userData.inner;
      const inSet=m=>{for(let q=m;q;q=q.parent)if(q===inner)return true;return false};
      let outN=0, dup=0;
      const outSet=new Set();
      organParts.forEach(p=>{ if(!inSet(p.mesh)) outSet.add(meshKey(p.mesh.name)); });
      let ghostVis=0, ghostDup=0;
      if(organGhost) organGhost.children.forEach(m=>{if(m.visible){ghostVis++; if(outSet.has(m.userData.ghostKey)) ghostDup++}});
      return JSON.stringify({nodes:organNodes.length, keys:organNodes.map(o=>o.key), solid:groups.organs.visible,
        ghost:(organGhost&&organGhost.visible)?ghostVis:0, dup:ghostDup});
    })()""")

def organ_row(label):
    return js("""(function(){const r=[...document.querySelectorAll('#rows .row[data-organ]')].find(x=>x.querySelector('.nm').textContent.trim()===LABEL);
      if(!r) return 'missing'; r.querySelector('.eye').click(); return r.dataset.organ})()""".replace("LABEL", json.dumps(label)))

def expect(tag, want):
    s = json.loads(snap())
    ok = (s["nodes"] == want["nodes"] and s["solid"] == want["solid"] and s["ghost"] == want["ghost"] and s["dup"] == 0)
    print(("PASS " if ok else "FAIL ") + tag + " -> " + json.dumps(s))
    return ok

fails = 0
js("document.querySelector('.row[data-layer=\"organs\"]').click()"); time.sleep(1.2)
for i in range(10):
    organ_row("heart");  time.sleep(1.3);  fails += 0 if expect("heart out #%d" % i, {"nodes":1,"solid":False,"ghost":121}) else 1
    organ_row("heart");  time.sleep(1.2);  fails += 0 if expect("heart in  #%d" % i, {"nodes":0,"solid":True,"ghost":0}) else 1
    organ_row("airway · lungs"); time.sleep(1.3); fails += 0 if expect("lungs out #%d" % i, {"nodes":1,"solid":False,"ghost":102}) else 1
    organ_row("airway · lungs"); time.sleep(1.2); fails += 0 if expect("lungs in  #%d" % i, {"nodes":0,"solid":True,"ghost":0}) else 1
organ_row("heart"); organ_row("airway · lungs"); time.sleep(1.8)
fails += 0 if expect("heart+lungs out", {"nodes":2,"solid":False,"ghost":85}) else 1
organ_row("heart"); organ_row("airway · lungs"); time.sleep(1.8)
fails += 0 if expect("both back in", {"nodes":0,"solid":True,"ghost":0}) else 1
print("FAILURES:", fails)
