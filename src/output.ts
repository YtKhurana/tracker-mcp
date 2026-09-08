import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {fail} from './errors.js';
import {absolutePath,sessionId,frameNumber,trackName,type RequestClient} from './session.js';
export const exportSchema=z.strictObject({session_id:sessionId,track:trackName,path:absolutePath.optional(),columns:z.array(z.enum(['t','x','y','vx','vy'])).min(1).max(5).default(['t','x','y','vx','vy']),format:z.enum(['csv','json']).default('csv')}).superRefine((value,ctx)=>{
  if(new Set(value.columns).size!==value.columns.length||(value.path&&!value.path.toLowerCase().endsWith('.'+value.format)))ctx.addIssue({code:'custom',message:'Columns must be unique and path suffix must match format'});
});
export const frameSchema=z.strictObject({session_id:sessionId,frame:frameNumber,path:absolutePath.refine(value=>value.toLowerCase().endsWith('.png'),'PNG path required').optional()});
export async function runDataExport(args:unknown,client:RequestClient) {
  const parsed=exportSchema.safeParse(args);
  if(!parsed.success)return fail('INVALID_ARGUMENT','Invalid data_export arguments');
  return client.request('export',parsed.data,70000);
}
export async function runFrameGet(args:unknown,client:RequestClient) {
  const parsed=frameSchema.safeParse(args);
  if(!parsed.success)return fail('INVALID_ARGUMENT','Invalid frame_get arguments');
  let output=parsed.data.path;
  if(!output) {
    try {output=path.join(mkdtempSync(path.join(tmpdir(),'tracker-frame-')),`frame-${parsed.data.frame}.png`);}
    catch {return fail('SAVE_FAILED','Cannot allocate a temporary PNG output directory');}
  }
  const result=await client.request('frame',{...parsed.data,path:output},70000);
  // Never delete uncertain outputs: a timed-out native write may have completed.
  return result.ok ? result : {...result,error:{...result.error,details:{...result.error.details,attempted_path:output}}};
}
