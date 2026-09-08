import assert from 'node:assert/strict';
import test from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createTrackerMcpServer} from '../dist/server.js';
import {ALL_ERROR_CODES} from '../dist/errors.js';
test('all twelve frozen errors preserve JSON details and isError over MCP',async()=>{
  assert.deepEqual([...ALL_ERROR_CODES].sort(),['NOT_FOUND','INVALID_ARGUMENT','PARSE_FAILED','UNSUPPORTED_TYPE','NO_SESSION','SESSION_BUSY','SERVICE_UNAVAILABLE','JAVA_EXIT','TIMEOUT','VIDEO_DECODE','SAVE_FAILED','EXPORT_EMPTY'].sort());
  let result;const service={request:async()=>result,close:async()=>{},snapshot:()=>null};
  const server=createTrackerMcpServer(service);const client=new Client({name:'error-audit',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  try {
    for(const code of ALL_ERROR_CODES) {
      result={ok:false,error:{code,message:'specific failure',details:{field:'x',count:2}}};
      const reply=await client.callTool({name:'session_control',arguments:{session_id:'12345678-1234-4234-8234-123456789abc',action:'status'}});
      assert.equal(reply.isError,true);assert.deepEqual(JSON.parse(reply.content[0].text),result);
    }
  } finally {await client.close();await server.close();}
});
