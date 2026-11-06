/** Read-only commercial schedule. Never authorizes payment or access. */
export function calculateIntroductoryMonths(monthlyCop:number, monthCount=3):number[]{
 if(!Number.isSafeInteger(monthlyCop)||monthlyCop<0||monthlyCop%2!==0)throw new Error('Precio mensual inválido: se requieren pesos enteros y descuento exacto.');
 if(!Number.isInteger(monthCount)||monthCount<1||monthCount>36)throw new Error('Período inválido.');
 return Array.from({length:monthCount},(_,index)=>index===1?monthlyCop/2:monthlyCop);
}
