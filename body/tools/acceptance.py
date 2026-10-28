import time, json

R = []

def ok(tag, cond, detail):
    R.append((tag, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + tag + " — " + detail)

def visible_count(root):
    return js("""(function(){let n=0;%s.traverse(m=>{if(m.isMesh&&m.visible){let p=m;let vis=true;while(p){if(!p.visible){vis=false;break}p=p.parent}if(vis)n++}});return n})()""" % root)

# ---------- P1/P2: the organs node contains every organ, nose included, straight away ----------
js("document.querySelector('.row[data-layer=\"organs\"]').click()"); time.sleep(1.4)
n = js("""(function(){const inner=groups.organs.userData.inner;let n=0,names=[];
groups.organs.traverse(m=>{if(m.isMesh&&m.visible){let p=m,vis=true;while(p){if(!p.visible){vis=false;break}p=p.parent}
if(vis){n++;if(/pharyn|nasal|nose/i.test(m.name))names.push(m.name)}}});return JSON.stringify({n:n,names:names})})()""")
d = json.loads(n)
ok("P1 organs node includes every organ", d["n"] >= 138 and len(d["names"]) >= 4, "%d meshes visible, nose: %s" % (d["n"], ", ".join(d["names"][:4])))
ok("P2 nose is there immediately after the row is clicked", any("Nasopharynx" in x for x in d["names"]), "no second action was taken")

calls = js("""(function(){const g=groups.organs;const v=g.visible;const a=renderer.info.render.calls;g.visible=false;renderer.render(scene,camera);const b=renderer.info.render.calls;g.visible=v;renderer.render(scene,camera);return a-b})()""")
ok("P1b the set actually draws", isinstance(calls,int) and calls > 0, "%s draw calls" % calls)

# ---------- P3: 'out all out' ----------
js("select('organs')"); time.sleep(0.6)
labels = js("[...document.querySelectorAll('#npActs button')].map(b=>b.textContent.trim()).join(' | ')")
btn = js("""(function(){const b=[...document.querySelectorAll('#npActs button')].find(x=>/split|all|everything/i.test(x.textContent));
if(!b) return 'none'; b.click(); return b.textContent.trim()})()""")
time.sleep(3.4)
js("select(null)"); time.sleep(2.0)
per = js("""(function(){const base=renderer.info.render.calls;const out=[];
organNodes.forEach(o=>{const v=o.node.visible;o.node.visible=false;renderer.render(scene,camera);const off=renderer.info.render.calls;o.node.visible=v;renderer.render(scene,camera);out.push(o.key+'='+(base-off))});
return out.join(',')})()""")
tot = js("""(function(){let n=0;organNodes.forEach(o=>o.node.traverse(m=>{if(m.isMesh)n++}));return n})()""")
drawn = sum(int(x.split("=")[1]) for x in per.split(",") if "=" in x)
ok("P3 'out all out' shows every organ", "=0" not in per and drawn == 138, "button '%s', %s, %s organ meshes drawn" % (btn, per, drawn))

# ---------- P4: the centre node ----------
ghost = js("""(function(){if(!organGhost)return JSON.stringify({none:true});let vis=0;organGhost.children.forEach(m=>{if(m.visible)vis++});
const b=new THREE.Box3().setFromObject(organGhost);const s=b.getSize(new THREE.Vector3());
return JSON.stringify({visible:organGhost.visible,copies:vis,size:+s.length().toFixed(2),marker:!!organGhost.children.find(x=>x.userData.setMarker&&x.visible)})})()""")
g = json.loads(ghost)
ok("P4 centre node is on screen when split", g.get("visible") is True and (g.get("copies", 0) > 0 or g.get("marker")), str(g))

# ---------- I1: the timeline scrubs anywhere ----------
dates = []
for frac in (0.08, 0.5, 0.92):
    d = js("""(function(){const T=document.getElementById('tlTrack');const r=T.getBoundingClientRect();
    T.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width*%s,clientY:r.top+30,bubbles:true}));return state.date})()""" % frac)
    dates.append(d)
ok("I1 ruler picks a date anywhere", len(set([x for x in dates if x])) == 3, "8%%→%s, 50%%→%s, 92%%→%s" % tuple(dates))

# ---------- I2: two collapsible sections ----------
s2 = js("""(function(){const s=[...document.querySelectorAll('#rows .sect')];return s.map(x=>x.textContent.trim()).join(',')})()""")
before = js("document.querySelectorAll('#rows .row').length")
js("""(function(){const s=[...document.querySelectorAll('#rows .sect')];s[0].click()})()"""); time.sleep(0.5)
mid = js("document.querySelectorAll('#rows .row').length")
js("""(function(){const s=[...document.querySelectorAll('#rows .sect')];s[0].click()})()"""); time.sleep(0.5)
after = js("document.querySelectorAll('#rows .row').length")
js("""(function(){const s=[...document.querySelectorAll('#rows .sect')];s[1].click()})()"""); time.sleep(0.5)
after2 = js("document.querySelectorAll('#rows .row').length")
ok("I2 two sections, both collapse", s2.count(",") >= 1 and mid < before and after == before and after2 < after,
   "sections [%s]; layers rows %s→%s→%s; analyses rows →%s" % (s2, before, mid, after, after2))

print("RESULT:", sum(1 for _, c, _ in R if c), "/", len(R))
