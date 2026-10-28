import time, json

R = []
def ok(tag, cond, detail):
    R.append(bool(cond)); print(("PASS " if cond else "FAIL ") + tag + " — " + detail)

def click(sel):
    b = js("""(function(){const e=document.querySelector(%s);if(!e)return null;const r=e.getBoundingClientRect();
      return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()""" % json.dumps(sel))
    if not b: return False
    b = json.loads(b)
    for t in ("mousePressed", "mouseReleased"):
        cmd("Input.dispatchMouseEvent", type=t, x=b["x"], y=b["y"], button="left", clickCount=1)
    time.sleep(0.8)
    return True

def click_at(x, y):
    for t in ("mousePressed", "mouseReleased"):
        cmd("Input.dispatchMouseEvent", type=t, x=x, y=y, button="left", clickCount=1)
    time.sleep(0.7)

# ---- P1 + P2, with the mouse ----
click(".row[data-layer='organs'] .eye"); time.sleep(1.6)
n1 = js("""(function(){let n=0;groups.organs.traverse(m=>{if(m.isMesh&&m.visible)n++});return n})()""")
out1 = js("JSON.stringify([...state.out])")
ok("P1 set holds every organ", n1 >= 138, "%s visible meshes after one click, out=%s" % (n1, out1))
click(".row[data-layer='organs'] .eye"); time.sleep(1.6)
out2 = js("JSON.stringify([...state.out])")
ok("P2 the same eye closes it again", out2 == "[]", "out after second click = %s" % out2)

# ---- P3, with the mouse ----
click(".row[data-layer='organs']"); time.sleep(1.8)
btn = js("[...document.querySelectorAll('#npActs button')].map(b=>b.textContent.trim()).join('|')")
click("#npActs button"); time.sleep(3.6)
per = js("""(function(){const out=[];
organNodes.forEach(o=>{let n=0;o.node.traverse(m=>{if(m.isMesh&&m.name&&!m.userData.ball&&!m.userData.cloudLayer&&!m.userData.setMarker)n++});out.push(o.key+'='+n)});
return out.join(',')})()""")
drawn = sum(int(x.split("=")[1]) for x in per.split(",") if "=" in x)
ok("P3 split draws every system", "=0" not in per and drawn == 138, "%s (panel: %s)" % (per, btn))

# ---- P4, with the mouse ----
js("""(function(){const r=[...document.querySelectorAll('#rows .row[data-organ]')].find(x=>x.querySelector('.nm').textContent.trim()==='heart');if(r)r.querySelector('.eye').click()})()""")
time.sleep(2.2)
g = js("""(function(){let c=0;if(organGhost)organGhost.children.forEach(m=>{if(m.visible&&!m.userData.setMarker)c++});
return JSON.stringify({on:organGhost?organGhost.visible:null,copies:c})})()""")
ok("P4 transparent set is on screen", '"on":true' in g and '"copies":138' in g, g)

# ---- I1, with the mouse ----
tl = json.loads(js("(function(){const r=document.getElementById('tl').getBoundingClientRect();return JSON.stringify({x:r.left,y:r.top,w:r.width})})()"))
click_at(tl["x"] + tl["w"] * 0.35, tl["y"] + 30); d1 = js("state.date")
click_at(tl["x"] + tl["w"] * 0.70, tl["y"] + 30); d2 = js("state.date")
ok("I1 ruler picks a date anywhere", bool(d1) and bool(d2) and d1 != d2, "35%%→%s, 70%%→%s" % (d1, d2))

# ---- I2, with the mouse ----
sect = json.loads(js("(function(){return JSON.stringify([...document.querySelectorAll('#rows .sect')].map(e=>{const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,t:e.textContent.trim()}}))})()"))
b0 = js("document.querySelectorAll('#rows .row').length")
click_at(sect[0]["x"], sect[0]["y"]); b1 = js("document.querySelectorAll('#rows .row').length")
click_at(sect[0]["x"], sect[0]["y"]); b2 = js("document.querySelectorAll('#rows .row').length")
click_at(sect[1]["x"], sect[1]["y"]); b3 = js("document.querySelectorAll('#rows .row').length")
ok("I2 two sections, both fold", b1 < b0 and b2 == b0 and b3 < b2, "rows %s→%s→%s→%s, sections %s" % (b0, b1, b2, b3, [s["t"] for s in sect]))

print("RESULT:", sum(1 for x in R if x), "/", len(R))
