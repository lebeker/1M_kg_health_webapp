import { fixture } from './fixture.js';

const clone = value => JSON.parse(JSON.stringify(value));
let graph, key;
const listeners = new Set();
function validate(g) {
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) throw new Error('Expected a kg/1 graph with nodes and edges.');
  const ids=new Set();
  for(const n of g.nodes) {
    if(typeof n.id!=='string'||!n.id||ids.has(n.id)) throw new Error('Graph node IDs must be unique strings.');
    ids.add(n.id);
  }
  for(const e of g.edges) if(!ids.has(e.from)||!ids.has(e.to)) throw new Error('An edge refers to a missing node.');
  return g;
}
export async function initStore(anchors=[]) {
  if(graph) return getGraph();
  const script=document.getElementById('kg-graph');
  const embedded=script && script.textContent.trim() && script.textContent.trim()!=='__KG_GRAPH__';
  let source=embedded?JSON.parse(script.textContent):clone(fixture);
  if(!embedded) {
    const ids=new Set(source.nodes.map(n=>n.id));
    for(const n of anchors) if(!ids.has(n.id)) { source.nodes.push(n); ids.add(n.id); }
    source.edges=source.edges.filter(e=>ids.has(e.from)&&ids.has(e.to));
  }
  validate(source);
  // Each embedded source has its own persisted namespace.
  let hash=2166136261;
  for(const c of JSON.stringify(source)) hash=Math.imul(hash^c.charCodeAt(0),16777619);
  key=`health-map:kg1:v1:${embedded?(hash>>>0).toString(16):'demo'}`;
  const saved=localStorage.getItem(key);
  if(saved) { try { graph=validate(JSON.parse(saved)); } catch { graph=clone(source); } }
  else graph=clone(source);
  return getGraph();
}
export async function getGraph() { return clone(graph); }
export async function listNodes() { return clone(graph.nodes); }
export async function listEdges() { return clone(graph.edges); }
function commit(next) {
  validate(next);
  localStorage.setItem(key,JSON.stringify(next)); // Fail visibly; never claim an unsaved edit succeeded.
  graph=next;
  for(const listener of listeners) listener();
}
export function subscribe(listener) { listeners.add(listener); return ()=>listeners.delete(listener); }
export async function addNode(input) {
  const node={id:input.id||`node-${crypto.randomUUID()}`,type:input.type||'condition',label:input.label?.trim(),level:input.level??1,weight:input.weight??1,props:clone(input.props||{})};
  if(!node.label) throw new Error('Give the node a name.');
  if(graph.nodes.some(n=>n.id===node.id)) throw new Error('That node ID already exists.');
  const next=clone(graph); next.nodes.push(node); commit(next); return clone(node);
}
export async function addEdge(input) {
  const edge={from:input.from,to:input.to,kind:input.kind||'has-part',power:input.power??1};
  if(edge.from===edge.to) throw new Error('Choose two different nodes.');
  if(graph.edges.some(e=>e.from===edge.from&&e.to===edge.to&&e.kind===edge.kind)) return clone(edge);
  const next=clone(graph); next.edges.push(edge); commit(next); return clone(edge);
}
export async function removeNode(id) {
  const next=clone(graph); next.nodes=next.nodes.filter(n=>n.id!==id); next.edges=next.edges.filter(e=>e.from!==id&&e.to!==id); commit(next);
}
export async function removeEdge(edge) {
  const next=clone(graph); next.edges=next.edges.filter(e=>!(e.from===edge.from&&e.to===edge.to&&e.kind===edge.kind)); commit(next);
}
// A single commit makes create-and-attach atomic even if storage is full.
export async function addConnectedNode(input,from,kind) {
  const node={id:`node-${crypto.randomUUID()}`,type:input.type||'condition',label:input.label?.trim(),level:1,weight:1,props:clone(input.props||{})};
  if(!node.label) throw new Error('Give the node a name.');
  const next=clone(graph); next.nodes.push(node); next.edges.push({from,to:node.id,kind,power:1}); commit(next); return clone(node);
}
