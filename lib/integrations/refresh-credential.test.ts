import { beforeEach,expect,it,vi } from 'vitest';
vi.mock('./google-oauth',()=>({refreshGoogleCredential:vi.fn()}));
import { refreshGoogleCredential } from './google-oauth';
import { consumeCurrentCredential } from './refresh-credential';
beforeEach(()=>vi.resetAllMocks());
it('persists a refreshed token before executing the action',async()=>{
 vi.mocked(refreshGoogleCredential).mockResolvedValue('new');const order:string[]=[];
 const result=await consumeCurrentCredential('google_sheets','old',async value=>{expect(value).toBe('new');order.push('persist');return true;},async value=>{order.push('execute');return value;});
 expect(result).toBe('new');expect(order).toEqual(['persist','execute']);
});
it('does not execute after losing a refresh or rotation race',async()=>{
 vi.mocked(refreshGoogleCredential).mockResolvedValue('new');const consume=vi.fn();
 await expect(consumeCurrentCredential('google_sheets','old',async()=>false,consume)).rejects.toThrow('integration_credential_changed');expect(consume).not.toHaveBeenCalled();
});
it('does not refresh or persist a different provider',async()=>{
 const persist=vi.fn();expect(await consumeCurrentCredential('airtable','old',persist,async value=>value)).toBe('old');expect(persist).not.toHaveBeenCalled();expect(refreshGoogleCredential).not.toHaveBeenCalled();
});
