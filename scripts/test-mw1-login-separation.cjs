const fs=require('node:fs');
const assert=require('node:assert/strict');
const page=fs.readFileSync('app/login/page.tsx','utf8');
const css=fs.readFileSync('app/login/page.module.css','utf8');
const auth=fs.readFileSync('app/api/auth/login/route.ts','utf8');
const proxy=fs.readFileSync('proxy.ts','utf8');
// Visitors and new company owners must not see an invitation to enter platform admin.
assert(!page.includes('Entrar como superadministrador MW1'),'Customer login advertises platform admin login');
assert(!page.includes('href="/login?mode=platform'),'Customer login exposes platform link');
assert(!page.includes('MW1DEMO'),'Customer login incorrectly suggests another company code');
assert(page.includes("platformLogin?'Administración de MW1':'Accede a tu empresa'"));
assert(page.includes('styles.platformShell'));
assert(css.includes('.platformShell'));
assert(page.includes('No pudimos validar el código de acceso o la contraseña'));
assert(page.includes("router.replace(platformLogin && safeDestination==='/' ? '/admin' : safeDestination)"));
assert(auth.includes("body.company==='__platform__'"),'Private platform route must remain separated');
assert(proxy.includes("session.type!=='platform'"),'Platform routes must deny tenant sessions');
console.log('MW1 login: customer/platform navigation, branded screens and denial messages validated.');
