import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { serviceRoot } from './service.js';
import { join } from 'node:path';
export async function startMcp(root=serviceRoot) {
  const transport=new StdioClientTransport({command:process.execPath,args:[join(root,'dist/index.js')],cwd:root,stderr:'pipe'});
  transport.stderr?.on('data',()=>{});
  const client=new Client({name:'tracker-job-test',version:'1.0'});
  await client.connect(transport);
  transport.stderr?.on('data',()=>{});
  return {client,transport,close:()=>client.close(),call:async(name,args)=>{
    const response=await client.callTool({name,arguments:args},undefined,{timeout:150000});
    return JSON.parse(response.content[0].text);
  }};
}
