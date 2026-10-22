/** Commercial proposal only. Not connected to billing, company entitlements or publication. */
export const MW1_COMMERCIAL_PROPOSAL = [
 {key:'basico',legacyKey:'inicial',name:'Básico',price:149000,users:2,connections:1,featured:false,eyebrow:'Para comenzar',
 summary:'Organiza tus clientes y conversaciones en un solo lugar.',
 highlights:['CRM y bandeja compartida','Gestión de clientes y contactos','Asignación a asesores','Soporte técnico','Capacitación básica'],
 included:['WhatsApp sujeto a conexión autorizada','Historial de conversaciones, etiquetas y notas','Gestión de clientes y seguimiento','Atención por asesores','Configuración y capacitación básica'],
 conditional:['Los cargos de Meta/WhatsApp se pagan por separado']},
 {key:'eco',legacyKey:'pro',name:'Eco',price:259000,users:3,connections:3,featured:true,eyebrow:'Para crecer',
 summary:'IA comercial, automatizaciones y seguimiento de oportunidades.',
 highlights:['Todo lo de Básico','IA de ventas y atención','Automatizaciones disponibles','Leads y estadísticas','Capacitación avanzada'],
 included:['WhatsApp, Instagram y Messenger según integración verificada','Asistente IA y base de conocimiento','Transferencia de IA a asesor humano','Automatizaciones comerciales disponibles','Gestión de leads y reportes','Capacitación avanzada y soporte'],
 conditional:['Envío de guías sujeto a configuración e integración','Cupo de consumo de IA aún por aprobar','Meta/WhatsApp facturado aparte']},
 {key:'pro',legacyKey:'empresa',name:'Pro',price:599000,users:3,connections:5,featured:false,eyebrow:'Para más operaciones',
 summary:'Más conexiones, acompañamiento premium y desarrollo hacia pedidos.',
 highlights:['Todo lo de Eco','Hasta 5 conexiones','Automatizaciones avanzadas disponibles','Capacitación premium','Pedidos (en desarrollo)'],
 included:['CRM, bandeja, IA comercial y reportes','Configuración asistida de canales','Capacitación premium y soporte técnico'],
 conditional:['Carritos, pedidos y enlaces de pago: en desarrollo, no incluidos en la oferta operativa actual','Conectores de catálogos adicionales sujetos a validación','Cupo de IA pendiente de aprobación','Meta/WhatsApp facturado aparte']},
] as const;
export const MW1_EXTRA_USER_PREVIEW_COP=32000;
export const MW1_EXTRA_CONNECTION_PREVIEW_COP=50000;
