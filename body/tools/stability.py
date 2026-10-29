import time, json

def snap():
    time.sleep(0.35)          # one frame must pass: the rule is applied in the loop
    return js("""(function(){
      const inner=groups.organs.userData.inner;
      const inSet=m=>{for(let q=m;q;q=q.parent)if(q===inner)return true;return false};
      const outSet=new Set();
      organParts.forEach(p=>{ if(!inSet(p.mesh)) outSet.add(meshKey(p.mesh.name)); });
      let ghostVis=0, ghostDup=0;
      if(organGhost) organGhost.children.forEach(m=>{if(m.visible){ghostVis++; if(outSet.has(m.userData.ghostKey) && m.material && m.material.opacity > 0.2) ghostDup++  // a faint copy is the set, not a second organ}});
      return JSON.stringify({nodes:organNodes.length, keys:organNodes.map(o=>o.key), solid:groups.organs.visible,
        ghost:(organGhost&&organGhost.visible)?ghostVis:0, dup:ghostDup});
    })()""")

def click_eye(label):
    """click a row's eye; the legend rebuilds on every toggle, so re-find and retry once"""
    for _ in range(2):
        r = js("""(function(){const r=[...document.querySelectorAll('#rows .row[data-organ]')].find(x=>x.querySelector('.nm').textContent.trim()===LABEL);
          if(!r) return 'missing'; r.querySelector('.eye').click(); return r.dataset.organ})()""".replace("LABEL", json.dumps(label)))
        if r == "missing":
            time.sleep(0.6); continue
        time.sleep(0.9)
        return r
    return "missing"

def wait_for(nodes, tries=30):
    for _ in range(tries):
        s = json.loads(snap())
        if s["nodes"] == nodes:
            return s
        time.sleep(0.2)
    return json.loads(snap())

def expect(tag, want):
    s = wait_for(want["nodes"])
    ok = (s["nodes"] == want["nodes"] and s["solid"] == want["solid"] and s["ghost"] == want["ghost"] and s["dup"] == 0)
    print(("PASS " if ok else "FAIL ") + tag + " -> " + json.dumps(s))
    return 0 if ok else 1

fails = 0
js("document.querySelector('.row[data-layer=\"organs\"]').click()"); time.sleep(1.4)
for i in range(10):
    click_eye("heart");          fails += expect("heart out #%d" % i, {"nodes":1,"solid":False,"ghost":121})
    click_eye("heart");          fails += expect("heart in  #%d" % i, {"nodes":0,"solid":True,"ghost":0})
    click_eye("airway · lungs"); fails += expect("lungs out #%d" % i, {"nodes":1,"solid":False,"ghost":102})
    click_eye("airway · lungs"); fails += expect("lungs in  #%d" % i, {"nodes":0,"solid":True,"ghost":0})
click_eye("heart"); click_eye("airway · lungs"); fails += expect("heart+lungs out", {"nodes":2,"solid":False,"ghost":85})
click_eye("heart"); click_eye("airway · lungs"); fails += expect("both back in", {"nodes":0,"solid":True,"ghost":0})
print("FAILURES:", fails)
