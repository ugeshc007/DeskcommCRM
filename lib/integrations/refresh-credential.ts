import { refreshGoogleCredential } from './google-oauth';
/** Refresh não muda a revisão autorizada pelo administrador. CAS impede sobrescrita
 * por worker concorrente ou rotação. Nenhuma chamada de ação antecede persistência. */
export async function consumeCurrentCredential<T>(provider:string,credential:string,persist:(renewed:string)=>Promise<boolean>,consume:(value:string)=>Promise<T>):Promise<T>{
 if(provider!=='google_sheets')return consume(credential);
 const renewed=await refreshGoogleCredential(credential);
 if(renewed!==credential&&!(await persist(renewed)))throw new Error('integration_credential_changed');
 return consume(renewed);
}
