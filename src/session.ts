import path from 'node:path';
import { z } from 'zod';
import { fail } from './errors.js';
import type { ServiceClient } from './service-client.js';

export type RequestClient = Pick<ServiceClient, 'request'>;
export const absolutePath = z.string().min(1).max(4096).refine(value => path.isAbsolute(value) && !value.includes('\0'), 'Must be an absolute local path without NUL');
export const sessionId = z.uuid();
export const openSchema = z.strictObject({path:absolutePath, timeout_ms:z.number().int().min(1).max(120000).default(60000)});
export const controlSchema = z.strictObject({session_id:sessionId, action:z.enum(['status','save','close']), path:absolutePath.optional()}).superRefine((value,ctx) => {
  if (value.action === 'save' ? !value.path || !/\.(trk|trz)$/i.test(value.path) : value.path !== undefined)
    ctx.addIssue({code:'custom', message:'Only save accepts and requires a .trk or .trz path', path:['path']});
});
export async function runSessionOpen(args:unknown, client:RequestClient) {
  const parsed=openSchema.safeParse(args);
  if (!parsed.success) return fail('INVALID_ARGUMENT','Invalid session_open arguments');
  return client.request('open',parsed.data,parsed.data.timeout_ms+10000);
}
export async function runSessionControl(args:unknown, client:RequestClient) {
  const parsed=controlSchema.safeParse(args);
  if (!parsed.success) return fail('INVALID_ARGUMENT','Invalid session_control arguments');
  return client.request('control',parsed.data,70000);
}

const boundedNumber=z.number().min(-1e12).max(1e12);
const frameNumber=z.number().int().min(0).max(99999);
const trackName=z.string().min(1).max(128).refine(value=>value.trim().length>0&&!value.includes('\0'));
const lengthUnit=z.string().trim().min(1).max(64).refine(value=>!/[\p{Nd}\x00-\x1f\x7f-\x9f]/u.test(value));
export const coordsSchema=z.strictObject({session_id:sessionId,frame:frameNumber.default(0),origin_x:boundedNumber.optional(),origin_y:boundedNumber.optional(),angle_rad:boundedNumber.optional(),scale:z.number().min(1e-9).max(1e12).optional(),length_unit:lengthUnit.optional()});
export const trackSchema=z.strictObject({session_id:sessionId,name:trackName,type:z.literal('point_mass').default('point_mass'),mass:z.number().min(1e-30).max(1e12).default(1)});
export const markSchema=z.strictObject({session_id:sessionId,track:trackName,clear:z.boolean().default(false),marks:z.array(z.strictObject({frame:frameNumber,x:boundedNumber.optional(),y:boundedNumber.optional()})).max(100000)}).superRefine((value,ctx)=>{
  const seen=new Set<number>();
  for(const mark of value.marks) {
    if(seen.has(mark.frame)||(value.clear ? mark.x!==undefined||mark.y!==undefined : mark.x===undefined||mark.y===undefined))
      ctx.addIssue({code:'custom',message:'Frames must be unique; set requires x/y, clear permits frame only',path:['marks']});
    seen.add(mark.frame);
  }
});
async function mutation(schema:z.ZodType,args:unknown,client:RequestClient,method:string) {
  const parsed=schema.safeParse(args);
  if(!parsed.success)return fail('INVALID_ARGUMENT',`Invalid ${method} arguments`);
  return client.request(method,parsed.data as Record<string,unknown>,70000);
}
export const runCoordsSet=(args:unknown,client:RequestClient)=>mutation(coordsSchema,args,client,'coords');
export function runTrackCreate(args:unknown,client:RequestClient) {
  if(args&&typeof args==='object'&&'type' in args&&typeof args.type==='string'&&args.type!=='point_mass')
    return Promise.resolve(fail('UNSUPPORTED_TYPE','Only point_mass is supported'));
  return mutation(trackSchema,args,client,'track');
}
export const runMarkSet=(args:unknown,client:RequestClient)=>mutation(markSchema,args,client,'mark');
