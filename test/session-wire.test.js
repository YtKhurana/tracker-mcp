import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTrackerMcpServer } from '../dist/server.js';
test('MCP session schemas remain useful and invalid calls are JSON errors without Java',async()=>{
  let requests=0;
  const server=createTrackerMcpServer({request:async()=>{requests++;return {ok:true};},close:async()=>{},snapshot:()=>null});
  const client=new Client({name:'schema-test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  try {
    const {tools}=await client.listTools();
    const open=tools.find(t=>t.name==='session_open').inputSchema;
    assert.equal(open.properties.path.type,'string'); assert.ok(open.required.includes('path'));
    assert.equal(open.properties.timeout_ms.type,'integer'); assert.equal(open.properties.timeout_ms.maximum,120000); assert.equal(open.properties.timeout_ms.default,60000);
    const control=tools.find(t=>t.name==='session_control').inputSchema;
    assert.deepEqual(control.properties.action.enum,['status','save','close']); assert.equal(control.properties.session_id.format,'uuid');
    for (const [name,args] of [['session_open',{path:'relative.mp4'}],['session_open',{path:2}],['session_open',{}],['session_open',{path:'/a.mp4',timeout_ms:false}],['session_control',{session_id:'invalid',action:'close'}]]) {
      const result=await client.callTool({name,arguments:args});
      assert.equal(result.isError,true);
      assert.equal(JSON.parse(result.content[0].text).error.code,'INVALID_ARGUMENT');
    }
    assert.equal(requests,0);
    const coords=tools.find(t=>t.name==='coords_set').inputSchema;
    assert.equal(coords.properties.scale.minimum,1e-9);
    assert.equal(tools.find(t=>t.name==='mark_set').inputSchema.properties.marks.type,'array');
    for(const [name,args,code] of [['coords_set',{session_id:'bad',scale:0},'INVALID_ARGUMENT'],['track_create',{session_id:'bad',name:'A',type:'vector'},'UNSUPPORTED_TYPE'],['mark_set',{session_id:'bad',track:'A',clear:true,marks:[{frame:0,x:1}]},'INVALID_ARGUMENT']]) {
      const reply=await client.callTool({name,arguments:args});
      assert.equal(reply.isError,true);assert.equal(JSON.parse(reply.content[0].text).error.code,code);
    }
    assert.equal(requests,0);
  } finally {await client.close();await server.close();}
});
