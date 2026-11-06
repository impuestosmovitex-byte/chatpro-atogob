import { extractStagingWhatsappPhoneIds } from './staging-whatsapp-routing';
describe('staging WhatsApp routing candidate extraction', () => {
  it('reads signed payload metadata phone IDs without treating them as authorization', () => {
    const payload = { entry: [{changes:[{value:{metadata:{phone_number_id:'123456789'}}}]}] };
    expect(extractStagingWhatsappPhoneIds(payload)).toEqual(['123456789']);
  });
  it('rejects arbitrary and invalid IDs', () => {
    expect(extractStagingWhatsappPhoneIds({entry:[{changes:[{value:{metadata:{phone_number_id:'x'}}}]}]})).toEqual([]);
    expect(extractStagingWhatsappPhoneIds({entry:'bad'})).toEqual([]);
  });
});
