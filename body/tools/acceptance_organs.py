import time, json

def click(sel):
    b = js("""(function(){const e=document.querySelector(%s);if(!e)return null;const r=e.getBoundingClientRect();
      return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()""" % json.dumps(sel))
    if not b: print("  no", sel); return False
    b = json.loads(b)
    for t in ("mousePressed", "mouseReleased"):
        cmd("Input.dispatchMouseEvent", type=t, x=b["x"], y=b["y"], button="left", clickCount=1)
    time.sleep(0.8)
    return True

def s(tag):
    v = js("""(function(){let c=0,op=[];if(organGhost)organGhost.children.forEach(m=>{if(m.visible&&!m.userData.setMarker){c++;if(op.length<1)op.push(m.material.opacity)}});
      let an=0;ANALYSES.forEach(a=>{if(a.node&&a.node.visible)an++});
      return JSON.stringify({out:[...state.out],nodes:organNodes.length,solid:groups.organs.visible,ghost:organGhost?organGhost.visible:null,copies:c,op:op[0],analyses:an})})()""")
    print(tag, v); return json.loads(v)

click(".row[data-layer='organs']"); time.sleep(1.6)
click("#npActs button"); time.sleep(3.4)
a = s("split all:")
ok5 = a["ghost"] is True and a["copies"] >= 130
print("P5 copies:", ok5)
ok6 = a["analyses"] == 5
print("P6 analyses visible:", ok6)

# P7: select the heart node and check the camera target against the node's box centre
js("select('circulatory')"); time.sleep(2.0)
t = js("""(function(){const o=objectForSel('circulatory');const b=new THREE.Box3().setFromObject(o);const c=b.getCenter(new THREE.Vector3());
return JSON.stringify({d:+controls.target.distanceTo(c).toFixed(3), cam:+camera.position.distanceTo(controls.target).toFixed(2)})})()""")
print("P7 camera on node:", t)

# P8: the organs eye after the split
js("select(null)"); time.sleep(0.8)
before = js("JSON.stringify([...state.out])")
click(".row[data-layer='organs'] .eye"); time.sleep(2.0)
after = js("JSON.stringify({out:[...state.out],nodes:organNodes.length,solid:groups.organs.visible})")
print("P8 organs eye: before", before, "after", after)

# I3: cursor on the strip
print("I3 cursor:", js("getComputedStyle(document.getElementById('tl')).cursor"))
