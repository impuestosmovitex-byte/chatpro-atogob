import {ChatAgentService} from './chat-agent.service';
describe('MW1 product listing prioritization',()=>{
  const agent=Object.create(ChatAgentService.prototype) as ChatAgentService;
  const classify=(title:string)=>(agent as unknown as {isBundleLikeProductTitle:(s:string)=>boolean}).isBundleLikeProductTitle(title);
  test('identifies outfits and packs to exclude from single-garment search',()=>{
    expect(classify('Conjunto Chamarra Con Taches y Vestido Flores')).toBe(true);
    expect(classify('Combo Vestido y Chaqueta')).toBe(true);
    expect(classify('Set Blusa y Pantalón')).toBe(true);
  });
  test('does not classify individual garment as a set',()=>{
    expect(classify('Vestido straple de flores')).toBe(false);
    expect(classify('Chaqueta de jean')).toBe(false);
  });
});
