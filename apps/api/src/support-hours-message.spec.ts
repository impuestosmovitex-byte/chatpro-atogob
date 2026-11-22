import {formatConfiguredSupportHours} from './support-hours-message';
const rows = Array.from({length:7},(_,day_of_week)=>({
  day_of_week,is_open:day_of_week!==0,start_time:'09:00:00',end_time:'18:00:00',
}));
describe('Public human support schedule',()=>{
 it('formats the configured Monday-Saturday opening times in Colombia',()=>{
   expect(formatConfiguredSupportHours(rows)).toBe('lunes a sábado, de 9:00 a. m. a 6:00 p. m.');
 });
 it('updates automatically when admin changes hours',()=>{
   const other=rows.map(r=>({...r,start_time:'10:30:00',end_time:'19:00:00'}));
   expect(formatConfiguredSupportHours(other)).toBe('lunes a sábado, de 10:30 a. m. a 7:00 p. m.');
 });
 it('does not invent hours for closed or invalid schedules',()=>{
   expect(formatConfiguredSupportHours(rows.map(r=>({...r,is_open:false})))).toBe('');
   expect(formatConfiguredSupportHours([{day_of_week:2,is_open:true,start_time:null,end_time:'18:00:00'}])).toBe('');
 });
 it('supports irregular schedules without claiming they are open every day',()=>{
   expect(formatConfiguredSupportHours([{day_of_week:1,is_open:true,start_time:'08:00:00',end_time:'12:00:00'}])).toBe('lunes de 8:00 a. m. a 12:00 p. m.');
 });
});
