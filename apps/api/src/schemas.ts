import { z } from 'zod';
import { uuid } from './db.js';

const wording = z.string().trim().min(1).max(4000);
const short = z.string().trim().min(1).max(160);
const expectedVersion = z.number().int().positive();
export const intakeSchema = z.object({
  customer: z.object({ name: short, phone: z.string().trim().min(3).max(50), email: z.union([z.email(),z.literal('')]) }).strict(),
  vehicle: z.object({ vin: z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/, 'Enter a 17-character VIN without I, O or Q.'), registration: short, make: short, model: short }).strict(),
  odometerKm: z.number().int().min(0).max(10000000),
  socPercent: z.number().int().min(0).max(100).nullable(),
  complaint: wording,
}).strict();
export const complaintSchema = z.object({ expectedVersion, wording }).strict();
export const taskSchema = z.object({ expectedVersion, complaintId: uuid, title: short }).strict();
export const holdSchema = z.object({
  expectedVersion,
  scope: z.discriminatedUnion('kind', [z.object({kind:z.literal('workOrder')}).strict(),z.object({kind:z.literal('task'),taskId:uuid}).strict()]),
  category:z.enum(['safety','approval','parts','equipment','competency','other']),
  severity:z.enum(['stop','warning']),reason:wording,source:wording,
}).strict();
const at = z.union([z.date(),z.iso.datetime({offset:true})]).transform(v => v instanceof Date ? v.toISOString() : v);
export const summarySchema = z.object({
  id:uuid,reference:z.string(),version:z.number().int(),createdAt:at,customerName:z.string(),vehicleLabel:z.string(),vin:z.string(),registration:z.string(),status:z.literal('intakeDraft'),complaintCount:z.number().int(),openHoldCount:z.number().int(),
});
export const detailSchema = summarySchema.extend({
  customer:z.object({id:uuid,name:z.string(),phone:z.string(),email:z.string()}),
  vehicle:z.object({id:uuid,vin:z.string(),registration:z.string(),make:z.string(),model:z.string()}),
  odometerKm:z.number().int(),socPercent:z.number().int().nullable(),
  complaints:z.array(z.object({id:uuid,reference:z.string(),wording:z.string()})),
  tasks:z.array(z.object({id:uuid,reference:z.string(),title:z.string(),complaintId:uuid,state:z.literal('planned')})),
  holds:z.array(z.object({id:uuid,category:z.string(),severity:z.string(),reason:z.string(),source:z.string(),taskId:uuid.nullable(),openedAt:at,openedBy:z.string()})),
  history:z.array(z.object({id:uuid,action:z.string(),at,actor:z.string(),reason:z.string()})),
  gates:z.array(z.object({code:z.string(),label:z.string(),state:z.literal('pending'),missing:z.array(z.string())})),
});
export type WorkOrderDetail = z.infer<typeof detailSchema>;
